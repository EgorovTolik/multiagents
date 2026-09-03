import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
import { Type } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { AgentRegistry, type AgentDef } from "./registry";
import { ContextStore, type ContextMeta, type Handoff, type Message } from "./context-store";

export type Emit = (msg: unknown) => void;

/** Изображение, присланное пользователем в чат. */
export interface FileAttachment {
  name: string;       // filename, e.g. "screenshot.png"
  mediaType: string;  // MIME, e.g. "image/png"
  data: string;       // base64 (без префикса data:...)
  size: number;       // bytes
}

function isImage(att: FileAttachment): boolean {
  return att.mediaType.startsWith("image/");
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Лимит передач в одной цепочке — защита от циклов. */
const MAX_HANDOFFS = 200;

/**
 * Лимит автоматических восстановлений прерванной цепочки.
 * После него система перестаёт сама звать оркестратора и просит пользователя.
 */
const MAX_RECOVERIES = 2;

/** ID оркестратора — хаб цепочки; его «обрыв» (ответ пользователю) не считается прерыванием. */
const ORCHESTRATOR_ID = "orchestrator";

/** Таймаут без событий (дельта/сообщение/инструмент) — сессия считается зависшей. */
const STALL_TIMEOUT_MS = 3 * 60 * 1000;

function extractText(msg: unknown): string {
  const c = (msg as any)?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }
  return "";
}

function okText(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

function errText(text: string) {
  return { content: [{ type: "text", text: `Ошибка: ${text}` }], details: { isError: true } };
}

function buildSystemPrompt(def: AgentDef, workdir: string, globalRules: string[]): string {
  // Рабочая директория — динамическая, в самом начале, чтобы агент сразу знал, где работать.
  let p = "# Рабочая директория\n\n" + workdir + "\n";
  p += "\n" + def.systemPrompt;
  if (def.rules.length > 0) {
    p += "\n\n## Дополнительные правила\n\n" + def.rules.join("\n\n");
  }
  // Глобальные правила окружения (system/*.md) — общие для всех агентов.
  if (globalRules.length > 0) {
    p += "\n\n## Правила окружения\n\n" + globalRules.join("\n\n");
  }
  if (def.skills.length > 0) {
    p +=
      "\n\n## Навыки\n\n" +
      def.skills
        .map((s) => `- ${s.name}: ${s.description} (файл: ${s.path})`)
        .join("\n") +
      "\n\nПеред выполнением задачи, подходящей под навык, прочитай его файл.";
  }
  p +=
    "\n\n## Передача работы\n\n" +
    "Если следующий шаг задачи требует другой экспертизы, вызови инструмент route_to_agent — " +
    "диалог будет передан нужному агенту, а ты увидишь подтверждение. " +
    "Пользователь видит все передачи в интерфейсе и может их прерывать.";
  return p;
}

/**
 * Ядро системы: запуск агентов поверх pi SDK.
 *
 * Глобальный мьютекс: в любой момент времени работает ровно один агент
 * (локальный сервер с одной моделью). Остальные сообщения — в очередь.
 *
 * Handoff: route_to_agent лишь планирует передачу (pendingHandoff).
 * Она выполняется после завершения текущего хода: сервер переключает
 * активного агента контекста и шлёт новому агенту промпт с контекстом.
 */
export class AgentRunner {
  private sessions = new Map<string, AgentSession>();
  private active: { ctxId: string; agentId: string } | null = null;
  private queue: { ctxId: string; text: string; files?: FileAttachment[] }[] = [];
  private lastEventAt = 0;
  private modelRuntime: Awaited<ReturnType<typeof ModelRuntime.create>> | null = null;
  /** Глобальные правила окружения (system/*.md) — подставляются каждому агенту. */
  private globalRules: string[] = [];

  constructor(
    private registry: AgentRegistry,
    private store: ContextStore,
    private agentsDir: string,
    private systemDir: string,
    private defaultModel: string | undefined,
    private emit: Emit,
  ) {
    this.loadGlobalRules();
  }

  /** Читает системные файлы правил (system/*.md) в алфавитном порядке. */
  private loadGlobalRules() {
    this.globalRules = [];
    if (!fs.existsSync(this.systemDir)) return;
    for (const f of fs.readdirSync(this.systemDir).sort()) {
      if (!f.endsWith(".md")) continue;
      this.globalRules.push(fs.readFileSync(path.join(this.systemDir, f), "utf8"));
    }
  }

  async init() {
    this.modelRuntime = await ModelRuntime.create();
    // Watchdog: если активная сессия не генерирует событий дольше STALL_TIMEOUT_MS —
    // прерываем её (зависший запрос к модели, SDK-зацикливание и т.п.)
    setInterval(() => {
      if (!this.active) return;
      if (Date.now() - this.lastEventAt < STALL_TIMEOUT_MS) return;
      const { ctxId, agentId } = this.active;
      console.error(`[runner] сессия ${agentId} зависла (нет событий ${STALL_TIMEOUT_MS / 1000}с), прерываю`);
      this.emit({ type: "error", ctxId, message: `Агент ${agentId} завис — ход прерван watchdog'ом. Отправьте сообщение ещё раз.` });
      this.lastEventAt = Date.now(); // не спамим, пока сессия реально не завершится
      const session = this.sessions.get(this.key(ctxId, agentId));
      void session?.abort();
    }, 15000).unref();
  }

  getActive() {
    return this.active;
  }

  private key(ctxId: string, agentId: string) {
    return `${ctxId}/${agentId}`;
  }

  private resolveModel(id?: string) {
    if (!this.modelRuntime) return undefined;
    const spec = id ?? this.defaultModel;
    if (!spec) return undefined;
    const slash = spec.indexOf("/");
    if (slash < 0) return undefined;
    return this.modelRuntime.getModel(spec.slice(0, slash), spec.slice(slash + 1));
  }

  /** Входящее сообщение пользователя. */
  async handleMessage(ctxId: string, text: string, files?: FileAttachment[]) {
    const ctx = this.store.get(ctxId);
    if (!ctx) throw new Error("Контекст не найден: " + ctxId);

    // Сохраняем файлы в папку контекста + копии в системную папку previews/
    let savedPaths: string[] = [];
    let mdLinks: string[] = [];
    const PREVIEWS_DIR = path.join(PROJECT_ROOT, "previews");
    if (files && files.length > 0) {
      const filesDir = path.join(this.store.dir(ctxId), "files");
      fs.mkdirSync(filesDir, { recursive: true });
      fs.mkdirSync(PREVIEWS_DIR, { recursive: true });
      for (const f of files) {
        const ext = path.extname(f.name) || ".bin";
        const now = new Date();
        const p2 = (n: number) => String(n).padStart(2, "0");
        const stamp = `${p2(now.getDate())}.${p2(now.getMonth()+1)}.${now.getFullYear()}-${p2(now.getHours())}.${p2(now.getMinutes())}.${p2(now.getSeconds())}`;
        const fname = `${now.getTime()}-${stamp}${ext}`;
        const buf = Buffer.from(f.data, "base64");
        fs.writeFileSync(path.join(filesDir, fname), buf);
        savedPaths.push(path.join("files", fname));
        fs.writeFileSync(path.join(PREVIEWS_DIR, fname), buf);
        if (isImage(f)) {
          mdLinks.push(`![${fname}](/api/previews/${fname})`);
        } else {
          mdLinks.push(`[📄 ${fname} (${fmtSize(f.size)})](/api/previews/${fname})`);
        }
      }
    }

    const fullText = savedPaths.length > 0
      ? (text + "\n\n" + mdLinks.join("\n") + "\n\n[Файлы: " + savedPaths.join(", ") + "]")
      : text;

    if (ctx.awaitingUser) {
      const { agentId } = ctx.awaitingUser;
      ctx.awaitingUser = undefined;
      ctx.aborted = false;
      ctx.activeAgentId = agentId;
      this.store.save(ctx);
      const msg: Message = { role: "user", agentId, text: fullText, ts: Date.now() };
      this.store.appendMessage(ctxId, msg);
      this.emit({ type: "message", ctxId, message: msg });
      if (this.active) {
        this.queue.push({ ctxId, text: fullText, files });
      } else {
        void this.run(ctxId, fullText, files);
      }
      return;
    }

    if (ctx.activeAgentId === ORCHESTRATOR_ID) {
      ctx.inChain = false;
      ctx.recoveryCount = 0;
    }
    ctx.aborted = false;
    this.store.save(ctx);
    const msg: Message = {
      role: "user",
      agentId: ctx.activeAgentId,
      text: fullText,
      ts: Date.now(),
    };
    this.store.appendMessage(ctxId, msg);
    this.emit({ type: "message", ctxId, message: msg });
    if (this.active) {
      this.queue.push({ ctxId, text: fullText, files });
    } else {
      void this.run(ctxId, fullText, files);
    }
  }

  /** Уничтожить сессии агентов контекста (при удалении контекста). */
  disposeContext(ctxId: string) {
    for (const [k, s] of [...this.sessions]) {
      if (k.startsWith(ctxId + "/")) {
        try {
          s.dispose();
        } catch {
          // ignore
        }
        this.sessions.delete(k);
      }
    }
  }

  /** Прервать текущий ход (и отменить запланированную передачу). */
  abort() {
    if (!this.active) return;
    const { ctxId, agentId } = this.active;
    const ctx = this.store.get(ctxId);
    if (ctx) {
      ctx.pendingHandoff = undefined;
      ctx.aborted = true;
      ctx.inChain = false;
      ctx.recoveryCount = 0;
      this.store.save(ctx);
      this.emit({ type: "handoff_cancelled", ctxId });
      const sysMsg: Message = {
        role: "system",
        text: "⏹ Остановлено пользователем",
        ts: Date.now(),
      };
      this.store.appendMessage(ctxId, sysMsg);
      this.emit({ type: "message", ctxId, message: sysMsg });
    }
    const session = this.sessions.get(this.key(ctxId, agentId));
    void session?.abort();
  }

  /** Отменить запланированную передачу (текущий ход ещё идёт). */
  cancelHandoff(ctxId: string) {
    const ctx = this.store.get(ctxId);
    if (!ctx?.pendingHandoff) return;
    ctx.pendingHandoff = undefined;
    this.store.save(ctx);
    this.emit({ type: "handoff_cancelled", ctxId });
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
    this.active = { ctxId, agentId };
    this.emit({ type: "run_start", ctxId, agentId });
    try {
      const session = await this.getSession(ctxId, agentId, def);
      // Только изображения передаём как мультимодальный ввод; файлы — через путь в тексте
      const imageFiles = files?.filter(isImage) ?? [];
      const promptOpts = imageFiles.length > 0
        ? { images: imageFiles.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mediaType })) }
        : undefined;
      await session.prompt(text, promptOpts);
    } catch (e: any) {
      console.error("[runner] run error:", e);
      this.emit({ type: "error", ctxId, message: String(e?.message ?? e) });
    } finally {
      this.active = null;
      this.emit({ type: "run_end", ctxId, agentId });

      // Перечитываем контекст с диска: route_to_agent мог запланировать
      // передачу, записав её в другой экземпляр ContextMeta
      const ctx = this.store.get(ctxId)!;
      const pending = ctx.pendingHandoff;
      ctx.pendingHandoff = undefined;
      if (pending && this.registry.get(pending.to)) {
        this.doHandoff(ctxId, ctx, pending, this.buildHandoffPrompt(pending));
        return;
      }

      // Если agent-creator завершил ход — перечитываем реестр: агент мог создать
      // агента вручную (bash/write), не через create_agent. Рассылаем обновлённый
      // список, чтобы UI сразу отразил изменения.
      if (agentId === "agent-creator") {
        this.registry.reload();
        this.emit({ type: "agents", agents: this.registry.list() });
      }

      // Обрыв цепочки: агент был «в цепочке» (ход запущен handoff'ом), но
      // завершил ход без route_to_agent. Зовём оркестратора на автопроверку.
      // Исключение: агент ждёт ответа пользователя (ask_user) — это не прерывание.
      if (ctx.inChain && agentId !== ORCHESTRATOR_ID && !ctx.awaitingUser && !ctx.aborted) {
        const recoveries = ctx.recoveryCount ?? 0;
        if (recoveries < MAX_RECOVERIES) {
          const task = ctx.handoffs[ctx.handoffs.length - 1];
          const lastMsg = this.lastAssistantMessage(ctxId, agentId);
          const handoff: Handoff = {
            from: agentId,
            to: ORCHESTRATOR_ID,
            reason: "⚠️ Цепочка прервалась — автопроверка",
            context: lastMsg ?? "(агент не оставил завершённого сообщения)",
            ts: Date.now(),
          };
          ctx.recoveryCount = recoveries + 1;
          this.doHandoff(ctxId, ctx, handoff, this.buildRecoveryPrompt(agentId, task, lastMsg));
          return;
        }
        // Лимит восстановлений исчерпан — просим пользователя
        const sysMsg: Message = {
          role: "system",
          text: `⚠️ Цепочка прервалась ${MAX_RECOVERIES} раза подряд — автоматическое восстановление остановлено. Отправьте сообщение, чтобы продолжить.`,
          ts: Date.now(),
        };
        this.store.appendMessage(ctxId, sysMsg);
        this.emit({ type: "message", ctxId, message: sysMsg });
      }

      // Цепочка завершена (нет передачи, нет recovery) — возвращаем очередь оркестратору
      if (ctx.activeAgentId !== ORCHESTRATOR_ID && !ctx.awaitingUser) {
        ctx.activeAgentId = ORCHESTRATOR_ID;
        ctx.inChain = false;
      }
      this.store.save(ctx);
      const next = this.queue.shift();
      if (next) void this.run(next.ctxId, next.text, next.files);
    }
  }

  /** Последний завершённый ответ агента (для промпта восстановления). */
  private lastAssistantMessage(ctxId: string, agentId: string): string | undefined {
    const msgs = this.store.readMessages(ctxId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "assistant" && m.agentId === agentId && m.text.trim()) return m.text;
    }
    return undefined;
  }

  /** Промпт для агента, которому передают диалог (обычный handoff). */
  private buildHandoffPrompt(pending: Handoff): string {
    return (
      `Диалог передан агентом ${pending.from}.\n` +
      `Причина: ${pending.reason}\n\n` +
      `Контекст задачи:\n${pending.context}\n\n` +
      `Продолжай работу. Если следующий шаг снова требует другой экспертизы — передай диалог дальше через route_to_agent.`
    );
  }

  /** Промпт для оркестратора при обрыве цепочки (режим восстановления). */
  private buildRecoveryPrompt(agentId: string, task: Handoff | undefined, lastMsg: string | undefined): string {
    return (
      `⚠️ ЦЕПОЧКА ПРЕРВАЛАСЬ. Агент ${agentId} завершил ход, не вызвав route_to_agent.\n\n` +
      `Ему было передано задание от ${task?.from ?? "?"}:\n` +
      `— Причина: ${task?.reason ?? "неизвестно"}\n` +
      `— Контекст: ${task?.context ?? "неизвестно"}\n\n` +
      `Последнее сообщение агента ${agentId}:\n${lastMsg ?? "(нет)"}\n\n` +
      `Ты входишь в РЕЖИМ ВОССТАНОВЛЕНИЯ. Проверь фактическое состояние (разреши себе использовать read/bash):\n` +
      `1. Если работа полностью завершена — передай дальше по цепочке через route_to_agent (если есть следующий шаг) или кратко сообщи пользователю итог, если цепочка закончена.\n` +
      `2. Если работа НЕ завершена — составь корректирующий промпт с учётом изначального задания и уже сделанного, и перезапусти агента ${agentId} через route_to_agent.`
    );
  }

  /** Выполнить передачу: переключить агента, записать в лог, запустить нового. */
  private doHandoff(ctxId: string, ctx: ContextMeta, handoff: Handoff, prompt: string) {
    ctx.activeAgentId = handoff.to;
    ctx.handoffs.push(handoff);
    ctx.inChain = true;
    this.store.save(ctx);
    const sysMsg: Message = {
      role: "system",
      text: `Передача: ${handoff.from} → ${handoff.to} — ${handoff.reason}`,
      ts: Date.now(),
    };
    this.store.appendMessage(ctxId, sysMsg);
    this.emit({ type: "handoff", ctxId, handoff });
    this.emit({ type: "message", ctxId, message: sysMsg });
    void this.run(ctxId, prompt);
  }

  private async getSession(ctxId: string, agentId: string, def: AgentDef) {
    const k = this.key(ctxId, agentId);
    const existing = this.sessions.get(k);
    if (existing) return existing;

    const ctxDir = this.store.dir(ctxId);
    const loader = new DefaultResourceLoader({
      cwd: ctxDir,
      agentDir: getAgentDir(),
      systemPromptOverride: () => buildSystemPrompt(def, ctxDir, this.globalRules),
    });
    await loader.reload();

    const customTools = [
      this.makeListAgentsTool(),
      this.makeRouteTool(ctxId, agentId),
      this.makeAskUserTool(ctxId, agentId),
    ];
    const toolNames = [...(def.tools ?? ["read", "bash", "edit", "write"]), "route_to_agent", "list_agents", "ask_user"];
    if (agentId === "agent-creator") {
      customTools.push(this.makeCreateAgentTool());
      customTools.push(this.makeDeleteAgentTool());
      toolNames.push("create_agent", "delete_agent");
    }

    const { session } = await createAgentSession({
      cwd: ctxDir,
      model: this.resolveModel(def.model),
      // tools — это allowlist: кастомные инструменты нужно включить явно
      tools: toolNames,
      customTools,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(ctxDir),
    });

    // КРИТИЧНО для MCP: в headless-контексте SDK не отправляет событие
    // session_start, а оно нужно расширениям (pi-mcp-adapter) для инициализации
    // MCP-соединения. Вызываем bindExtensions с пустыми биндингами — это
    // отправит session_start и запустит подключение к MCP-серверам.
    try {
      await session.bindExtensions({});
    } catch (e) {
      // не критично — агент продолжит без MCP
      console.error("bindExtensions failed:", e);
    }

    // Восстановление контекста после перезапуска сервера:
    // проигрываем историю чата в новую сессию.
    try {
      const history = this.store
        .readMessages(ctxId)
        .filter((m) => m.role === "user" || m.role === "assistant");
      if (history.length > 0) {
        session.agent.state.messages = history.map((m) => ({
          role: m.role,
          content: [{ type: "text", text: m.text }],
        })) as any;
      }
    } catch {
      // не критично — агент продолжит без истории
    }

    session.subscribe((ev: any) => this.forward(ctxId, agentId, ev));
    this.sessions.set(k, session);
    return session;
  }

  private forward(ctxId: string, agentId: string, ev: any) {
    if (ev.type === "message_update" || ev.type === "message_start" || ev.type === "message_end" || ev.type === "tool_execution_start" || ev.type === "tool_execution_end") {
      this.lastEventAt = Date.now();
    }
    if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
      this.emit({ type: "delta", ctxId, agentId, text: ev.assistantMessageEvent.delta });
    } else if (ev.type === "message_end" && ev.message?.role === "assistant") {
      const text = extractText(ev.message);
      if (!text) return;
      const msg: Message = { role: "assistant", agentId, text, ts: Date.now() };
      this.store.appendMessage(ctxId, msg);
      // клиенту — без локальных путей, со ссылками на скачивание
      this.emit({ type: "assistant_end", ctxId, agentId, text: this.store.maskPaths(ctxId, text) });
    }
  }

  // ─── Инструменты агентов ───────────────────────────────────────────────

  private makeListAgentsTool() {
    return defineTool({
      name: "list_agents",
      label: "Список агентов",
      description:
        "Показывает всех агентов системы с их описаниями. Вызывай перед route_to_agent, чтобы выбрать, кому передать диалог.",
      parameters: Type.Object({}),
      execute: async () => {
        const lines = this.registry
          .list()
          .map((a) => `- ${a.id}: ${a.description}`);
        return okText("Агенты системы:\n" + lines.join("\n"));
      },
    });
  }

  private makeRouteTool(ctxId: string, agentId: string) {
    return defineTool({
      name: "route_to_agent",
      label: "Передача диалога",
      description:
        "Передаёт диалог другому агенту с более подходящей экспертизой. Вызывай, когда следующий шаг задачи требует другой компетенции. " +
        "Текущий ход завершится, и целевой агент продолжит работу с переданным контекстом.",
      parameters: Type.Object({
        agentId: Type.String({
          description: "ID целевого агента (см. list_agents)",
        }),
        reason: Type.String({
          description: "Короткая причина передачи (покажется пользователю в интерфейсе)",
        }),
        context: Type.String({
          description:
            "Саммари контекста задачи для нового агента: цель, что уже сделано, что нужно сделать. Новый агент увидит только это.",
        }),
      }),
      execute: async (_id, params: { agentId: string; reason: string; context: string }) => {
        const target = this.registry.get(params.agentId);
        if (!target) {
          return errText(
            `Агент "${params.agentId}" не найден. Доступны: ${this.registry
              .list()
              .map((a) => a.id)
              .join(", ")}`,
          );
        }
        if (params.agentId === agentId) {
          return errText("Этот диалог уже обрабатывает данный агент");
        }
        const ctx = this.store.get(ctxId)!;
        if (ctx.handoffs.length >= MAX_HANDOFFS) {
          return errText(
            `Достигнут лимит передач в цепочке (${MAX_HANDOFFS}). Продолжи работу сам.`,
          );
        }
        const handoff: Handoff = {
          from: agentId,
          to: params.agentId,
          reason: params.reason,
          context: params.context,
          ts: Date.now(),
        };
        ctx.pendingHandoff = handoff;
        this.store.save(ctx);
        this.emit({ type: "handoff_pending", ctxId, handoff });
        return okText(
          `Передача запланирована: после завершения текущего шага диалог будет передан агенту "${params.agentId}" (${target.description}). ` +
            `Пользователь видит передачу в интерфейсе и может её отменить. Заверши текущий ход.`,
        );
      },
    });
  }

  /**
   * ask_user: агент задаёт вопрос пользователю и ждёт ответа.
   * Ставит флаг awaitingUser — обрыв хода НЕ считается прерыванием цепочки,
   * а ответ пользователя уходит этому агенту (см. handleMessage).
   */
  private makeAskUserTool(ctxId: string, agentId: string) {
    return defineTool({
      name: "ask_user",
      label: "Спросить пользователя",
      description:
        "Задаёт вопрос пользователю и ждёт его ответа. Вызывай, когда не хватает информации для продолжения (уточнение требований, выбор варианта, подтверждение). " +
        "Текущий ход завершится, пользователь увидит вопрос и ответит. Ответ придёт тебе в следующем сообщении — продолжи работу с ним.",
      parameters: Type.Object({
        question: Type.String({
          description: "Вопрос к пользователю (чёткий, конкретный, с вариантами если есть)",
        }),
      }),
      execute: async (_id, params: { question: string }) => {
        const ctx = this.store.get(ctxId)!;
        ctx.awaitingUser = { agentId, question: params.question };
        this.store.save(ctx);
        this.emit({ type: "ask_user", ctxId, agentId, question: params.question });
        // Системное сообщение, чтобы оркестратор (в режиме восстановления)
        // понимал, что агент спрашивал пользователя, а не «запутался».
        const sysMsg: Message = {
          role: "system",
          text: `❓ ${agentId} задал вопрос пользователю: «${params.question}» — ждёт ответа. Это НЕ прерывание цепочки.`,
          ts: Date.now(),
        };
        this.store.appendMessage(ctxId, sysMsg);
        this.emit({ type: "message", ctxId, message: sysMsg });
        return okText(
          `Вопрос отправлен пользователю: «${params.question}». ЗАВЕРШИ ХОД — не продолжай работу и не вызывай другие инструменты. Ответ пользователя придёт в следующем сообщении.`,
        );
      },
    });
  }

  private makeCreateAgentTool() {
    return defineTool({
      name: "create_agent",
      label: "Создать агента",
      description:
        "Создаёт нового агента в системе: записывает его системный промпт, правила и навыки в agents/<name>/ и регистрирует. " +
        "Оркестратор сразу увидит нового агента через list_agents.",
      parameters: Type.Object({
        name: Type.String({
          description: "ID агента: нижний регистр, дефисы (например code-reviewer)",
        }),
        description: Type.String({
          description:
            "Короткое описание (1-2 предложения). По нему оркестратор решает, когда передавать диалог этому агенту.",
        }),
        systemPrompt: Type.String({
          description:
            "Системный промпт: роль, возможности, правила работы. Должен быть самодостаточным.",
        }),
        rules: Type.Optional(
          Type.Array(
            Type.Object({
              name: Type.String({ description: "Короткое имя правила" }),
              content: Type.String({ description: "Текст правила" }),
            }),
          ),
        ),
        skills: Type.Optional(
          Type.Array(
            Type.Object({
              name: Type.String({ description: "Имя навыка" }),
              description: Type.String({ description: "Когда применять навык" }),
              content: Type.String({ description: "Инструкция навыка (markdown)" }),
            }),
          ),
        ),
      }),
      execute: async (_id, params) => {
        try {
          const def = this.registry.create(params);
          // Рассылаем обновлённый список агентов, чтобы UI сразу показал нового.
          this.emit({ type: "agents", agents: this.registry.list() });
          return okText(
            `Агент "${def.id}" создан и зарегистрирован. Директория: ${path.join(this.agentsDir, def.id)}. ` +
              `Оркестратор уже видит его в list_agents.`,
          );
        } catch (e: any) {
          return errText(String(e?.message ?? e));
        }
      },
    });
  }

  /**
   * delete_agent: агент-создатель удаляет агента.
   * Программная защита: системные агенты (orchestrator, agent-creator) не удаляются —
   * даже если пользователь очень сильно просит.
   */
  private makeDeleteAgentTool() {
    return defineTool({
      name: "delete_agent",
      label: "Удалить агента",
      description:
        "Удаляет агента из системы (директорию agents/<name>/ и регистрацию). " +
        "Системные агенты (orchestrator, agent-creator) удалить нельзя — инструмент вернёт ошибку. " +
        "Перед удалением обязательно спроси пользователя через ask_user и получи подтверждение.",
      parameters: Type.Object({
        name: Type.String({
          description: "ID агента для удаления",
        }),
      }),
      execute: async (_id, params: { name: string }) => {
        try {
          this.registry.delete(params.name);
          // Рассылаем обновлённый список агентов, чтобы UI сразу отразил удаление.
          this.emit({ type: "agents", agents: this.registry.list() });
          return okText(`Агент "${params.name}" удалён.`);
        } catch (e: any) {
          return errText(String(e?.message ?? e));
        }
      },
    });
  }

  /**
   * Генерирует короткое название контекста на основе первого сообщения.
   * Использует отдельную сессию (не оркестратор), чтобы не мешать основному потоку.
   */
  /**
   * Генерирует короткое название контекста из первого сообщения.
   * Не использует модель — просто обрезает текст (локальная модель ненадёжна для этой задачи).
   */
  generateName(_ctxId: string, firstMessage: string): string | null {
    // Убираем markdown, кавычки, лишние пробелы
    const clean = firstMessage
      .replace(/[#*`~>]/g, "")
      .replace(/^[«"'"']+|[»"'"']+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return null;
    // Берём до 40 символов, обрезаем по границе слова
    const max = 40;
    let name = clean;
    if (name.length > max) {
      name = name.slice(0, max);
      const lastSpace = name.lastIndexOf(" ");
      if (lastSpace > 15) name = name.slice(0, lastSpace);
      name += "…";
    }
    return name || null;
  }
}
