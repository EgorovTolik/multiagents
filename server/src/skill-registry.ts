import fs from "node:fs";
import path from "node:path";

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  /** Агент может применить навык к себе сам (инструмент use_skill), без участия пользователя. */
  autoApply: boolean;
  body: string;
}

export interface SkillParams {
  name: string;
  description: string;
  autoApply?: boolean;
  body: string;
}

/**
 * Файловый реестр глобальных навыков: каждый навык — поддиректория skills/<id>/
 * с config.json (name, description) и SKILL.md (тело навыка).
 *
 * Навыки подключаются к чату в любой момент (см. ContextMeta.skills) и передаются
 * агентам сообщениями при их следующем запуске (см. AgentRunner.run).
 */
export class SkillRegistry {
  private skills = new Map<string, SkillDef>();

  constructor(private skillsDir: string) {
    this.reload();
  }

  reload() {
    this.skills.clear();
    if (!fs.existsSync(this.skillsDir)) return;
    for (const entry of fs.readdirSync(this.skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const dir = path.join(this.skillsDir, id);
      const bodyPath = path.join(dir, "SKILL.md");
      if (!fs.existsSync(bodyPath)) continue;
      const cfgPath = path.join(dir, "config.json");
      let cfg: { name?: string; description?: string; autoApply?: boolean } = {};
      try {
        cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      } catch { /* config.json отсутствует или повреждён — используем id */ }
      this.skills.set(id, {
        id,
        name: cfg.name ?? id,
        description: cfg.description ?? "",
        autoApply: cfg.autoApply === true,
        body: fs.readFileSync(bodyPath, "utf8"),
      });
    }
  }

  get(id: string) {
    return this.skills.get(id);
  }

  list() {
    return [...this.skills.values()];
  }

  private static isValidId(id: string): boolean {
    return /^[a-z0-9][a-z0-9_-]*$/.test(id);
  }

  create(id: string, params: SkillParams): SkillDef {
    if (!SkillRegistry.isValidId(id)) {
      throw new Error("ID навыка: только строчные a-z, цифры, _ и дефис; начинается с буквы или цифры");
    }
    if (this.skills.has(id)) {
      throw new Error(`Навык "${id}" уже существует`);
    }
    this.writeFiles(id, params);
    this.reload();
    const def = this.skills.get(id);
    if (!def) throw new Error("Не удалось зарегистрировать навык");
    return def;
  }

  update(id: string, params: SkillParams): SkillDef {
    if (!this.skills.has(id)) {
      throw new Error(`Навык "${id}" не найден`);
    }
    this.writeFiles(id, params);
    this.reload();
    const def = this.skills.get(id);
    if (!def) throw new Error("Не удалось сохранить навык");
    return def;
  }

  delete(id: string): void {
    const dir = path.join(this.skillsDir, id);
    if (!fs.existsSync(dir)) {
      throw new Error(`Навык "${id}" не найден`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    this.reload();
  }

  private writeFiles(id: string, params: SkillParams) {
    const dir = path.join(this.skillsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), params.body ?? "");
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ name: params.name, description: params.description, autoApply: params.autoApply === true }, null, 2),
    );
  }
}
