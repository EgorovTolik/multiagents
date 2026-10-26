import { Router } from "express";
import fs from "fs";
import type { AgentRunner } from "../runner";
import { toErrorObject } from "../error-types";

interface UpdateConfigBody {
  model?: string;
  port?: number;
  providers?: Record<string, unknown>;
  maxHandoffs?: number;
  maxRecoveries?: number;
  stallTimeoutMs?: number;
  maxUploadSizeMb?: number;
  recoveryMode?: string;
}

export function createConfigRouter(runner: AgentRunner, configPath: string, modelsCache: Record<string, { models: string[]; fetchedAt: number }>, syncAuthKeys: () => void) {
  const router = Router();

  // Получить конфигурацию
  router.get("/api/config", (_req, res) => {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
      res.json(cfg);
    } catch {
      res.json({});
    }
  });

  // Обновить конфигурацию
  router.put("/api/config", (req, res) => {
    try {
      const current = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const body = req.body as unknown as UpdateConfigBody;
      const { model, port, providers, maxHandoffs, maxRecoveries, stallTimeoutMs, maxUploadSizeMb, recoveryMode } = body;

      if (model !== undefined) current.model = model;
      if (port !== undefined) current.port = port;
      if (providers !== undefined) {
        current.providers = providers;
        delete current.apiKeys;
      }
      if (maxHandoffs !== undefined) current.maxHandoffs = maxHandoffs;
      if (maxRecoveries !== undefined) current.maxRecoveries = maxRecoveries;
      if (stallTimeoutMs !== undefined) current.stallTimeoutMs = stallTimeoutMs;
      if (maxUploadSizeMb !== undefined) current.maxUploadSizeMb = maxUploadSizeMb;
      if (recoveryMode !== undefined) {
        current.recoveryMode = recoveryMode === "orchestrator_check" ? "orchestrator_check" : "router_agent";
      }

      fs.writeFileSync(configPath, JSON.stringify(current, null, 2));
      runner.updateSystemConfig();
      syncAuthKeys();

      if (providers) {
        for (const key of Object.keys(modelsCache)) delete modelsCache[key];
      }

      res.json({ ok: true });
    } catch (e) {
      const err = toErrorObject(e);
      res.status(500).json(err);
    }
  });

  return router;
}
