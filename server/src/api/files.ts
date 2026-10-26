import { Router } from "express";
import path from "path";
import fs from "fs";
import type { ContextStore } from "../context-store";
import { notFoundError, validationError } from "../error-types";

interface FilesQuery {
  ctx?: string;
  path?: string;
}

interface ArchiveQuery {
  ctx?: string;
  file?: string;
}

export function createFilesRouter(store: ContextStore, root: string, contextsDir: string, archivesDir: string) {
  const router = Router();
  const PREVIEWS_DIR = path.join(root, "previews");

  // Скачать файл из контекста
  router.get("/api/files", (req, res) => {
    const query = req.query as unknown as FilesQuery;
    const ctxId = String(query.ctx ?? "");
    const rel = String(query.path ?? "");
    if (!ctxId || !rel) {
      res.status(400).json(validationError("missing ctx or path"));
      return;
    }

    const ctxDir = path.join(contextsDir, ctxId);
    const full = path.resolve(ctxDir, rel);
    if (full !== ctxDir && !full.startsWith(ctxDir + path.sep)) {
      res.status(400).json(validationError("bad path"));
      return;
    }

    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.status(404).json(notFoundError("Файл не найден"));
      return;
    }

    res.download(full);
  });

  // Размеры директорий контекстов
  router.get("/api/context-sizes", (_req, res) => {
    const sizes: Record<string, number> = {};
    if (fs.existsSync(contextsDir)) {
      for (const e of fs.readdirSync(contextsDir, { withFileTypes: true })) {
        if (e.isDirectory()) sizes[e.name] = store.dirSize(e.name);
      }
    }
    res.json(sizes);
  });

  // Скачать архив контекста
  router.get("/api/archive", (req, res) => {
    const query = req.query as unknown as ArchiveQuery;
    const ctxId = String(query.ctx ?? "");
    const file = String(query.file ?? "");
    if (!ctxId || !file) {
      res.status(400).json(validationError("missing ctx or file"));
      return;
    }

    if (!file.startsWith(ctxId + "-") || !file.endsWith(".zip") || file.includes("/") || file.includes("..") || file.includes("\\")) {
      res.status(400).json(validationError("bad file name"));
      return;
    }

    const full = path.join(archivesDir, file);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.status(404).json(notFoundError("Архив не найден"));
      return;
    }

    res.download(full, file);
  });

  // Превью изображений
  router.get("/api/previews/:name", (req, res) => {
    const name = String(req.params.name ?? "");
    if (!name || name.includes("..") || name.includes("/")) {
      res.status(400).json(validationError("bad file name"));
      return;
    }

    const full = path.join(PREVIEWS_DIR, name);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.status(404).json(notFoundError("Файл превью не найден"));
      return;
    }

    const ext = path.extname(name).toLowerCase();
    const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];
    if (!imageExts.includes(ext)) {
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    }

    res.sendFile(full);
  });

  return router;
}
