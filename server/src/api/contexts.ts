import { Router } from "express";
import type { ContextStore } from "../context-store";
import { notFoundError } from "../error-types";

export function createContextsRouter(store: ContextStore) {
  const router = Router();

  // Информация о контексте
  router.get("/api/contexts/:id", (req, res) => {
    const ctx = store.get(String(req.params.id ?? ""));
    if (!ctx) {
      res.status(404).json(notFoundError("Контекст не найден"));
      return;
    }
    res.json({ id: ctx.id, name: ctx.name, createdAt: ctx.createdAt });
  });

  // Сообщения контекста
  router.get("/api/contexts/:id/messages", (req, res) => {
    const ctx = store.get(String(req.params.id ?? ""));
    if (!ctx) {
      res.status(404).json({ error: "Context not found" });
      return;
    }
    try {
      const msgs = store.readMessages(ctx.id);
      res.json({ messages: msgs });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
