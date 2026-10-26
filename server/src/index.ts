import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import express from "express";
import { WebSocketServer } from "ws";
import * as archiver from "archiver";
import { AgentRegistry } from "./registry";
import { SkillRegistry } from "./skill-registry";
import { ContextStore } from "./context-store";
import { AgentRunner } from "./runner";
import {
  notFoundError,
  validationError,
  conflictError,
  internalError,
  networkError,
  toErrorObject,
} from "./error-types";
import { validateParam, parseModelList, readMarkdownDir, syncMarkdownDir, readJson } from "./utils";
import { createAgentsRouter } from "./api/agents";
import { createContextsRouter } from "./api/contexts";
import { createPlansRouter } from "./api/plans";
import { createTrainingRouter } from "./api/training";
import { createFilesRouter } from "./api/files";
import { createSkillsRouter } from "./api/skills";
import { createToolsRouter } from "./api/tools";
import { createSessionsRouter } from "./api/sessions";
import { createConfigRouter } from "./api/config";
import { createProvidersRouter } from "./api/providers";
import { createMistakesRouter } from "./api/mistakes";
import type { ClientToServerMessage, ArchiveState } from "./ws-types";

interface ServerConfig {
  port?: number;
  model?: string;
  providers?: Record<string, { url?: string; apiKey?: string }>;
  apiKeys?: Record<string, string>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

const config: ServerConfig = readJson(path.join(root, "config.json"), {});

const PORT = config.port ?? 3000;
const AGENTS_DIR = path.join(root, "agents");
const SKILLS_DIR = path.join(root, "skills");
const CONTEXTS_DIR = path.join(root, "contexts");
/** Общее хранилище артефактов — «долговременная память», доступная всем агентам и контекстам. */
const SHARED_DIR = path.join(root, "shared");
const SYSTEM_DIR = path.join(root, "system");
const ARCHIVES_DIR = path.join(root, "archives");
fs.mkdirSync(ARCHIVES_DIR, { recursive: true });

// Записываем API-ключи из config.json в agents/auth.json (pi SDK ищет их там)
// Поддерживает обе структуры: legacy apiKeys и новую providers
function syncAuthKeys(): void {
  const authPath = path.join(AGENTS_DIR, "auth.json");
  let existing: Record<string, unknown> = readJson(authPath, {});

  // Новая структура: providers: { id: { url, apiKey } }
  const providers: Record<string, { url?: string; apiKey?: string }> = config.providers ?? {};
  for (const [provider, cfg] of Object.entries(providers)) {
    if (cfg.apiKey) {
      existing[provider] = { type: "api_key", key: cfg.apiKey };
    }
  }
  // Legacy: apiKeys: { id: "key" }
  const apiKeys: Record<string, string> = config.apiKeys ?? {};
  for (const [provider, key] of Object.entries(apiKeys)) {
    existing[provider] = { type: "api_key", key };
  }

  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  fs.writeFileSync(authPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
}
syncAuthKeys();

const registry = new AgentRegistry(AGENTS_DIR);
const skillRegistry = new SkillRegistry(SKILLS_DIR);
const store = new ContextStore(CONTEXTS_DIR, "orchestrator");

// Pi-сессии живут только в памяти — при старте сервера их нет ни у одного агента,
// а тела навыков в messages.jsonl не сохраняются. Сбрасываем флаги «навык передан»:
// при следующем обращении каждый агент получит навыки своего контекста заново.
for (const c of store.list()) {
  if (c.deliveredSkills && Object.keys(c.deliveredSkills).length > 0) {
    store.resetDeliveredSkills(c);
    store.save(c);
  }
}

const broadcast = (msg: unknown) => {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
};

// === Очередь подготовки архивов контекстов (FIFO, по одному за раз) ===


function zipDir(srcDir: string, outPath: string, topFolder: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      try { fs.unlinkSync(outPath); } catch { /* ignore */ }
      reject(e);
    };
    output.on("close", () => { if (!settled) { settled = true; resolve(); } });
    archive.on("error", fail);
    output.on("error", fail);
    archive.pipe(output);
    archive.directory(srcDir, topFolder);
    archive.finalize();
  });
}

class ArchiveQueue {
  private queue: string[] = [];
  private pending = new Set<string>(); // ctxId в очереди или в работе
  private processing = false;

  constructor(private emit: (msg: unknown) => void) {}

  private status(ctxId: string, state: ArchiveState, extra: { url?: string; error?: string } = {}) {
    this.emit({ type: "archive_status", ctxId, state, ...extra });
  }

  /** Возвращает true, если задание добавлено; false — если уже в очереди/в работе */
  enqueue(ctxId: string): boolean {
    if (this.pending.has(ctxId)) return false;
    this.pending.add(ctxId);
    this.queue.push(ctxId);
    this.status(ctxId, "queued");
    void this.process();
    return true;
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const ctxId = this.queue.shift()!;
        await this.run(ctxId);
      }
    } finally {
      this.processing = false;
    }
  }

  private async run(ctxId: string) {
    const ctxDir = path.join(CONTEXTS_DIR, ctxId);
    if (!fs.existsSync(ctxDir)) {
      this.pending.delete(ctxId);
      this.status(ctxId, "error", { error: "Контекст не найден" });
      return;
    }
    const file = `${ctxId}-${Date.now()}.zip`;
    const outPath = path.join(ARCHIVES_DIR, file);
    this.status(ctxId, "preparing");
    try {
      await zipDir(ctxDir, outPath, ctxId);
      this.pending.delete(ctxId);
      this.status(ctxId, "ready", { url: `/api/archive?ctx=${encodeURIComponent(ctxId)}&file=${encodeURIComponent(file)}` });
    } catch (e) {
      this.pending.delete(ctxId);
      const err = toErrorObject(e);
      this.status(ctxId, "error", { error: err.message });
    }
  }
}

const archiveQueue = new ArchiveQueue(broadcast);

// Очистка архивов старше 24 часов — при старте и раз в час
function cleanupArchives() {
  const now = Date.now();
  for (const f of fs.readdirSync(ARCHIVES_DIR)) {
    const full = path.join(ARCHIVES_DIR, f);
    try {
      if (now - fs.statSync(full).mtimeMs > 24 * 3600 * 1000) fs.unlinkSync(full);
    } catch { /* ignore */ }
  }
}
cleanupArchives();
setInterval(cleanupArchives, 3600 * 1000).unref();

const runner = new AgentRunner(
  registry,
  store,
  skillRegistry,
  AGENTS_DIR,
  SYSTEM_DIR,
  SHARED_DIR,
  config.model || undefined,
  broadcast,
  (config.providers ?? {}) as Record<string, { url?: string; apiKey?: string }>,
);

const app = express();

// Correlation ID middleware — добавляет reqId к каждому запросу для трассировки логов
app.use((req, res, next) => {
  const reqId = randomUUID();
  (req as any).id = reqId;
  console.log(`[${reqId}] ${req.method} ${req.url}`);
  
  const startTime = Date.now();
  res.on("finish", () => {
    console.log(`[${reqId}] ${res.statusCode} in ${Date.now() - startTime}ms`);
  });
  
  next();
});

app.use(express.json({ limit: "50mb" })); // JSON body parser (включая большие файлы)

const CONFIG_PATH = path.join(root, "config.json");
/** Кеш моделей провайдеров: { providerId: { models: string[], fetchedAt: number } } */
const modelsCache: Record<string, { models: string[]; fetchedAt: number }> = {};

// Подключение API роутеров
app.use(createAgentsRouter(registry, AGENTS_DIR, broadcast));
app.use(createContextsRouter(store));
app.use(createPlansRouter(runner));
app.use(createTrainingRouter(store, runner, registry, broadcast));
app.use(createFilesRouter(store, root, CONTEXTS_DIR, ARCHIVES_DIR));
app.use(createSkillsRouter(skillRegistry, broadcast));
app.use(createToolsRouter(runner));
app.use(createSessionsRouter(runner, CONFIG_PATH, broadcast));
app.use(createConfigRouter(runner, CONFIG_PATH, modelsCache, syncAuthKeys));
app.use(createProvidersRouter(CONFIG_PATH, modelsCache));
app.use(createMistakesRouter(store));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });









/** Проверить, доступен ли агент для обучения (не в пайпе и не в другой обучающей сессии). */
function isAgentAvailableForTraining(agentId: string): { available: boolean; reason?: string } {
  // Проверяем, не работает ли агент сейчас в каком-то чате
  for (const active of runner.getActives()) {
    if (active.agentId === agentId) {
      return { available: false, reason: `Агент «${agentId}» сейчас работает` };
    }
  }
  // Проверяем, нет ли у агента уже активной обучающей сессии
  const contexts = store.list();
  for (const ctx of contexts) {
    if (ctx.trainingAgentId === agentId && !ctx.handoffs.length) {
      return { available: false, reason: `У агента «${agentId}» уже есть обучающая сессия` };
    }
  }
  return { available: true };
}

// === Обучающие сессии: REST API ===


wss.on("connection", (ws) => {
  const send = (msg: unknown) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };

  send({ type: "agents", agents: registry.list() });
  send({ type: "skills", skills: skillRegistry.list() });
  // Фильтруем обучающие сессии и сессии работы над ошибками из основного списка
  const allContexts = store.list();
  const regularContexts = allContexts.filter((c) => !c.trainingAgentId && !c.flowMistakesOfCtxId);
  send({ type: "contexts", contexts: regularContexts });
  send({ type: "run_state", actives: runner.getActives() });

  ws.on("message", async (raw) => {
    let msg: ClientToServerMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {
      switch (msg.type) {
        case "list_contexts":
          // Фильтруем обучающие и flow-mistakes сессии из основного списка
          const allCtx = store.list();
          const regularCtx = allCtx.filter((c) => !c.trainingAgentId && !c.flowMistakesOfCtxId);
          send({ type: "contexts", contexts: regularCtx });
          break;
        case "create_context": {
          const c = store.create(msg.name ?? "Новая задача");
          send({ type: "context_created", context: c });
          break;
        }
        case "delete_context": {
          const ctx = store.get(msg.ctxId);
          if (!ctx) break;
          runner.abort(msg.ctxId);
          runner.disposeContext(msg.ctxId);
          store.delete(msg.ctxId);
          broadcast({ type: "context_deleted", ctxId: msg.ctxId });
          break;
        }
        case "load_context": {
          const messages = store
            .readMessages(msg.ctxId)
            .map((m) => (m.role === "assistant" ? { ...m, text: store.maskPaths(msg.ctxId, m.text) } : m));
          // Если агент занят стримингом — включаем частичное сообщение
          const stream = runner.getPendingStream(msg.ctxId);
          if (stream) {
            messages.push({
              role: "assistant",
              agentId: stream.agentId,
              text: store.maskPaths(msg.ctxId, stream.text),
              thinking: stream.thinking,
              ts: Date.now(),
              streaming: true,
            });
          }
          send({
            type: "context_loaded",
            context: store.get(msg.ctxId),
            messages,
          });
          break;
        }
        case "rename_context": {
          const ctx = store.get(msg.ctxId);
          if (ctx) {
            ctx.name = String(msg.name ?? "").trim() || ctx.name;
            store.save(ctx);
            broadcast({ type: "context_renamed", ctxId: ctx.id, name: ctx.name });
          }
          break;
        }
        case "truncate_history": {
          const idx = Number(msg.fromIndex ?? 0);
          if (Number.isInteger(idx) && idx >= 0) {
            store.truncateHistory(msg.ctxId, idx);
            runner.invalidateContext(msg.ctxId); // сбрасываем кэш сессий — история перечитается из файла
            broadcast({ type: "history_truncated", ctxId: msg.ctxId });
          }
          break;
        }
        case "message": {
          send({ type: "message_received", ctxId: msg.ctxId });
          // Автоименование: если контекст "Новый чат" — генерируем имя в фоне
          const ctx = store.get(msg.ctxId);
          if (ctx && ctx.name === "Новый чат") {
            const name = runner.generateName(msg.ctxId, msg.text);
            if (name) {
              ctx.name = name;
              store.save(ctx);
              broadcast({ type: "context_renamed", ctxId: ctx.id, name });
            }
          }
          // Если это завершённая обучающая сессия — автоматически переоткрываем её
          let trainingCtx = store.getTraining(msg.ctxId);
          if (trainingCtx && trainingCtx.completed) {
            trainingCtx.completed = false;
            store.save(trainingCtx, "training");
            broadcast({ type: "training_session_reopened", sessionId: msg.ctxId });
          }
          await runner.handleMessage(
            msg.ctxId,
            msg.text,
            msg.files?.map((f) => ({ name: f.filename, data: f.content, mediaType: "", size: f.content.length }))
          );
          break;
        }
        case "prepare_archive": {
          const added = archiveQueue.enqueue(String(msg.ctxId ?? ""));
          if (!added) send({ type: "archive_status", ctxId: msg.ctxId, state: "queued" as ArchiveState });
          break;
        }
        case "abort":
          runner.abort(String(msg.ctxId ?? ""));
          break;
        case "cancel_handoff":
          runner.cancelHandoff(msg.ctxId);
          break;
        case "apply_skills": {
          const ids = Array.isArray(msg.skills) ? msg.skills.map((s: unknown) => String(s)) : [];
          const meta = store.applySkills(String(msg.ctxId ?? ""), ids);
          send({ type: "skills_applied", ctxId: meta.id, skills: meta.skills ?? [] });
          break;
        }
        default: {
          const ex = msg as { type: string };
          send({ type: "error", message: "Неизвестный тип: " + ex.type });
          break;
        }
      }
    } catch (e) {
      const err = toErrorObject(e);
      send({ type: "error", message: err.message, error: err });
    }
  });
});

runner.init().then(() => {
  // 0.0.0.0 — принимать подключения с любого интерфейса (не только localhost)
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`multiagents: http://0.0.0.0:${PORT} (доступен с других устройств по IP машины)`);
    console.log(`Агентов в реестре: ${registry.list().map((a) => a.id).join(", ")}`);
  });
});
