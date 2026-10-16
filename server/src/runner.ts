import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

import { Type } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

import { AgentRegistry, type AgentDef } from "./registry";
import { RecoveryEngine, ORCHESTRATOR_ID, CHAIN_ROUTER_ID } from "./recovery.js";
import { MutexManager } from "./mutex.js";
import { SkillInjector } from "./skills-injector.js";
import { ContextStore, type ContextMeta, type Handoff, type Message } from "./context-store";
import { ProviderRegistry } from "./providers.js";
import { QueueManager } from "./queue.js";
import { PromptBuilder } from "./prompt-builder.js";
import { buildAgentTools } from "./agent-tools.js";
import { ImageManager, fmtSize } from "./image-manager.js";
import { extractText, isImage, sanitizeFileLinks, generateName } from "./utils-runner.js";

export type Emit = (msg: unknown) => void;

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
  } catch {
    return { maxHandoffs: 200, maxRecoveries: 2, stallTimeoutMs: 3 * 60 * 1000, maxUploadSizeMb: 50, recoveryMode: "router_agent" };
  }
}

const sysCfg = loadSystemConfig();
let MAX_HANDOFFS = sysCfg.maxHandoffs;
let MAX_RECOVERIES = sysCfg.maxRecoveries;
const STALL_TIMEOUT_MS = sysCfg.stallTimeoutMs;

export class AgentRunner {
  private promptBuilder!: PromptBuilder;
  private imageManager!: ImageManager;
  private skillInjector!: SkillInjector;
  private sessions = new Map<string, AgentSession>();
  activeByCtx = new Map<string, string>();
  private mutexManager!: MutexManager;
  private recoveryEngine!: RecoveryEngine;
  private queue!: QueueManager;
  private lastEventByCtx = new Map<string, number>();
  private modelRuntime: Awaited<ReturnType<typeof ModelRuntime.create>> | null = null;
  private providerRegistry!: ProviderRegistry;
  private pendingThinking = new Map<string, string>();
  private pendingText = new Map<string, string>();

  constructor(
    private registry: AgentRegistry,
    private store: ContextStore,
    private skillRegistry: any,
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
    this.providerRegistry = new ProviderRegistry(this.providers, this.defaultModel, this.registry, this.agentsDir);
    this.imageManager = new ImageManager({
      getCtxDir: (ctxId) => this.getCtxDir(ctxId),
      storeAppendMessage: (ctxId, msg) => this.store.appendMessage(ctxId, msg),
      emit: this.emit,
    });
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

    // Watchdog: если активная сессия не генерирует событий дольше STALL_TIMEOUT_MS — прерываем её
    setInterval(() => {
      for (const [ctxId, agentId] of this.activeByCtx) {
        const last = this.lastEventByCtx.get(ctxId);
        if (last === undefined || Date.now() - last < STALL_TIMEOUT_MS) continue;
        console.error(`[runner] сессия ${agentId} зависла (нет событий ${STALL_TIMEOUT_MS / 1000}с), прерываю`);
        this.emit({ type: "error", ctxId, message: `Агент ${agentId} завис — ход прерван watchdog'ом. Отправьте сообщение ещё раз.` });
        this.lastEventByCtx.set(ctxId, Date.now());
        const session = this.sessions.get(this.key(ctxId, agentId));
        void session?.abort();
      }
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

  private key(ctxId: string, agentId: string) {
    return `${ctxId}/${agentId}`;
  }

  invalidateContext(ctxId: string) {
    const prefix = ctxId + "/";
    for (const [k, s] of [...this.sessions]) {
      if (k.startsWith(prefix)) {
        s.abort();
        this.sessions.delete(k);
      }
    }
    const ctx = this.store.get(ctxId);
    if (ctx?.deliveredSkills) {
      ctx.deliveredSkills = {};
      this.store.save(ctx);
    }
  }

  disposeContext(ctxId: string) {
    for (const [k, s] of [...this.sessions]) {
      if (k.startsWith(ctxId + "/")) {
        try { s.dispose(); } catch { /* ignore */ }
        this.sessions.delete(k);
      }
    }
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
    const session = this.sessions.get(this.key(ctxId, agentId));
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
    for (const [key, text] of this.pendingText.entries()) {
      if (key.startsWith(`${ctxId}|`)) {
        const agentId = key.split("|")[1];
        const thinkingKey = `${ctxId}|${agentId}`;
        const thinking = this.pendingThinking.get(thinkingKey);
        return { agentId, text: text || "", thinking: thinking || undefined };
      }
    }
    for (const [key, thinking] of this.pendingThinking.entries()) {
      if (key.startsWith(`${ctxId}|`)) {
        const agentId = key.split("|")[1];
        return { agentId, text: "", thinking };
      }
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
    } catch (e: any) {
      const ctxNow = this.store.get(ctxId);
      if (!ctxNow?.awaitingUser && !ctxNow?.aborted) {
        console.error("[runner] run error:", e);
        this.emit({ type: "error", ctxId, message: String(e?.message ?? e) });
      }
    } finally {
      this.mutexManager.releaseAgent(agentId);
      this.imageManager.flushPendingImages(ctxId, agentId);
      this.emit({ type: "run_end", ctxId, agentId });

      const ctx = this.store.get(ctxId)!;
      const pending = ctx.pendingHandoff;
      ctx.pendingHandoff = undefined;
      if (pending && this.registry.get(pending.to)) {
        this.doHandoff(ctxId, ctx, pending, this.promptBuilder.buildHandoffPrompt(pending));
        return;
      }

      if (agentId === "agent-creator") {
        this.registry.reload();
        this.emit({ type: "agents", agents: this.registry.list() });
      }

      // Обрыв цепочки: агент был «в цепочке», но завершил ход без route_to_agent
      if (ctx.inChain && agentId !== ORCHESTRATOR_ID && !ctx.awaitingUser && !ctx.aborted) {
        const recoveries = ctx.recoveryCount ?? 0;
        if (recoveries < MAX_RECOVERIES) {
          const task = ctx.handoffs[ctx.handoffs.length - 1];
          const lastMsg = this.lastAssistantMessage(ctxId, agentId);

          if (agentId === CHAIN_ROUTER_ID) {
            const handoff: Handoff = { from: agentId, to: ORCHESTRATOR_ID, reason: "⚠️ Маршрутизатор не принял решение — автопередача", context: lastMsg ?? "(маршрутизатор не оставил завершённого сообщения)", ts: Date.now() };
            ctx.recoveryCount = recoveries + 1;
            this.doHandoff(ctxId, ctx, handoff, this.recoveryEngine.buildRouterFallbackPrompt(task, lastMsg));
            return;
          }

          const incomplete = this.recoveryEngine.detectIncompleteTask(this.getCtxDir(ctxId), agentId, task);
          if (incomplete) {
            console.log(`[runner] ${ctxId}/${agentId}: незавершённая задача обнаружена, автоматически возвращаю агенту`);
            const handoff: Handoff = { from: "system", to: agentId, reason: "⚠️ Автоматическое восстановление: задача не завершена (нет result-файла)", context: incomplete.context, ts: Date.now() };
            ctx.recoveryCount = recoveries + 1;
            this.doHandoff(ctxId, ctx, handoff, this.recoveryEngine.buildAutoRecoveryPrompt(agentId, task, lastMsg, incomplete));
            return;
          }

          if (sysCfg.recoveryMode === "router_agent" && this.registry.get(CHAIN_ROUTER_ID)) {
            const handoff: Handoff = { from: agentId, to: CHAIN_ROUTER_ID, reason: "⚠️ Цепочка прервалась — разбор маршрута", context: lastMsg ?? "(агент не оставил завершённого сообщения)", ts: Date.now() };
            ctx.recoveryCount = recoveries + 1;
            this.doHandoff(ctxId, ctx, handoff, this.recoveryEngine.buildRouterPrompt(ctx, agentId, task, lastMsg, (id) => this.getCtxDir(id)));
            return;
          }

          const handoff: Handoff = { from: agentId, to: ORCHESTRATOR_ID, reason: "⚠️ Цепочка прервалась — автопроверка", context: lastMsg ?? "(агент не оставил завершённого сообщения)", ts: Date.now() };
          ctx.recoveryCount = recoveries + 1;
          this.doHandoff(ctxId, ctx, handoff, this.recoveryEngine.buildRecoveryPrompt(agentId, task, lastMsg));
          return;
        }

        const sysMsg: Message = { role: "system", text: `⚠️ Цепочка прервалась ${MAX_RECOVERIES} раза подряд — автоматическое восстановление остановлено. Отправьте сообщение, чтобы продолжить.`, ts: Date.now() };
        this.store.appendMessage(ctxId, sysMsg);
        this.emit({ type: "message", ctxId, message: sysMsg });
      }

      if (ctx.activeAgentId !== ORCHESTRATOR_ID && !ctx.awaitingUser) {
        ctx.activeAgentId = ORCHESTRATOR_ID;
        ctx.inChain = false;
      }
      this.store.save(ctx);
      this.activeByCtx.delete(ctxId);
      this.lastEventByCtx.delete(ctxId);
      this.dispatchQueue();
    }
  }

  private lastAssistantMessage(ctxId: string, agentId: string): string | undefined {
    const msgs = this.store.readMessages(ctxId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "assistant" && m.agentId === agentId && m.text.trim()) return m.text;
    }
    return undefined;
  }

  private doHandoff(ctxId: string, ctx: ContextMeta, handoff: Handoff, prompt: string) {
    ctx.activeAgentId = handoff.to;
    ctx.handoffs.push(handoff);
    ctx.inChain = true;
    this.store.save(ctx);

    const sysMsg: Message = { role: "system", text: `Передача: ${handoff.from} → ${handoff.to} — ${handoff.reason}`, ts: Date.now() };
    this.store.appendMessage(ctxId, sysMsg);
    this.emit({ type: "handoff", ctxId, handoff });
    this.emit({ type: "message", ctxId, message: sysMsg });

    if (handoff.to !== handoff.from) {
      const fromDef = this.registry.get(handoff.from);
      if (fromDef?.forgetSessionAfterStep) {
        const k = this.key(ctxId, handoff.from);
        const s = this.sessions.get(k);
        if (s) {
          try { s.dispose(); } catch { /* ignore */ }
          this.sessions.delete(k);
        }
        if (ctx.deliveredSkills && ctx.deliveredSkills[handoff.from]?.length) {
          delete ctx.deliveredSkills[handoff.from];
          this.store.save(ctx);
        }
      }
    }

    void this.run(ctxId, prompt);
  }

  private async getSession(ctxId: string, agentId: string, def: AgentDef) {
    const k = this.key(ctxId, agentId);
    const existing = this.sessions.get(k);
    if (existing) return existing;

    const ctxDir = this.getCtxDir(ctxId);
    const loader = new DefaultResourceLoader({
      cwd: ctxDir,
      agentDir: getAgentDir(),
      systemPromptOverride: () => this.promptBuilder.buildSystemPrompt(def, ctxDir),
    });
    await loader.reload();

    const customTools = buildAgentTools(
      ctxId, agentId, def,
      this.store, this.registry, this.emit,
      (cid) => this.getCtxDir(cid),
      this.sharedDir, this.agentsDir,
      MAX_HANDOFFS,
      () => this.defaultDisabledToolNames(),
      this.skillInjector,
      () => k
    );

    let excludeTools = def.disabledTools ?? [];
    try {
      const ctx = this.store.get(ctxId);
      if (ctx?.trainingAgentId) {
        excludeTools = excludeTools.filter((t: string) => !['read', 'write', 'edit', 'bash'].includes(t));
      }
    } catch { /* ignore */ }

    let model = this.resolveModel(def.model);
    if (def.model && !model) {
      await this.providerRegistry.ensureModelRegistered(this.modelRuntime, def.model);
      model = this.resolveModel(def.model);
    }
    if (def.model && !model) {
      console.warn(`[runner] ⚠️ модель «${def.model}» не найдена — агент «${agentId}» будет работать с моделью по умолчанию`);
    }

    const { session } = await createAgentSession({
      cwd: ctxDir,
      model,
      thinkingLevel: def.thinkingLevel as never,
      excludeTools: excludeTools.length > 0 ? excludeTools : undefined,
      customTools,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(ctxDir),
    });

    try {
      await session.bindExtensions({});
    } catch (e) {
      console.error("bindExtensions failed:", e);
    }

    try {
      const history = this.store.readMessages(ctxId).filter((m) => m.role === "user" || m.role === "assistant");
      if (history.length > 0) {
        session.agent.state.messages = history.map((m) => ({ role: m.role, content: [{ type: "text", text: m.text }] })) as any;
      }
    } catch { /* ignore */ }

    session.subscribe((ev: any) => this.forward(ctxId, agentId, ev));
    this.sessions.set(k, session);
    console.log(`[runner] сессия ${ctxId}/${agentId}: модель=${model ? `${(model as any).provider ?? "?"}/${(model as any).id ?? "?"}` : "default"} thinking=${def.thinkingLevel ?? "-"}`);
    return session;
  }

  private forward(ctxId: string, agentId: string, ev: any) {
    if (["message_update", "message_start", "message_end", "tool_execution_start", "tool_execution_end"].includes(ev.type)) {
      this.lastEventByCtx.set(ctxId, Date.now());
    }

    if (ev.type === "tool_execution_start") {
      console.log(`[${agentId}] tool_call: ${ev.name || ev.tool_name}`);
    } else if (ev.type === "tool_execution_end") {
      console.log(`[${agentId}] tool_result: ${ev.isError ? `ERROR - ${ev.error}` : "OK"}`);
      if (!ev.isError) {
        const md = this.imageManager.saveToolImages(ctxId, ev.result);
        if (md.length > 0) {
          this.imageManager.addPendingImages(ctxId, agentId, md);
        }
      }
    } else if (ev.type === "message_start") {
      console.log(`[${agentId}] message_start`);
    } else if (ev.type === "message_end") {
      const text = ev.message?.content?.[0]?.text || "";
      console.log(`[${agentId}] message_end (${text.length} chars)`);
    }

    if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
      const key = `${ctxId}|${agentId}`;
      const d: string = ev.assistantMessageEvent.delta ?? "";
      if (d) this.pendingText.set(key, (this.pendingText.get(key) ?? "") + d);
      this.emit({ type: "delta", ctxId, agentId, text: d });
    } else if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "thinking_delta") {
      const key = `${ctxId}|${agentId}`;
      const d: string = ev.assistantMessageEvent.delta ?? "";
      if (d) this.pendingThinking.set(key, (this.pendingThinking.get(key) ?? "") + d);
      this.emit({ type: "thinking_delta", ctxId, agentId, text: d });
    } else if (ev.type === "message_end" && ev.message?.role === "assistant") {
      const key = `${ctxId}|${agentId}`;
      let text = this.pendingText.get(key) || extractText(ev.message);
      if (!text) text = "";
      this.pendingText.delete(key);

      // Применяем накопленные изображения
      text = this.imageManager.withPendingImages(ctxId, agentId, text);

      const thinking = this.pendingThinking.get(key) || "";
      this.pendingThinking.delete(key);

      text = sanitizeFileLinks(this.getCtxDir(ctxId), text);

      if (!text && !thinking) return;
      const msg: Message = { role: "assistant", agentId, text, thinking: thinking || undefined, ts: Date.now() };
      this.store.appendMessage(ctxId, msg);
      this.emit({ type: "assistant_end", ctxId, agentId, text: this.store.maskPaths(ctxId, text), thinking });
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

  private getCtxDir(ctxId: string): string {
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
      return (groups.find((g: any) => g.id === "subagents")?.tools ?? []).map((t: any) => t.name);
    } catch {
      return [];
    }
  }

  private piToolGroupsCache: any[] | null = null;
  async listPiTools(force = false): Promise<any[]> {
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
      const all = (session as any).getAllTools?.() ?? [];
      this.piToolGroupsCache = all.map((t: any) => ({ name: String(t.name), description: t.description ? String(t.description) : undefined }));
      try { (session as any).dispose?.(); } catch { /* ignore */ }
    } finally {
      fs.rmSync(probeDir, { recursive: true, force: true });
    }
    return this.piToolGroupsCache!;
  }

  resetAllSessions(): number {
    let n = 0;
    for (const [k, s] of [...this.sessions]) {
      try { s.abort(); s.dispose(); } catch { /* ignore */ }
      this.sessions.delete(k);
      n++;
    }
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
    let cfg: any;
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch { return; }
    const newModel = cfg.model || undefined;
    if (newModel !== this.defaultModel) {
      console.log(`[runner] модель по умолчанию обновлена: ${this.defaultModel ?? "(нет)"} → ${newModel ?? "(нет)"}`);
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