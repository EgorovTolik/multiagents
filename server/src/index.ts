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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

const config = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  } catch {
    return {};
  }
})();

const PORT = config.port ?? 3000;
const AGENTS_DIR = path.join(root, "agents");
const SKILLS_DIR = path.join(root, "skills");
const CONTEXTS_DIR = path.join(root, "contexts");
const SYSTEM_DIR = path.join(root, "system");
const ARCHIVES_DIR = path.join(root, "archives");
fs.mkdirSync(ARCHIVES_DIR, { recursive: true });

// Записываем API-ключи из config.json в agents/auth.json (pi SDK ищет их там)
// Поддерживает обе структуры: legacy apiKeys и новую providers
function syncAuthKeys(): void {
  const authPath = path.join(AGENTS_DIR, "auth.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch { /* файл пуст или не существует */ }

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
    c.deliveredSkills = {};
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
  config.model || undefined,
  broadcast,
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
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
  // AGENT.md
  const promptPath = path.join(dir, "AGENT.md");
  const systemPrompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, "utf8") : "";
  // rules/
  const rules: AgentFileEntry[] = [];
  const rulesDir = path.join(dir, "rules");
  if (fs.existsSync(rulesDir)) {
    for (const f of fs.readdirSync(rulesDir).sort()) {
      if (f.endsWith(".md")) rules.push({ filename: f, content: fs.readFileSync(path.join(rulesDir, f), "utf8") });
    }
  }
  // skills/
  const skills: AgentFileEntry[] = [];
  const skillsDir = path.join(dir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const f of fs.readdirSync(skillsDir).sort()) {
      if (f.endsWith(".md")) skills.push({ filename: f, content: fs.readFileSync(path.join(skillsDir, f), "utf8") });
    }
  }
  // Эффективный набор инструментов (как его видит раннер), без дублей:
  // системные инструменты добавляются раннером всегда, UI их же показывает как доступные
  const baseTools = cfg.tools ?? ["read", "bash", "edit", "write"];
  const effectiveTools = [...new Set([...baseTools, "route_to_agent", "list_agents", "ask_user"])];
  if (id === "agent-creator") {
    effectiveTools.push("create_agent", "delete_agent");
  }

  res.json({ id, name: cfg.name ?? id, description: cfg.description ?? "", tools: effectiveTools, model: cfg.model ?? null, thinkingLevel: cfg.thinkingLevel ?? null, forgetSessionAfterStep: cfg.forgetSessionAfterStep === true, systemPrompt, rules, skills });
});

app.put("/api/agents/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  const dir = path.join(AGENTS_DIR, id);
  if (!id || id.includes("..") || id.includes("/") || !fs.existsSync(dir)) {
    res.status(404).json({ error: "agent not found" });
    return;
  }
  const { name, description, tools, model, thinkingLevel, forgetSessionAfterStep, systemPrompt, rules, skills } = req.body;

  // config.json
  const cfg: Record<string, unknown> = {};
  if (name) cfg.name = name;
  if (description !== undefined) cfg.description = description;
  // Дедупликация: UI присылает эффективный список (с системными инструментами),
  // без дедупа при каждом сохранении набор копился бы
  if (tools) cfg.tools = [...new Set(tools)];
  if (model) cfg.model = model;
  if (thinkingLevel) cfg.thinkingLevel = thinkingLevel;
  // boolean: записываем и false (иначе нельзя было бы снять галочку)
  cfg.forgetSessionAfterStep = forgetSessionAfterStep === true;
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2));

  // AGENT.md
  fs.writeFileSync(path.join(dir, "AGENT.md"), systemPrompt ?? "");

  // rules/
  const rulesDir = path.join(dir, "rules");
  fs.mkdirSync(rulesDir, { recursive: true });
  // удалить старые файлы которые не в списке
  if (fs.existsSync(rulesDir)) {
    for (const f of fs.readdirSync(rulesDir)) {
      if (f.endsWith(".md") && !rules?.some((r: AgentFileEntry) => r.filename === f)) {
        fs.unlinkSync(path.join(rulesDir, f));
      }
    }
  }
  for (const rule of rules ?? []) {
    if (rule.filename && !rule.filename.includes("..") && !rule.filename.includes("/")) {
      fs.writeFileSync(path.join(rulesDir, rule.filename), rule.content);
    }
  }

  // skills/
  const skillsDir = path.join(dir, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  if (fs.existsSync(skillsDir)) {
    for (const f of fs.readdirSync(skillsDir)) {
      if (f.endsWith(".md") && !skills?.some((s: AgentFileEntry) => s.filename === f)) {
        fs.unlinkSync(path.join(skillsDir, f));
      }
    }
  }
  for (const skill of skills ?? []) {
    if (skill.filename && !skill.filename.includes("..") && !skill.filename.includes("/")) {
      fs.writeFileSync(path.join(skillsDir, skill.filename), skill.content);
    }
  }

  // Перезагрузить реестр и разослать обновлённый список
  registry.reload();
  broadcast({ type: "agents", agents: registry.list() });

  res.json({ ok: true });
});

// ─── Skills API (глобальные навыки) ─────────────────────────────────────────────
app.get("/api/skills", (_req, res) => {
  res.json(skillRegistry.list().map((s) => ({ id: s.id, name: s.name, description: s.description })));
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
    const { id, name, description, body } = req.body ?? {};
    if (!name?.trim()) throw new Error("Укажите название навыка");
    const sk = skillRegistry.create(String(id ?? ""), {
      name: String(name).trim(),
      description: String(description ?? "").trim(),
      body: String(body ?? ""),
    });
    broadcast({ type: "skills", skills: skillRegistry.list() });
    res.json(sk);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

app.put("/api/skills/:id", (req, res) => {
  try {
    const { name, description, body } = req.body ?? {};
    if (!name?.trim()) throw new Error("Укажите название навыка");
    const sk = skillRegistry.update(String(req.params.id ?? ""), {
      name: String(name).trim(),
      description: String(description ?? "").trim(),
      body: String(body ?? ""),
    });
    broadcast({ type: "skills", skills: skillRegistry.list() });
    res.json(sk);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
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

    const data = await resp.json() as { data?: { id: string }[] };
    const models = (data.data ?? []).map((m) => m.id).sort();
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
  send({ type: "contexts", contexts: store.list() });
  send({ type: "run_state", running: runner.getActive() });

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
          send({ type: "contexts", contexts: store.list() });
          break;
        case "create_context": {
          const c = store.create(msg.name ?? "Новая задача");
          send({ type: "context_created", context: c });
          break;
        }
        case "delete_context": {
          const ctx = store.get(msg.ctxId);
          if (!ctx) break;
          if (runner.getActive()?.ctxId === msg.ctxId) runner.abort();
          runner.disposeContext(msg.ctxId);
          store.delete(msg.ctxId);
          broadcast({ type: "context_deleted", ctxId: msg.ctxId });
          break;
        }
        case "load_context": {
          const messages = store
            .readMessages(msg.ctxId)
            .map((m) => (m.role === "assistant" ? { ...m, text: store.maskPaths(msg.ctxId, m.text) } : m));
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
          await runner.handleMessage(msg.ctxId, msg.text, msg.files);
          break;
        }
        case "prepare_archive": {
          const added = archiveQueue.enqueue(String(msg.ctxId ?? ""));
          if (!added) send({ type: "archive_status", ctxId: msg.ctxId, state: "queued" as const });
          break;
        }
        case "abort":
          runner.abort();
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
