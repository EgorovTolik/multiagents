import { Router } from "express";
import type { AgentRunner } from "../runner";
import { conflictError } from "../error-types";

export function createSessionsRouter(runner: AgentRunner, configPath: string, broadcast: (msg: unknown) => void) {
  const router = Router();

  // Статус сессий
  router.get("/api/sessions", (_req, res) => {
    const actives = runner.getActives();
    const response = { busy: actives.length > 0, active: actives };
    res.json(response);
  });

  // Полный сброс всех сессий
  router.post("/api/sessions/reset", async (_req, res) => {
    if (runner.getActives().length > 0 || runner.hasQueued()) {
      res.status(409).json(conflictError("Агенты прямо сейчас работают — сброс недоступен. Попробуйте позже."));
      return;
    }

    const n = runner.resetAllSessions();
    await runner.reloadProjectConfig(configPath, broadcast);
    const response = { ok: true, sessions: n };
    res.json(response);
  });

  return router;
}
