import { Router } from "express";
import fs from "fs";
import { notFoundError, validationError, networkError } from "../error-types";
import { parseModelList } from "../utils";

const MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 минут

export function createProvidersRouter(configPath: string, modelsCache: Record<string, { models: string[]; fetchedAt: number }>) {
  const router = Router();

  // Получить модели провайдера
  router.get("/api/providers/:id/models", async (req, res) => {
    const providerId = String(req.params.id ?? "");
    if (!providerId || providerId.includes("..") || providerId.includes("/")) {
      res.status(400).json(validationError("invalid provider id"));
      return;
    }

    // Читаем config
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch { /* empty */ }

    const providers = (cfg.providers ?? {}) as Record<string, { url?: string; apiKey?: string }>;
    const provider = providers[providerId];
    if (!provider?.url) {
      res.status(404).json(notFoundError(`provider "${providerId}" not found or has no url`));
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
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(modelsUrl, {
        headers: {
          "Authorization": `Bearer ${provider.apiKey ?? ""}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        const httpErr = networkError(`Provider returned HTTP ${resp.status}`, { status: resp.status });
        if (cached) {
          res.json({ models: cached.models, cached: true, stale: true, fetchedAt: cached.fetchedAt, error: httpErr.message });
        } else {
          res.status(502).json(httpErr);
        }
        return;
      }

      const data = await resp.json() as any;
      const models = parseModelList(data);
      modelsCache[providerId] = { models, fetchedAt: Date.now() };
      res.json({ models, cached: false, fetchedAt: Date.now() });
    } catch (e) {
      const netErr = networkError("Cannot reach provider", { original: e });
      if (cached) {
        res.json({ models: cached.models, cached: true, stale: true, fetchedAt: cached.fetchedAt, error: netErr.message });
      } else {
        res.status(502).json(netErr);
      }
    }
  });

  return router;
}
