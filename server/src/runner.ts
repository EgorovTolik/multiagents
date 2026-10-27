import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

import { AgentRegistry, type AgentDef } from "./registry";
import type { ProjectConfig } from "./api-types";
import { agentRunError } from "./error-types";
import { RecoveryEngine, ORCHESTRATOR_ID } from "./recovery.js";
import { PlanService } from "./plan-service.js";
import { MutexManager } from "./mutex.js";
import { SkillInjector } from "./skills-injector.js";
import type { SkillRegistry } from "./skill-registry";
import { ContextStore, type Message } from "./context-store";
import { ProviderRegistry } from "./providers.js";
import { QueueManager } from "./queue.js";
import { PromptBuilder } from "./prompt-builder.js";
import { buildAgentTools } from "./agent-tools.js";
import { AgentSessionManager } from "./session-manager.js";
import { HandoffManager } from "./handoff-manager.js";
import { RecoveryManager } from "./recovery-manager.js";
import { ImageManager, fmtSize } from "./image-manager.js";
import { readJson } from "./utils.js";
import { extractText, isImage, sanitizeFileLinks, generateName } from "./utils-runner.js";
import type { ServerToClientMessage } from "./ws-types.ts";

export type Emit = (msg: ServerToClientMessage) => void;

/** Информация об инструменте pi. */
export interface PiToolInfo {
  name: string;
  description?: string;
}

/** Группа инструментов (для API /api/tools). */
export interface ToolGroup {
  id: string;
  tools: PiToolInfo[];
}

/** Изображение, присланное пользователем в чат. */
export interface FileAttachment {
  name: string;
  mediaType: string;
  data: string;
  size: number;
}

/** Режим восстановления обрыва цепочки. */
export type RecoveryMode = "router_agent" | "orchestrator_check";

function loadSystemConfig(): { maxHandoffs: number; maxRecoveries: number; stallTimeoutMs: number; maxUploadSizeMb: number; recoveryMode: RecoveryMode } {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "config.json"), "utf8"));
    return {
      maxHandoffs: cfg.maxHandoffs ?? 200,
      maxRecoveries: cfg.maxRecoveries ?? 2,
      stallTimeoutMs: cfg.stallTimeoutMs ?? 3 * 60 * 1000,
      maxUploadSizeMb: cfg.maxUploadSizeMb ?? 50,
      recoveryMode: cfg.recoveryMode === "orchestrator_check" ? "orchestrator_check" : "router_agent",
    };
  } catch (e) {
    console.warn("[system] Не удалось загрузить config.json, использую значения по умолчанию:", e);
    return { maxHandoffs: 200, maxRecoveries: 2, stallTimeoutMs: 3 * 60 * 1000, maxUploadSizeMb: 50, recoveryMode: "router_agent" };
  }
}

const sysCfg = loadSystemConfig();
let MAX_HANDOFFS = sysCfg.maxHandoffs;

export class AgentRunner {
  private promptBuilder!: PromptBuilder;
  private imageManager!: ImageManager;
  private skillInjector!: SkillInjector;
  private sessionManager!: AgentSessionManager;
  activeByCtx = new Map<string, string>();
  private mutexManager!: MutexManager;
  private recoveryEngine!: RecoveryEngine;
  private handoffManager!: HandoffManager;
  private recoveryManager!: RecoveryManager;
  private planService!: PlanService;
  private queue!: QueueManager;
  private modelRuntime: Awaited<ReturnType<typeof ModelRuntime.create>> | null = null;
  private providerRegistry!: ProviderRegistry;
  piToolsFetchedAtValue: number | null = null;

  constructor(
    private registry: AgentRegistry,
    private store: ContextStore,
    private skillRegistry: SkillRegistry,
    private agentsDir: string,
    private systemDir: string,
    private sharedDir: string,
    private defaultModel: string | undefined,
    private emit: Emit,
    private providers: Record<string, { url?: string; apiKey?: string }> = {},
  ) {
    const promptBuilder = new PromptBuilder([]);
    this.promptBuilder = promptBuilder;
    
    this.loadGlobalRules();
    this.skillInjector = new SkillInjector(this.skillRegistry, this.store, this.registry, this.emit);
    this.queue = new QueueManager();
    this.mutexManager = new MutexManager(this.emit);
    this.recoveryEngine = new RecoveryEngine(sysCfg.maxRecoveries);
    this.planService = new PlanService();
    this.providerRegistry = new ProviderRegistry(this.providers, this.defaultModel, this.registry, this.agentsDir);
    this.imageManager = new ImageManager({
      getCtxDir: (ctxId) => this.getCtxDir(ctxId),
      storeAppendMessage: (ctxId, msg) => this.store.appendMessage(ctxId, msg),
      emit: this.emit,
    });
    this.sessionManager = new AgentSessionManager(
      this.store,
      (ctxId) => this.getCtxDir(ctxId),
      this.modelRuntime!,
      (id?: string) => this.resolveModel(id),
      async (runtime, spec) => {
        await this.providerRegistry.ensureModelRegistered(runtime, spec);
      },
      buildAgentTools,
      this.registry,
      this.promptBuilder,
      this.skillInjector,
      (ctxId, agentId, ev) => this.forward(ctxId, agentId, ev),
    );

    // Создаём handoff и recovery менеджеры после sessionManager
    this.handoffManager = new HandoffManager(
      this.registry,
      this.store,
      this.sessionManager,
      this.promptBuilder,
      this.emit,
    );
    this.recoveryManager = new RecoveryManager(
      this.registry,
      this.store,
      this.sessionManager,
      this.recoveryEngine,
      this.activeByCtx,
      sysCfg.stallTimeoutMs,
      sysCfg.maxRecoveries,
      sysCfg.recoveryMode,
      this.emit,
    );
  }

  private loadGlobalRules() {
    const rules: string[] = [];
    if (!fs.existsSync(this.systemDir)) return;
    for (const f of fs.readdirSync(this.systemDir).sort()) {
      if (!f.endsWith(".md")) continue;
      rules.push(fs.readFileSync(path.join(this.systemDir, f), "utf8"));
    }
    this.promptBuilder.setGlobalRules(rules);
  }

  async init() {
    this.modelRuntime = await ModelRuntime.create();
    await this.providerRegistry.registerProjectProviders(this.modelRuntime);
    this.providerRegistry.correctAgentModels();

    // Watchdog: проверка зависших сессий каждые 15 секунд
    setInterval(() => {
      this.recoveryManager.checkStalledSessions();
    }, 15000).unref();
  }

  getActives(): { ctxId: string; agentId: string }[] {
    return [...this.activeByCtx.entries()].map(([ctxId, agentId]) => ({ ctxId, agentId }));
  }

  getActiveAgent(ctxId: string): string | undefined {
    return this.activeByCtx.get(ctxId);
  }

  hasQueued(): boolean {
    return this.queue.hasQueued();
  }

  getPlanService(): PlanService {
    return this.planService;
  }

  getContextStore(): ContextStore {
    return this.store;
  }

  private key(ctxId: string, agentId: string) {
    return `${ctxId}/${agentId}`;
  }

  invalidateContext(ctxId: string) {
    for (const session of this.sessionManager.getAllSessions()) {
      // Abort all sessions for this context
      session.abort();
    }
    this.sessionManager.closeAll();
    const ctx = this.store.get(ctxId);
    if (ctx?.deliveredSkills) {
      ctx.deliveredSkills = {};
      this.store.save(ctx);
    }
  }

  disposeContext(_ctxId: string) {
    // Close all sessions for this context
    this.sessionManager.closeAll();
  }

  abort(ctxId: string) {
    const agentId = this.activeByCtx.get(ctxId);
    if (!agentId) return;
    const ctx = this.store.get(ctxId);
    if (ctx) {
      ctx.pendingHandoff = undefined;
      ctx.aborted = true;
      ctx.inChain = false;
      ctx.recoveryCount = 0;
      this.store.save(ctx);
      this.emit({ type: "handoff_cancelled", ctxId });
      const sysMsg: Message = { role: "system", text: "⏹ Остановлено пользователем", ts: Date.now() };
      this.store.appendMessage(ctxId, sysMsg);
      this.emit({ type: "message", ctxId, message: sysMsg });
    }
    const session = this.sessionManager.getSessionByCtxAndAgent(ctxId, agentId);
    void session?.abort();
  }

  cancelHandoff(ctxId: string) {
    const ctx = this.store.get(ctxId);
    if (!ctx?.pendingHandoff) return;
    ctx.pendingHandoff = undefined;
    this.store.save(ctx);
    this.emit({ type: "handoff_cancelled", ctxId });
  }

  getPendingStream(ctxId: string): { agentId: string; text: string; thinking?: string } | null {
    const agentId = this.activeByCtx.get(ctxId);
    if (!agentId) return null;

    const text = this.sessionManager.getPendingText(ctxId, agentId);
    const thinking = this.sessionManager.getPendingThinking(ctxId, agentId);

    if (text || thinking) {
      return { agentId, text: text || "", thinking: thinking || undefined };
    }
    return null;
  }

  /** Входящее сообщение пользователя. */
  async handleMessage(ctxId: string, text: string, files?: FileAttachment[]) {
    const ctx = this.store.get(ctxId);
    if (!ctx) throw new Error("Контекст не найден: " + ctxId);

    // Сохраняем файлы в папку контекста
    let fullText = text;
    if (files && files.length > 0) {
      const filesDir = path.join(this.getCtxDir(ctxId), "files");
      fs.mkdirSync(filesDir, { recursive: true });
      fs.mkdirSync(path.join(PROJECT_ROOT, "previews"), { recursive: true });
      const links: string[] = [];
      for (const f of files) {
        const ext = path.extname(f.name) || ".bin";
        const now = new Date();
        const p2 = (n: number) => String(n).padStart(2, "0");
        const stamp = `${p2(now.getDate())}.${p2(now.getMonth()+1)}.${now.getFullYear()}-${p2(now.getHours())}.${p2(now.getMinutes())}.${p2(now.getSeconds())}`;
        const fname = `${now.getTime()}-${stamp}${ext}`;
        const buf = Buffer.from(f.data, "base64");
        fs.writeFileSync(path.join(filesDir, fname), buf);
        fs.writeFileSync(path.join(PROJECT_ROOT, "previews", fname), buf);
        if (isImage(f)) {
          links.push(`![${fname}](/api/previews/${fname})`);
        } else {
          links.push(`[📄 ${fname} (${fmtSize(f.size)})](/api/previews/${fname})`);
        }
      }
      fullText = text + "\n\n" + links.join("\n");
    }

    let agentId = ctx.activeAgentId;
    if (ctx.awaitingUser) {
      agentId = ctx.awaitingUser.agentId;
      ctx.awaitingUser = undefined;
      ctx.activeAgentId = agentId;
    }
    if (agentId === ORCHESTRATOR_ID) {
      ctx.inChain = false;
      ctx.recoveryCount = 0;
    }
    ctx.aborted = false;
    this.store.save(ctx);

    const msg: Message = { role: "user", agentId, text: fullText, ts: Date.now() };
    this.store.appendMessage(ctxId, msg);
    this.emit({ type: "message", ctxId, message: msg });

    if (this.activeByCtx.has(ctxId)) {
      this.queue.push(ctxId, fullText, files);
      this.emitQueued(ctxId);
    } else {
      void this.run(ctxId, fullText, files);
    }
  }

  private emitQueued(ctxId: string): void {
    const count = this.queue.countForCtx(ctxId);
    this.emit({ type: "queued", ctxId, count });
  }

  private dispatchQueue(): void {
    const idx = this.queue.findNextAvailable(this.activeByCtx);
    if (idx === -1) return;
    const next = this.queue.pop(idx)!;
    this.emitQueued(next.ctxId);
    void this.run(next.ctxId, next.text, next.files);
  }

  private async run(ctxId: string, text: string, files?: FileAttachment[]) {
    // Перечитываем конфигурацию агентов и глобальную модель с диска
    // перед каждым новым запуском — чтобы изменения в config.json
    // применялись без перезапуска сервера.
    this.registry.reload();
    const projectConfig: ProjectConfig = readJson(path.join(PROJECT_ROOT, "config.json"), {});
    if (projectConfig.model && projectConfig.model !== this.defaultModel) {
      console.log(`[system] Модель по умолчанию обновлена: ${this.defaultModel ?? "(нет)"} → ${projectConfig.model}`);
      this.defaultModel = projectConfig.model;
      this.providerRegistry.updateDefaultModel(projectConfig.model);
    }

    const ctx = this.store.get(ctxId);
    if (!ctx) return;
    const agentId = ctx.activeAgentId;
    const def = this.registry.get(agentId);
    if (!def) {
      this.emit({ type: "error", ctxId, message: `Агент не найден: ${agentId}` });
      return;
    }

    this.activeByCtx.set(ctxId, agentId);
    await this.mutexManager.acquireAgent(agentId, ctxId);
    this.emit({ type: "run_start", ctxId, agentId });

    const injection = this.skillInjector.inject(ctx, agentId, text);
    if (injection.changed) {
      const sysMsg: Message = { role: "system", text: `⚡ Навыки переданы агенту «${def.name}»`, ts: Date.now() };
      this.store.appendMessage(ctxId, sysMsg);
      this.emit({ type: "message", ctxId, message: sysMsg });
    }

    try {
      const session = await this.getSession(ctxId, agentId, def);
      const imageFiles = files?.filter(isImage) ?? [];
      const promptOpts = imageFiles.length > 0
        ? { images: imageFiles.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mediaType })) }
        : undefined;
      await session.prompt(injection.text, promptOpts);
    } catch (e) {
      const ctxNow = this.store.get(ctxId);
      if (!ctxNow?.awaitingUser && !ctxNow?.aborted) {
        console.error(`[ctxId:${ctxId}] [runner] run error:`, e);
        const err = agentRunError(agentId, typeof e === "string" ? e : (e as any)?.message ?? String(e));
        this.emit({ type: "error", ctxId, message: err.message, error: err });
      }
    } finally {
      this.mutexManager.releaseAgent(agentId);
      this.imageManager.flushPendingImages(ctxId, agentId);
      this.emit({ type: "run_end", ctxId, agentId });
    }

    // Обработка после завершения сессии — вне finally чтобы избежать return in finally
    const ctxAfterRun = this.store.get(ctxId)!;
    const pending = ctxAfterRun.pendingHandoff;
    ctxAfterRun.pendingHandoff = undefined;
    if (pending && this.registry.get(pending.to)) {
      this.handoffManager.doHandoff(ctxId, ctxAfterRun, pending, this.promptBuilder.buildHandoffPrompt(pending), (ctxId, text) => {
        void this.run(ctxId, text);
      });
      return;
    }

    if (agentId === "agent-creator") {
      this.registry.reload();
      this.emit({ type: "agents", agents: this.registry.list() });
    }

    // Обрыв цепочки — делегируем RecoveryManager
    const lastTask = ctxAfterRun.handoffs[ctxAfterRun.handoffs.length - 1];
    const chainBreakHandled = await this.recoveryManager.handleChainBreak(
      ctxId, ctxAfterRun, agentId, lastTask,
      (ctxId, ctx, handoff, prompt) => {
        this.handoffManager.doHandoff(ctxId, ctx, handoff, prompt, (cid, text) => {
          void this.run(cid, text);
        });
      },
    );
    if (chainBreakHandled) return;

    if (ctxAfterRun.activeAgentId !== ORCHESTRATOR_ID && !ctxAfterRun.awaitingUser) {
      ctxAfterRun.activeAgentId = ORCHESTRATOR_ID;
      ctxAfterRun.inChain = false;
    }
    this.store.save(ctxAfterRun);
    this.activeByCtx.delete(ctxId);
    this.dispatchQueue();
  }



  private async getSession(ctxId: string, agentId: string, def: AgentDef) {
    let model = this.resolveModel(def.model);
    if (def.model && !model) {
      await this.providerRegistry.ensureModelRegistered(this.modelRuntime!, def.model);
      model = this.resolveModel(def.model);
    }
    console.log(`[runner] сессия ${ctxId}/${agentId}: модель=${model ? `${model.provider}/${model.id}` : "default"} thinking=${def.thinkingLevel ?? "-"}`);
    return await this.sessionManager.getSession(
      ctxId, agentId, def,
      this.emit,
      this.sharedDir,
      this.agentsDir,
      MAX_HANDOFFS,
      () => this.defaultDisabledToolNames(),
    );
  }

  private forward(ctxId: string, agentId: string, ev: AgentSessionEvent) {
    if (["message_update", "message_start", "message_end", "tool_execution_start", "tool_execution_end"].includes(ev.type)) {
      this.recoveryManager.recordActivity(ctxId);
    }

    if (ev.type === "tool_execution_start") {
      console.log(`[ctxId:${ctxId}] [${agentId}] tool_call: ${ev.toolName}`);
    } else if (ev.type === "tool_execution_end") {
      console.log(`[ctxId:${ctxId}] [${agentId}] tool_result: ${ev.isError ? `ERROR` : "OK"}`);
      if (!ev.isError) {
        const md = this.imageManager.saveToolImages(ctxId, ev.result);
        if (md.length > 0) {
          this.imageManager.addPendingImages(ctxId, agentId, md);
        }
      }
    } else if (ev.type === "message_start" && (ev.message?.role || "unknown") == "assistant") {
      const msgId = this.sessionManager.incrementMsgId(ctxId, agentId);
      this.emit({ type: "message_start", ctxId, agentId, msgId });
    }

    if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
      const d: string = ev.assistantMessageEvent.delta ?? "";
      if (d) {
        const existing = this.sessionManager.getPendingText(ctxId, agentId) || "";
        this.sessionManager.setPendingText(ctxId, agentId, existing + d);
      }
      const msgId = this.sessionManager.getMsgId(ctxId, agentId);
      this.emit({ type: "delta", ctxId, agentId, msgId, text: d });
    } else if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "thinking_delta") {
      const d: string = ev.assistantMessageEvent.delta ?? "";
      if (d) {
        const existing = this.sessionManager.getPendingThinking(ctxId, agentId) || "";
        this.sessionManager.setPendingThinking(ctxId, agentId, existing + d);
      }
      const msgId = this.sessionManager.getMsgId(ctxId, agentId);
      this.emit({ type: "thinking_delta", ctxId, agentId, msgId, text: d });
    } else if (ev.type === "message_end") {
      const msgRole = ev.message?.role || "unknown";
      if (msgRole !== "assistant") return;
      let text = this.sessionManager.getPendingText(ctxId, agentId) || extractText(ev.message);
      if (!text) text = "";

      // Применяем накопленные изображения
      text = this.imageManager.withPendingImages(ctxId, agentId, text);

      const thinking = this.sessionManager.getPendingThinking(ctxId, agentId) || "";
      this.sessionManager.setPendingText(ctxId, agentId, "");
      this.sessionManager.setPendingThinking(ctxId, agentId, "");

      text = sanitizeFileLinks(this.getCtxDir(ctxId), text);

      if (!text && !thinking) {
        return;
      }
      const msg: Message = { role: "assistant", agentId, text, thinking: thinking || undefined, ts: Date.now() };
      this.store.appendMessage(ctxId, msg);
      const msgId = this.sessionManager.getMsgId(ctxId, agentId);
      this.emit({ type: "assistant_end", ctxId, agentId, msgId, text: this.store.maskPaths(ctxId, text), thinking });
    }
  }

  private resolveModel(id?: string) {
    if (!this.modelRuntime) return undefined;
    const spec = id ?? this.defaultModel;
    if (!spec) return undefined;
    const slash = spec.indexOf("/");
    if (slash < 0) return undefined;
    return this.modelRuntime.getModel(spec.slice(0, slash), spec.slice(slash + 1));
  }

  public getCtxDir(ctxId: string): string {
    if (this.store.isTrainingContext(ctxId)) {
      return this.store.trainingDir(ctxId);
    }
    const { type } = this.store.resolveDir(ctxId);
    if (type === "mistakes") {
      return this.store.mistakesDir(ctxId);
    }
    return this.store.dir(ctxId);
  }

  async defaultDisabledToolNames(): Promise<string[]> {
    try {
      const groups = await this.listPiTools();
      return (groups.find((g) => g.id === "subagents")?.tools ?? []).map((t) => t.name);
    } catch {
      return [];
    }
  }

  private piToolGroupsCache: ToolGroup[] | null = null;
  async listPiTools(force = false): Promise<ToolGroup[]> {
    if (!force && this.piToolGroupsCache) return this.piToolGroupsCache;
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ma-tools-probe-"));
    try {
      const loader = new DefaultResourceLoader({ cwd: probeDir, agentDir: getAgentDir() });
      await loader.reload();
      const { session } = await createAgentSession({
        cwd: probeDir,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(probeDir),
      });
      try {
        await session.bindExtensions({});
      } catch { /* без MCP-инициализации список всё равно доступен */ }
      const all = session.getAllTools?.() ?? [];
      this.piToolGroupsCache = this.groupPiTools(
        all.map((t) => ({ name: String(t.name), description: t.description ? String(t.description) : undefined })),
      );
      this.piToolsFetchedAtValue = Date.now();
      try { session.dispose?.(); } catch { /* ignore */ }
    } finally {
      fs.rmSync(probeDir, { recursive: true, force: true });
    }
    return this.piToolGroupsCache!;
  }

  /** Группировка инструментов для UI: по пакетам/префиксам, без хардкода имён. */
  private groupPiTools(tools: PiToolInfo[]): ToolGroup[] {
    const groups = new Map<string, { id: string; title: string; tools: PiToolInfo[] }>();
    const ensure = (id: string, title: string) => {
      let g = groups.get(id);
      if (!g) {
        g = { id, title, tools: [] };
        groups.set(id, g);
      }
      return g;
    };
    for (const t of tools) {
      let g;
      if (/^gitlab_/.test(t.name)) g = ensure("gitlab", "GitLab");
      else if (t.name === "mcp" || t.name === "mcpScript" || /^mcp__/.test(t.name)) g = ensure("mcp", "MCP");
      else if (/subagent|workflow|orchestrator/i.test(t.name)) g = ensure("subagents", "Субагенты и workflows (pi-subagentura)");
      else if (["read", "write", "edit", "bash", "find", "grep", "ls"].includes(t.name)) g = ensure("builtin", "Встроенные pi");
      else g = ensure("other", "Прочее");
      g.tools.push(t);
    }
    const order = ["builtin", "mcp", "gitlab", "subagents", "other"];
    return [...groups.values()]
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      .map((g) => ({ ...g, tools: g.tools.sort((a, b) => a.name.localeCompare(b.name)) }));
  }

  resetAllSessions(): number {
    let n = 0;
    // Close all sessions
    for (const session of this.sessionManager.getAllSessions()) {
      try { session.abort(); session.dispose(); } catch { /* ignore */ }
      n++;
    }
    this.sessionManager.closeAll();
    for (const ctx of this.store.list()) {
      if (ctx.deliveredSkills && Object.keys(ctx.deliveredSkills).length > 0) {
        this.store.resetDeliveredSkills(ctx);
        this.store.save(ctx);
      }
    }
    return n;
  }

  updateSystemConfig() {
    const cfg = loadSystemConfig();
    MAX_HANDOFFS = cfg.maxHandoffs;
    this.recoveryEngine.setMaxRecoveries(cfg.maxRecoveries);
  }

  async reloadProjectConfig(configPath: string, broadcastFn?: (msg: unknown) => void): Promise<void> {
    let cfg: ProjectConfig;
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch { return; }
    const newModel = cfg.model || undefined;
    if (newModel !== this.defaultModel) {
      console.log("[system] Модель по умолчанию обновлена:", this.defaultModel ?? "(нет)", "→", newModel ?? "(нет)");
      this.defaultModel = newModel;
      this.providerRegistry.updateDefaultModel(newModel);
    }
    if (cfg.providers) {
      this.providers = cfg.providers;
      this.providerRegistry.updateProviders(cfg.providers);
      await this.providerRegistry.registerProjectProviders(this.modelRuntime);
      this.providerRegistry.correctAgentModels();
    }
    broadcastFn?.({ type: "system_notice", text: `Конфигурация перечитана. Модель: ${this.defaultModel ?? "(нет)"}` });
  }

  generateName(ctxId: string, firstMessage: string): string | null {
    return generateName(firstMessage);
  }
}