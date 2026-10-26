import { Router } from "express";
import type { AgentRunner } from "../runner";
import { toErrorObject } from "../error-types";

export function createToolsRouter(runner: AgentRunner) {
  const router = Router();

  // Список инструментов pi
  router.get("/api/tools", async (_req, res) => {
    try {
      const groups = await runner.listPiTools();
      res.json({ groups, fetchedAt: runner.piToolsFetchedAtValue });
    } catch (e) {
      const err = toErrorObject(e);
      res.status(500).json(err);
    }
  });

  // Перезапрос списка инструментов pi (сброс кеша)
  router.post("/api/tools/refresh", async (_req, res) => {
    try {
      const groups = await runner.listPiTools(true);
      res.json({ groups, fetchedAt: runner.piToolsFetchedAtValue });
    } catch (e) {
      const err = toErrorObject(e);
      res.status(500).json(err);
    }
  });

  return router;
}
