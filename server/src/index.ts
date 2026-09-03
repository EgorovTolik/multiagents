import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { AgentRegistry } from "./registry";
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
const CONTEXTS_DIR = path.join(root, "contexts");
const SYSTEM_DIR = path.join(root, "system");

const registry = new AgentRegistry(AGENTS_DIR);
const store = new ContextStore(CONTEXTS_DIR, "orchestrator");

const broadcast = (msg: unknown) => {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
};

const runner = new AgentRunner(
  registry,
  store,
  AGENTS_DIR,
  SYSTEM_DIR,
  config.model || undefined,
  broadcast,
);

const app = express();
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

// Статика фронтенда (сборка web)
const webDist = path.join(root, "web", "dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
}

wss.on("connection", (ws) => {
  const send = (msg: unknown) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };

  send({ type: "agents", agents: registry.list() });
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
        case "abort":
          runner.abort();
          break;
        case "cancel_handoff":
          runner.cancelHandoff(msg.ctxId);
          break;
        default:
          send({ type: "error", message: "Неизвестный тип: " + msg.type });
      }
    } catch (e: any) {
      send({ type: "error", message: String(e?.message ?? e) });
    }
  });
});

runner.init().then(() => {
  server.listen(PORT, () => {
    console.log(`multiagents: http://localhost:${PORT}`);
    console.log(`Агентов в реестре: ${registry.list().map((a) => a.id).join(", ")}`);
  });
});
