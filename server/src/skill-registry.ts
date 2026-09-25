import fs from "node:fs";
import path from "node:path";

export interface SkillFileEntry {
  filename: string;
  content: string;
}

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  /** Агент может применить навык к себе сам (инструмент use_skill), без участия пользователя. */
  autoApply: boolean;
  body: string;
  /** Дополнительные файлы навыка (.md) — хранятся в skills/<id>/files/. */
  files?: SkillFileEntry[];
}

export interface SkillParams {
  name: string;
  description: string;
  autoApply?: boolean;
  body: string;
  /** Дополнительные файлы навыка (filename + content). Сохраняются в skills/<id>/files/. */
  files?: SkillFileEntry[];
}

/**
 * Файловый реестр глобальных навыков: каждый навык — поддиректория skills/<id>/
 * с config.json (name, description), SKILL.md (тело навыка) и опционально
 * files/*.md (дополнительные файлы).
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

      // Читаем дополнительные файлы из files/
      const files: SkillFileEntry[] = [];
      const filesDir = path.join(dir, "files");
      if (fs.existsSync(filesDir)) {
        for (const f of fs.readdirSync(filesDir).sort()) {
          if (f.endsWith(".md")) {
            files.push({ filename: f, content: fs.readFileSync(path.join(filesDir, f), "utf8") });
          }
        }
      }

      this.skills.set(id, {
        id,
        name: cfg.name ?? id,
        description: cfg.description ?? "",
        autoApply: cfg.autoApply === true,
        body: fs.readFileSync(bodyPath, "utf8"),
        files,
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

    // Запись дополнительных файлов в files/
    const filesDir = path.join(dir, "files");
    fs.mkdirSync(filesDir, { recursive: true });
    if (params.files) {
      // Удалить старые файлы которых нет в списке
      for (const f of fs.readdirSync(filesDir)) {
        if (!params.files.some((p: SkillFileEntry) => p.filename === f)) {
          fs.unlinkSync(path.join(filesDir, f));
        }
      }
    }
    // Записать новые/обновлённые файлы
    for (const file of params.files ?? []) {
      if (file.filename && !file.filename.includes("..") && !file.filename.includes("/")) {
        fs.writeFileSync(path.join(filesDir, file.filename), file.content);
      }
    }
  }

  /** Обновить только дополнительные файлы навыка. */
  updateFiles(id: string, files?: SkillFileEntry[]): void {
    const def = this.skills.get(id);
    if (!def) throw new Error(`Навык "${id}" не найден`);
    const dir = path.join(this.skillsDir, id);
    const filesDir = path.join(dir, "files");
    fs.mkdirSync(filesDir, { recursive: true });

    // Удалить старые файлы которых нет в списке
    if (fs.existsSync(filesDir)) {
      for (const f of fs.readdirSync(filesDir)) {
        if (!files?.some((p) => p.filename === f)) {
          fs.unlinkSync(path.join(filesDir, f));
        }
      }
    }

    // Записать новые/обновлённые файлы
    for (const file of files ?? []) {
      if (file.filename && !file.filename.includes("..") && !file.filename.includes("/")) {
        fs.writeFileSync(path.join(filesDir, file.filename), file.content);
      }
    }

    this.reload();
  }
}
