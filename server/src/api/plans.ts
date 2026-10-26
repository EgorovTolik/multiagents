import { Router } from "express";
import type { ContextStore } from "../context-store";
import type { AgentRunner } from "../runner";

export function createPlansRouter(runner: AgentRunner) {
  const router = Router();
  const store = runner.getContextStore();
  const planService = runner.getPlanService();

  // Получить план
  router.get("/api/plans/:planId", async (req, res) => {
    try {
      const { planId } = req.params;
      const ctxId = req.query.ctxId as string;
      if (!ctxId) {
        res.status(400).json({ error: "ctxId query parameter required" });
        return;
      }
      let plan = await planService.loadPlan(ctxId, planId);
      if (!plan) {
        res.status(404).json({ error: "Plan not found" });
      } else {
        const detailed = await plan.detailed();
        res.json(detailed);
      }
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Создать план
  router.post("/api/plans", async (req, res) => {
    try {
      const { ctxId, title, description, createdBy } = req.body;
      if (!ctxId || !title) {
        res.status(400).json({ error: "ctxId and title required" });
        return;
      }
      const plan = await planService.createPlan(ctxId, { title, description, createdBy: createdBy || "user" });
      res.status(201).json({ plan });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Обновить план
  router.put("/api/plans/:planId", async (req, res) => {
    try {
      const { planId } = req.params;
      const ctxId = req.query.ctxId as string;
      if (!ctxId) {
        res.status(400).json({ error: "ctxId query parameter required" });
        return;
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Активный план контекста
  router.get("/api/contexts/:ctxId/active-plan", async (req, res) => {
    try {
      const { ctxId } = req.params;
      const meta = store.get(ctxId);
      if (!meta) {
        res.status(404).json({ error: "Context not found" });
        return;
      }
      const activePlanId = store.getActivePlanId(meta);
      if (!activePlanId) {
        res.json({ planId: null });
      } else {
        let plan = await planService.loadPlan(ctxId, activePlanId);
        if (plan) {
          const detailed = await plan.detailed();
          res.json({ planId: activePlanId, plan: detailed });
        } else {
          res.json({ planId: null });
        }
      }
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Список всех планов для контекста
  router.get("/api/contexts/:ctxId/plans", async (req, res) => {
    try {
      const { ctxId } = req.params;
      const meta = store.get(ctxId);
      if (!meta) {
        res.status(404).json({ error: "Context not found" });
        return;
      }
      const plans = await planService.listPlans(ctxId);
      res.json({ plans });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
