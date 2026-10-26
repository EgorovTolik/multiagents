import { Router } from "express";
import type { ContextStore } from "../context-store";
import { notFoundError, validationError } from "../error-types";

export function createMistakesRouter(store: ContextStore) {
  const router = Router();

  // Найти или создать сессию работы над ошибками
  router.get("/api/work-on-mistakes/sessions/:analyzedCtxId", (req, res) => {
    const analyzedCtxId = String(req.params.analyzedCtxId ?? "");
    if (!analyzedCtxId || !/^[a-f0-9]{8}$/.test(analyzedCtxId)) {
      res.status(400).json(validationError("Некорректный ID контекста задачи"));
      return;
    }

    const analyzedCtx = store.get(analyzedCtxId);
    if (!analyzedCtx) {
      res.status(404).json(notFoundError(`Контекст «${analyzedCtxId}» не найден`));
      return;
    }

    const existing = store.findMistakesSession(analyzedCtxId);
    if (existing) {
      existing.activeAgentId = "flow-manager";
      store.save(existing);
      res.json({
        id: existing.id, name: existing.name, analyzedCtxId,
        activeAgentId: "flow-manager", found: true,
      });
      return;
    }

    const mistakesSession = store.createMistakesSession(analyzedCtxId, analyzedCtx.name);
    res.status(201).json({
      id: mistakesSession.id, name: mistakesSession.name, analyzedCtxId,
      activeAgentId: "flow-manager", found: false,
    });
  });

  return router;
}
