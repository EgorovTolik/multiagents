import { Router } from "express";
import type { ContextStore } from "../context-store";
import type { AgentRunner } from "../runner";
import type { AgentRegistry } from "../registry";
import { validateParam } from "../utils";
import { notFoundError, validationError, conflictError } from "../error-types";

interface RenameContextBody {
  name?: string;
}

function requireTrainingSession(sessionId: string, store: ContextStore, res: any) {
  const ctx = store.getTraining(sessionId);
  if (!ctx) {
    res.status(404).json(notFoundError(`Сессия «${sessionId}» не найдена`));
    return null;
  }
  if (!ctx.trainingAgentId) {
    res.status(400).json(validationError("Это не обучающая сессия"));
    return null;
  }
  return ctx;
}

export function createTrainingRouter(store: ContextStore, runner: AgentRunner, registry: AgentRegistry, broadcast: (msg: unknown) => void) {
  const router = Router();

  // Создать обучающую сессию
  router.post("/api/training/sessions/:agentId", (req, res) => {
    const agentId = String(req.params.agentId ?? "");
    if (!validateParam(agentId)) {
      res.status(400).json(validationError("Некорректный ID агента"));
      return;
    }

    const def = registry.get(agentId);
    if (!def) {
      res.status(404).json(notFoundError(`Агент «${agentId}» не найден`));
      return;
    }

    if (runner.activeByCtx.has(agentId)) {
      res.status(409).json(conflictError(`Агент «${def.name}» занят в задаче`));
      return;
    }

    const ctx = store.create(`Обучение ${def.name}`, "training");
    ctx.activeAgentId = agentId;
    ctx.trainingAgentId = agentId;
    store.save(ctx, "training");

    try {
      store.applySkills(ctx.id, ["skill-training"]);
    } catch (e) {
      console.warn("[training] не удалось применить skill-training:", e);
    }

    res.status(201).json({ id: ctx.id, name: ctx.name });
  });

  // Получить детали сессии обучения или все сессии агента
  router.get("/api/training/sessions/:sessionId", async (req, res) => {
    const sessionId = String(req.params.sessionId ?? "");
    if (!validateParam(sessionId)) {
      res.status(400).json(validationError("Некорректный ID сессии"));
      return;
    }

    const ctx = store.getTraining(sessionId);
    if (ctx) {
      if (!ctx.trainingAgentId) {
        res.status(404).json(notFoundError("Это не обучающая сессия"));
        return;
      }
      res.json({ id: ctx.id, name: ctx.name, createdAt: ctx.createdAt, agentId: ctx.trainingAgentId, completed: !!ctx.completed });
      return;
    }

    try {
      const agentsResp = await registry.list();
      const isAgent = agentsResp.some((a) => a.id === sessionId);
      if (isAgent) {
        const trainingSessions = store.listTraining()
          .filter((c) => c.trainingAgentId === sessionId)
          .map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, agentId: c.trainingAgentId, completed: !!c.completed }))
          .sort((a, b) => b.createdAt - a.createdAt);
        res.json(trainingSessions);
        return;
      }
    } catch { /* ignore */ }

    res.status(404).json(notFoundError(`Сессия «${sessionId}» не найдена`));
  });

  // Отметить сессию как завершённую
  router.post("/api/training/sessions/:sessionId/complete", (req, res) => {
    const sessionId = String(req.params.sessionId ?? "");
    const ctx = requireTrainingSession(sessionId, store, res);
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

  // Удалить сессию обучения
  router.delete("/api/training/sessions/:sessionId", (req, res) => {
    const sessionId = String(req.params.sessionId ?? "");
    const ctx = requireTrainingSession(sessionId, store, res);
    if (!ctx) return;

    runner.abort(sessionId);
    runner.disposeContext(sessionId);
    store.deleteTraining(sessionId);
    broadcast({ type: "context_deleted", ctxId: sessionId });

    res.json({ ok: true });
  });

  // Переименовать сессию обучения
  router.put("/api/training/sessions/:sessionId/rename", (req, res) => {
    const sessionId = String(req.params.sessionId ?? "");
    if (!validateParam(sessionId)) {
      res.status(400).json(validationError("Некорректный ID сессии"));
      return;
    }

    const body = req.body as unknown as RenameContextBody;
    const { name } = body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json(validationError("Имя не указано"));
      return;
    }

    const ctx = store.getTraining(sessionId);
    if (!ctx) {
      res.status(404).json(notFoundError(`Сессия «${sessionId}» не найдена`));
      return;
    }

    if (!ctx.trainingAgentId) {
      res.status(400).json(validationError("Это не обучающая сессия"));
      return;
    }

    ctx.name = name.trim();
    store.save(ctx, "training");
    broadcast({ type: "context_renamed", ctxId: sessionId, name: ctx.name });

    res.json({ ok: true, id: sessionId, name: ctx.name });
  });

  return router;
}
