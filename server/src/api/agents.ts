import { Router } from "express";
import path from "path";
import fs from "fs";
import type { AgentRegistry } from "../registry";
import { readJson, readMarkdownDir, syncMarkdownDir } from "../utils";
import { notFoundError } from "../error-types";

interface UpdateAgentBody {
  name?: string;
  description?: string;
  disabledTools?: string[];
  model?: string;
  thinkingLevel?: string;
  forgetSessionAfterStep?: boolean;
  systemPrompt?: string;
  rules?: Array<{ filename: string; content: string }>;
  skills?: Array<{ filename: string; content: string }>;
}

export function createAgentsRouter(registry: AgentRegistry, agentsDir: string, broadcast: (msg: unknown) => void) {
  const router = Router();

  // Список агентов
  router.get("/api/agents", (_req, res) => {
    const list = registry.list().map((a) => ({ id: a.id, name: a.name, description: a.description }));
    res.json(list);
  });

  // Детали агента
  router.get("/api/agents/:id/detail", (req, res) => {
    const id = String(req.params.id ?? "");
    const dir = path.join(agentsDir, id);
    if (!id || id.includes("..") || id.includes("/") || !fs.existsSync(dir)) {
      res.status(404).json(notFoundError("Агент не найден"));
      return;
    }

    interface AgentConfig {
      name?: string;
      description?: string;
      model?: string;
      disabledTools?: string[];
      thinkingLevel?: string;
      forgetSessionAfterStep?: boolean;
    }

    const cfgPath = path.join(dir, "config.json");
    const cfg: AgentConfig = readJson(cfgPath, {});
    const promptPath = path.join(dir, "AGENT.md");
    const systemPrompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, "utf8") : "";
    const rulesDir = path.join(dir, "rules");
    const rules = readMarkdownDir(rulesDir);
    const skillsDir = path.join(dir, "skills");
    const skills = readMarkdownDir(skillsDir);

    const disabledTools = Array.isArray(cfg.disabledTools) ? cfg.disabledTools : [];

    res.json({
      id, name: cfg.name ?? id, description: cfg.description ?? "", disabledTools,
      model: cfg.model ?? null, thinkingLevel: cfg.thinkingLevel ?? null,
      forgetSessionAfterStep: cfg.forgetSessionAfterStep === true,
      systemPrompt, rules, skills,
    });
  });

  // Обновление агента
  router.put("/api/agents/:id", (req, res) => {
    const id = String(req.params.id ?? "");
    const dir = path.join(agentsDir, id);
    if (!id || id.includes("..") || id.includes("/") || !fs.existsSync(dir)) {
      res.status(404).json(notFoundError("Агент не найден"));
      return;
    }

    const body = req.body as unknown as UpdateAgentBody;
    const { name, description, disabledTools, model, thinkingLevel, forgetSessionAfterStep, systemPrompt, rules, skills } = body;

    const cfg: Record<string, unknown> = {};
    if (name) cfg.name = name;
    if (description !== undefined) cfg.description = description;
    cfg.disabledTools = Array.isArray(disabledTools) ? [...new Set(disabledTools)] : [];
    delete cfg.tools;
    if (model) cfg.model = model;
    if (thinkingLevel) cfg.thinkingLevel = thinkingLevel;
    cfg.forgetSessionAfterStep = forgetSessionAfterStep === true;
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2));

    fs.writeFileSync(path.join(dir, "AGENT.md"), systemPrompt ?? "");
    syncMarkdownDir(path.join(dir, "rules"), rules ?? []);
    syncMarkdownDir(path.join(dir, "skills"), skills ?? []);

    registry.reload();
    broadcast({ type: "agents", agents: registry.list() });

    res.json({ ok: true });
  });

  return router;
}
