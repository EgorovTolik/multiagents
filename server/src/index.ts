import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import * as archiver from "archiver";
import { AgentRegistry } from "./registry";
import { SkillRegistry } from "./skill-registry";
import { ContextStore } from "./context-store";
import { AgentRunner } from "./runner";
import { validateParam, parseModelList, readMarkdownDir, syncMarkdownDir, readJson } from "./utils";

/** Требует существующую обучающую сессию; если не найдена — отвечает 400/404 и завершает запрос. */
function requireTrainingSession(sessionId: string, res: express.Response) {
  if (!validateParam(sessionId)) {
    res.status(400).json({ error: "Некорректный ID сессии" });
    return null;
  }
  const ctx = store.getTraining(sessionId);
  if (!ctx) {
    res.status(404).json({ error: `Сессия «${sessionId}» не найдена` });
    return null;
  }
  if (!ctx.trainingAgentId) {
    res.status(400).json({ error: "Это не обучающая сессия" });
    return null;
  }
  return ctx;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

const config = readJson(path.join(root, "config.json"), {});

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
type ArchiveState = "queued" | "preparing" | "ready" | "error";

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
    } catch (e: any) {
      this.pending.delete(ctxId);
      this.status(ctxId, "error", { error: String(e?.message ?? e) });
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
app.use(express.json({ limit: "50mb" })); // JSON body parser (включая большие файлы)
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Скачивание файлов из директории контекста (без выхода за её пределы)
app.get("/api/files", (req, res) => {
  const ctxId = String(req.query.ctx ?? "");
  const rel = String(req.query.path ?? "");
  if (!ctxId || !rel) {
    res.status(400).json({ error: "missing ctx or path" });
    return;
  }
  const ctxDir = path.join(CONTEXTS_DIR, ctxId);
  const full = path.resolve(ctxDir, rel);
  if (full !== ctxDir && !full.startsWith(ctxDir + path.sep)) {
    res.status(400).json({ error: "bad path" });
    return;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.download(full);
});

// Размеры директорий контекстов в байтах: { [ctxId]: number } — для тултипов в UI
app.get("/api/context-sizes", (_req, res) => {
  const sizes: Record<string, number> = {};
  if (fs.existsSync(CONTEXTS_DIR)) {
    for (const e of fs.readdirSync(CONTEXTS_DIR, { withFileTypes: true })) {
      if (e.isDirectory()) sizes[e.name] = store.dirSize(e.name);
    }
  }
  res.json(sizes);
});

// Скачивание готового архива контекста
app.get("/api/archive", (req, res) => {
  const ctxId = String(req.query.ctx ?? "");
  const file = String(req.query.file ?? "");
  if (!ctxId || !file) {
    res.status(400).json({ error: "missing ctx or file" });
    return;
  }
  // Файл должен принадлежать этому контексту и быть zip-архивом
  if (!file.startsWith(ctxId + "-") || !file.endsWith(".zip") || file.includes("/") || file.includes("..") || file.includes("\\")) {
    res.status(400).json({ error: "bad file" });
    return;
  }
  const full = path.join(ARCHIVES_DIR, file);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.download(full, file);
});

// Превью изображений (системная папка, вне контекстов)
const PREVIEWS_DIR = path.join(root, "previews");
app.get("/api/previews/:name", (req, res) => {
  const name = String(req.params.name ?? "");
  if (!name || name.includes("..") || name.includes("/")) {
    res.status(400).json({ error: "bad name" });
    return;
  }
  const full = path.join(PREVIEWS_DIR, name);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const ext = path.extname(name).toLowerCase();
  const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];
  if (!imageExts.includes(ext)) {
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  }
  res.sendFile(full);
});

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

app.post("/api/training/sessions/:agentId", (req, res) => {
  const agentId = String(req.params.agentId ?? "");
  if (!validateParam(agentId)) {
    res.status(400).json({ error: "Некорректный ID агента" });
    return;
  }
  // Проверить, существует ли агент
  const def = registry.get(agentId);
  if (!def) {
    res.status(404).json({ error: `Агент «${agentId}» не найден` });
    return;
  }
  // Проверить доступность для обучения (занят в пайпе?)
  if (runner.activeByCtx.has(agentId)) {
    res.status(409).json({ error: `Агент «${def.name}» занят в задаче` });
    return;
  }
  // Создать обучающую сессию (в отдельном хранилище training/)
  const ctx = store.create(`Обучение ${def.name}`, true);
  ctx.activeAgentId = agentId;
  ctx.trainingAgentId = agentId;
  store.save(ctx, true);
  // Применить навык обучения к контексту
  try {
    store.applySkills(ctx.id, ["skill-training"]);
  } catch (e) {
    console.warn("[training] не удалось применить skill-training:", e);
  }
  res.status(201).json({ id: ctx.id, name: ctx.name });
});

// Получить детали конкретной сессии обучения (для определения agentId по sessionId)
// Должно быть ПЕРЕД GET /api/training/sessions/:agentId — иначе Express обработает это как :agentId
app.get("/api/training/sessions/:sessionId", async (req, res) => {
  const sessionId = String(req.params.sessionId ?? "");
  if (!validateParam(sessionId)) {
    res.status(400).json({ error: "Некорректный ID сессии" });
    return;
  }
  
  // Сначала пробуем найти как конкретную сессию
  const ctx = store.getTraining(sessionId);
  if (ctx) {
    if (!ctx.trainingAgentId) {
      res.status(404).json({ error: "Это не обучающая сессия" });
      return;
    }
    res.json({ id: ctx.id, name: ctx.name, createdAt: ctx.createdAt, agentId: ctx.trainingAgentId, completed: !!ctx.completed });
    return;
  }
  
  // Не найдена как сессия — проверяем, является ли это ID агента
  try {
    const agentsResp = await registry.list();
    const isAgent = agentsResp.some((a) => a.id === sessionId);
    if (isAgent) {
      // Это агент — возвращаем все его обучающие сессии (или пустой массив)
      const trainingSessions = store.listTraining()
        .filter((c) => c.trainingAgentId === sessionId)
        .map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, agentId: c.trainingAgentId, completed: !!c.completed }))
        .sort((a, b) => b.createdAt - a.createdAt);
      res.json(trainingSessions);
      return;
    }
  } catch { /* ignore */ }
  
  // Ни сессия, ни агент — возвращаем 404
  res.status(404).json({ error: `Сессия «${sessionId}» не найдена` });
});

// Mark training session as completed (don't delete history)
app.post("/api/training/sessions/:sessionId/complete", (req, res) => {
  const sessionId = String(req.params.sessionId ?? "");
  const ctx = requireTrainingSession(sessionId, res);
  if (!ctx) return;
  try {
    console.log("[complete] Setting completed for", sessionId, "trainingAgentId:", ctx.trainingAgentId);
    ctx.completed = true;
    ctx.updatedAt = new Date();
    store.save(ctx);
    console.log("[complete] Saved successfully");
  } catch (e) {
    console.error("[complete] Error:", e);
  }
  res.json({ ok: true });
});

app.delete("/api/training/sessions/:sessionId", (req, res) => {
  const sessionId = String(req.params.sessionId ?? "");
  const ctx = requireTrainingSession(sessionId, res);
  if (!ctx) return;
  // Прервать агента, если он работает в этой сессии
  runner.abort(sessionId);
  runner.disposeContext(sessionId);
  store.deleteTraining(sessionId);
  broadcast({ type: "context_deleted", ctxId: sessionId });
  res.json({ ok: true });
});

app.put("/api/training/sessions/:sessionId/rename", (req, res) => {
  const sessionId = String(req.params.sessionId ?? "");
  if (!sessionId || sessionId.includes("..") || sessionId.includes("/")) {
    res.status(400).json({ error: "Некорректный ID сессии" });
    return;
  }
  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Имя не указано" });
    return;
  }
  const ctx = store.getTraining(sessionId);
  if (!ctx) {
    res.status(404).json({ error: `Сессия «${sessionId}» не найдена` });
    return;
  }
  if (!ctx.trainingAgentId) {
    res.status(400).json({ error: "Это не обучающая сессия" });
    return;
  }
  ctx.name = name.trim();
  store.save(ctx, true);
  broadcast({ type: "context_renamed", ctxId: sessionId, name: ctx.name });
  res.json({ ok: true, id: sessionId, name: ctx.name });
});

// ─── Context detail APIs ──────────────────────────────────────────────────────
app.get("/api/contexts/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  if (!validateParam(id)) {
    res.status(400).json({ error: "Некорректный ID контекста" });
    return;
  }
  const ctx = store.get(id);
  if (!ctx) {
    res.status(404).json({ error: `Контекст «${id}» не найден` });
    return;
  }
  res.json(ctx);
});

app.get("/api/contexts/:id/messages", (req, res) => {
  const id = String(req.params.id ?? "");
  if (!validateParam(id)) {
    res.status(400).json({ error: "Некорректный ID контекста" });
    return;
  }
  const ctx = store.get(id);
  if (!ctx) {
    res.status(404).json({ error: `Контекст «${id}» не найден` });
    return;
  }
  try {
    const messages = store.readMessages(id);
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// === Редактор агентов: REST API ===

interface AgentFileEntry { filename: string; content: string }

app.get("/api/agents", (_req, res) => {
  const list = registry.list().map((a) => ({ id: a.id, name: a.name, description: a.description }));
  res.json(list);
});

app.get("/api/agents/:id/detail", (req, res) => {
  const id = String(req.params.id ?? "");
  const dir = path.join(AGENTS_DIR, id);
  if (!id || id.includes("..") || id.includes("/") || !fs.existsSync(dir)) {
    res.status(404).json({ error: "agent not found" });
    return;
  }
  // config.json
  const cfgPath = path.join(dir, "config.json");
  const cfg = readJson(cfgPath, {});
  // AGENT.md
  const promptPath = path.join(dir, "AGENT.md");
  const systemPrompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, "utf8") : "";
  // rules/
  const rulesDir = path.join(dir, "rules");
  const rules = readMarkdownDir(rulesDir);
  // skills/
  const skillsDir = path.join(dir, "skills");
  const skills = readMarkdownDir(skillsDir);
  // Обратная логика выдачи инструментов: все pi-инструменты включены по умолчанию,
  // в конфиге хранится только список отключённых (denylist)
  const disabledTools = Array.isArray(cfg.disabledTools) ? cfg.disabledTools : [];

  res.json({ id, name: cfg.name ?? id, description: cfg.description ?? "", disabledTools, model: cfg.model ?? null, thinkingLevel: cfg.thinkingLevel ?? null, forgetSessionAfterStep: cfg.forgetSessionAfterStep === true, systemPrompt, rules, skills });
});

app.put("/api/agents/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  const dir = path.join(AGENTS_DIR, id);
  if (!id || id.includes("..") || id.includes("/") || !fs.existsSync(dir)) {
    res.status(404).json({ error: "agent not found" });
    return;
  }
  const { name, description, disabledTools, model, thinkingLevel, forgetSessionAfterStep, systemPrompt, rules, skills } = req.body;

  // config.json
  const cfg: Record<string, unknown> = {};
  if (name) cfg.name = name;
  if (description !== undefined) cfg.description = description;
  // Denylist отключённых pi-инструментов (всё остальное включено по умолчанию)
  cfg.disabledTools = Array.isArray(disabledTools) ? [...new Set(disabledTools)] : [];
  delete cfg.tools; // legacy allowlist — больше не используется
  if (model) cfg.model = model;
  if (thinkingLevel) cfg.thinkingLevel = thinkingLevel;
  // boolean: записываем и false (иначе нельзя было бы снять галочку)
  cfg.forgetSessionAfterStep = forgetSessionAfterStep === true;
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2));

  // AGENT.md
  fs.writeFileSync(path.join(dir, "AGENT.md"), systemPrompt ?? "");

  // rules/
  syncMarkdownDir(path.join(dir, "rules"), rules ?? []);

  // skills/
  syncMarkdownDir(path.join(dir, "skills"), skills ?? []);

  // Перезагрузить реестр и разослать обновлённый список
  registry.reload();
  broadcast({ type: "agents", agents: registry.list() });

  res.json({ ok: true });
});

// ─── Skills API (глобальные навыки) ─────────────────────────────────────────────
app.get("/api/skills", (_req, res) => {
  res.json(skillRegistry.list().map((s) => ({ id: s.id, name: s.name, description: s.description, autoApply: s.autoApply })));
});

app.get("/api/skills/:id/detail", (req, res) => {
  const sk = skillRegistry.get(String(req.params.id ?? ""));
  if (!sk) {
    res.status(404).json({ error: "skill not found" });
    return;
  }
  res.json(sk);
});

app.post("/api/skills", (req, res) => {
  try {
    const { id, name, description, autoApply, body, files } = req.body ?? {};
    if (!name?.trim()) throw new Error("Укажите название навыка");
    const sk = skillRegistry.create(String(id ?? ""), {
      name: String(name).trim(),
      description: String(description ?? "").trim(),
      autoApply: autoApply === true,
      body: String(body ?? ""),
      files,
    });
    broadcast({ type: "skills", skills: skillRegistry.list() });
    res.json(sk);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

app.put("/api/skills/:id", (req, res) => {
  try {
    const { name, description, autoApply, body, files } = req.body ?? {};
    if (!name?.trim()) throw new Error("Укажите название навыка");
    const sk = skillRegistry.update(String(req.params.id ?? ""), {
      name: String(name).trim(),
      description: String(description ?? "").trim(),
      autoApply: autoApply === true,
      body: String(body ?? ""),
      files,
    });
    broadcast({ type: "skills", skills: skillRegistry.list() });
    res.json(sk);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// Полный список инструментов pi (встроенные + пакеты из `pi install`), сгруппированный —
// для раздела «Инструменты» в редакторе агентов. Кэшируется до перезапроса.
app.get("/api/tools", async (_req, res) => {
  try {
    const groups = await runner.listPiTools();
    res.json({ groups, fetchedAt: runner.piToolsFetchedAtValue });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// Перезапрос списка инструментов pi — сбрасывает кеш и пересобирает из пробной сессии.
// Нужно после изменения ~/.pi/agent/mcp.json или `pi install` (без рестарта сервера).
app.post("/api/tools/refresh", async (_req, res) => {
  try {
    const groups = await runner.listPiTools(true);
    res.json({ groups, fetchedAt: runner.piToolsFetchedAtValue });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// Статус сессий: какие цепочки активны прямо сейчас (для кнопки сброса в настройках)
app.get("/api/sessions", (_req, res) => {
  const actives = runner.getActives();
  res.json({ busy: actives.length > 0, active: actives });
});

// Полный сброс всех сессий — доступен только когда никто не работает и очередь пуста
app.post("/api/sessions/reset", (_req, res) => {
  if (runner.getActives().length > 0 || runner.hasQueued()) {
    res.status(409).json({ error: "Агенты прямо сейчас работают — сброс недоступен. Попробуйте позже." });
    return;
  }
  const n = runner.resetAllSessions();
  broadcast({ type: "system_notice", text: `Сессии сброшены (${n})` });
  res.json({ ok: true, sessions: n });
});

app.delete("/api/skills/:id", (req, res) => {
  try {
    skillRegistry.delete(String(req.params.id ?? ""));
    broadcast({ type: "skills", skills: skillRegistry.list() });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// ─── Work on mistakes API ──────────────────────────────────────────────────
app.post("/api/work-on-mistakes/sessions", (req, res) => {
  const analyzedCtxId = String(req.body?.analyzedCtxId ?? "");
  if (!validateParam(analyzedCtxId)) {
    res.status(400).json({ error: "Некорректный ID контекста задачи" });
    return;
  }
  // Проверить, существует ли анализируемый контекст
  const analyzedCtx = store.get(analyzedCtxId);
  if (!analyzedCtx) {
    res.status(404).json({ error: `Контекст «${analyzedCtxId}» не найден` });
    return;
  }
  // Проверить, что анализируемый контекст уже завершён (нет активных агентов)
  if (runner.activeByCtx.has(analyzedCtxId)) {
    res.status(409).json({ error: `Анализировать можно только завершённые задачи. Агент в контексте «${analyzedCtx.name}» ещё активен.` });
    return;
  }
  // Создать сессию анализа
  const ctx = store.createMistakeAnalysisSession(analyzedCtxId);
  broadcast({ type: "context_created", context: ctx });
  res.status(201).json({ id: ctx.id, name: ctx.name, analyzedCtxId });
});

// ─── System config API ─────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(root, "config.json");

/** Кеш моделей провайдеров: { providerId: { models: string[], fetchedAt: number } } */
const modelsCache: Record<string, { models: string[]; fetchedAt: number }> = {};
const MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 минут

app.get("/api/config", (_req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    res.json(cfg);
  } catch {
    res.json({});
  }
});

app.put("/api/config", (req, res) => {
  try {
    const current = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const { model, port, providers, maxHandoffs, maxRecoveries, stallTimeoutMs, maxUploadSizeMb, recoveryMode } = req.body;
    if (model !== undefined) current.model = model;
    if (port !== undefined) current.port = port;
    if (providers !== undefined) {
      current.providers = providers;
      // Удаляем legacy apiKeys если есть новая структура
      delete current.apiKeys;
    }
    if (maxHandoffs !== undefined) current.maxHandoffs = maxHandoffs;
    if (maxRecoveries !== undefined) current.maxRecoveries = maxRecoveries;
    if (stallTimeoutMs !== undefined) current.stallTimeoutMs = stallTimeoutMs;
    if (maxUploadSizeMb !== undefined) current.maxUploadSizeMb = maxUploadSizeMb;
    if (recoveryMode !== undefined) current.recoveryMode = recoveryMode === "orchestrator_check" ? "orchestrator_check" : "router_agent";
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2));
    // Пересинхронизировать API-ключи
    syncAuthKeys();
    // Очистить кеш моделей при изменении провайдеров
    if (providers) {
      for (const key of Object.keys(modelsCache)) delete modelsCache[key];
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** GET /api/providers/:id/models — список моделей провайдера (с кешем) */
app.get("/api/providers/:id/models", async (req, res) => {
  const providerId = String(req.params.id ?? "");
  if (!providerId || providerId.includes("..") || providerId.includes("/")) {
    res.status(400).json({ error: "invalid provider id" });
    return;
  }

  // Читаем config
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch { /* empty */ }

  const providers = (cfg.providers ?? {}) as Record<string, { url?: string; apiKey?: string }>;
  const provider = providers[providerId];
  if (!provider?.url) {
    res.status(404).json({ error: `provider "${providerId}" not found or has no url` });
    return;
  }

  // Кеш: если свежий — возвращаем
  const cached = modelsCache[providerId];
  if (cached && Date.now() - cached.fetchedAt < MODELS_CACHE_TTL) {
    res.json({ models: cached.models, cached: true, fetchedAt: cached.fetchedAt });
    return;
  }

  // Fetch моделей с провайдера
  const modelsUrl = `${provider.url.replace(/\/$/, "")}/v1/models`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
    const resp = await fetch(modelsUrl, {
      headers: {
        "Authorization": `Bearer ${provider.apiKey ?? ""}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      // Если API недоступно — возвращаем кеш (даже старый)
      if (cached) {
        res.json({ models: cached.models, cached: true, stale: true, fetchedAt: cached.fetchedAt, error: `HTTP ${resp.status}` });
      } else {
        res.status(502).json({ error: `Provider returned HTTP ${resp.status}` });
      }
      return;
    }

    // Поддерживаем оба формата: OpenAI ({data:[{id}]}) и llama.cpp native ({models:[{name|model}]})
    const data = await resp.json() as any;
    const models = parseModelList(data);
    modelsCache[providerId] = { models, fetchedAt: Date.now() };
    res.json({ models, cached: false, fetchedAt: Date.now() });
  } catch (e) {
    // Сеть недоступна — возвращаем кеш
    if (cached) {
      res.json({ models: cached.models, cached: true, stale: true, fetchedAt: cached.fetchedAt, error: String(e) });
    } else {
      res.status(502).json({ error: `Cannot reach provider: ${String(e)}` });
    }
  }
});

// Статика фронтенда (сборка web) + SPA fallback
const webDist = path.join(root, "web", "dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA: все не-API пути возвращают index.html
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

wss.on("connection", (ws) => {
  const send = (msg: unknown) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };

  send({ type: "agents", agents: registry.list() });
  send({ type: "skills", skills: skillRegistry.list() });
  // Фильтруем обучающие сессии из основного списка контекстов
  const allContexts = store.list();
  const regularContexts = allContexts.filter((c) => !c.trainingAgentId);
  send({ type: "contexts", contexts: regularContexts });
  send({ type: "run_state", actives: runner.getActives() });

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {
      switch (msg.type) {
        case "list_contexts":
          // Фильтруем обучающие сессии из основного списка контекстов
          const allCtx = store.list();
          const regularCtx = allCtx.filter((c) => !c.trainingAgentId);
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
            store.save(trainingCtx, true);
            broadcast({ type: "training_session_reopened", sessionId: msg.ctxId });
          }
          await runner.handleMessage(msg.ctxId, msg.text, msg.files);
          break;
        }
        case "prepare_archive": {
          const added = archiveQueue.enqueue(String(msg.ctxId ?? ""));
          if (!added) send({ type: "archive_status", ctxId: msg.ctxId, state: "queued" as const });
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
        default:
          send({ type: "error", message: "Неизвестный тип: " + msg.type });
      }
    } catch (e: any) {
      send({ type: "error", message: String(e?.message ?? e) });
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
