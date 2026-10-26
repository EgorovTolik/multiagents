import { Router } from "express";
import type { SkillRegistry } from "../skill-registry";
import { notFoundError, validationError, toErrorObject } from "../error-types";

interface SkillBody {
  name?: string;
  description?: string;
  autoApply?: boolean;
  body?: string;
  files?: Array<{ filename: string; content: string }>;
}

export function createSkillsRouter(skillRegistry: SkillRegistry, broadcast: (msg: unknown) => void) {
  const router = Router();

  // Список навыков
  router.get("/api/skills", (_req, res) => {
    res.json(skillRegistry.list().map((s) => ({ id: s.id, name: s.name, description: s.description, autoApply: s.autoApply })));
  });

  // Детали навыка
  router.get("/api/skills/:id/detail", (req, res) => {
    const sk = skillRegistry.get(String(req.params.id ?? ""));
    if (!sk) {
      res.status(404).json(notFoundError("Навык не найден"));
      return;
    }
    res.json(sk);
  });

  // Создание навыка
  router.post("/api/skills", (req, res) => {
    try {
      const skillBody = req.body as unknown as { id?: string } & SkillBody;
      const { id, name, description, autoApply, body, files } = skillBody ?? {};
      if (!name?.trim()) throw validationError("Укажите название навыка");

      const sk = skillRegistry.create(String(id ?? ""), {
        name: String(name).trim(),
        description: String(description ?? "").trim(),
        autoApply: autoApply === true,
        body: String(body ?? ""),
        files,
      });

      broadcast({ type: "skills", skills: skillRegistry.list() });
      res.json(sk);
    } catch (e) {
      const err = toErrorObject(e);
      res.status(err.code === "VALIDATION_ERROR" ? 400 : 500).json(err);
    }
  });

  // Обновление навыка
  router.put("/api/skills/:id", (req, res) => {
    const id = String(req.params.id ?? "");
    if (!skillRegistry.get(id)) {
      res.status(404).json(notFoundError("Навык не найден"));
      return;
    }

    try {
      const skillBody = req.body as unknown as SkillBody;
      const { name, description, autoApply, body, files } = skillBody ?? {};
      if (!name?.trim()) throw validationError("Укажите название навыка");

      skillRegistry.update(id, {
        name: String(name).trim(),
        description: String(description ?? "").trim(),
        autoApply: autoApply === true,
        body: String(body ?? ""),
        files,
      });

      broadcast({ type: "skills", skills: skillRegistry.list() });
      res.json(skillRegistry.get(id));
    } catch (e) {
      const err = toErrorObject(e);
      res.status(err.code === "VALIDATION_ERROR" ? 400 : 500).json(err);
    }
  });

  // Удаление навыка
  router.delete("/api/skills/:id", (req, res) => {
    const id = String(req.params.id ?? "");
    if (!skillRegistry.get(id)) {
      res.status(404).json(notFoundError("Навык не найден"));
      return;
    }

    skillRegistry.delete(id);
    broadcast({ type: "skills", skills: skillRegistry.list() });
    res.json({ ok: true });
  });

  return router;
}
