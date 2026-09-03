import fs from "node:fs";
import path from "node:path";

export interface AgentSkill {
  name: string;
  description: string;
  path: string;
}

export interface AgentDef {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  rules: string[];
  skills: AgentSkill[];
  model?: string;
  tools?: string[];
  thinkingLevel?: string;
}

export interface NewAgentParams {
  name: string;
  description: string;
  systemPrompt: string;
  rules?: string[];
  skills?: { name: string; description: string; content: string }[];
}

/**
 * Файловый реестр агентов: каждый агент — поддиректория agents/<id>/
 * с AGENT.md (системный промпт), config.json, rules/*.md, skills/*.md
 */
export class AgentRegistry {
  private agents = new Map<string, AgentDef>();

  constructor(private agentsDir: string) {
    this.reload();
  }

  reload() {
    this.agents.clear();
    if (!fs.existsSync(this.agentsDir)) return;
    for (const entry of fs.readdirSync(this.agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const dir = path.join(this.agentsDir, id);
      const agentMd = path.join(dir, "AGENT.md");
      if (!fs.existsSync(agentMd)) continue;

      const systemPrompt = fs.readFileSync(agentMd, "utf8");
      const cfgPath = path.join(dir, "config.json");
      const cfg = fs.existsSync(cfgPath)
        ? JSON.parse(fs.readFileSync(cfgPath, "utf8"))
        : {};

      const rules: string[] = [];
      const rulesDir = path.join(dir, "rules");
      if (fs.existsSync(rulesDir)) {
        for (const f of fs.readdirSync(rulesDir).sort()) {
          if (f.endsWith(".md")) {
            rules.push(fs.readFileSync(path.join(rulesDir, f), "utf8"));
          }
        }
      }

      const skills: AgentSkill[] = [];
      const skillsDir = path.join(dir, "skills");
      if (fs.existsSync(skillsDir)) {
        for (const f of fs.readdirSync(skillsDir).sort()) {
          if (!f.endsWith(".md")) continue;
          const content = fs.readFileSync(path.join(skillsDir, f), "utf8");
          const m = content.match(/^---\n([\s\S]*?)\n---/);
          let name = f.replace(/\.md$/, "");
          let description = "";
          if (m) {
            const nm = m[1].match(/^name:\s*(.+)$/m);
            const dm = m[1].match(/^description:\s*(.+)$/m);
            if (nm) name = nm[1].trim();
            if (dm) description = dm[1].trim();
          }
          skills.push({ name, description, path: path.join(skillsDir, f) });
        }
      }

      this.agents.set(id, {
        id,
        name: cfg.name ?? id,
        description: cfg.description ?? "",
        systemPrompt,
        rules,
        skills,
        model: cfg.model,
        tools: cfg.tools,
        thinkingLevel: cfg.thinkingLevel,
      });
    }
  }

  get(id: string) {
    return this.agents.get(id);
  }

  list() {
    return [...this.agents.values()];
  }

  /** Создаёт агента на диске и перечитывает реестр. */
  create(params: NewAgentParams): AgentDef {
    const id = params.name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!/^[a-z0-9-]+$/.test(id)) {
      throw new Error("Имя агента должно содержать только a-z, 0-9 и дефис");
    }
    if (this.agents.has(id)) {
      throw new Error(`Агент "${id}" уже существует`);
    }
    const dir = path.join(this.agentsDir, id);
    fs.mkdirSync(path.join(dir, "rules"), { recursive: true });
    fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENT.md"), params.systemPrompt);
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ name: id, description: params.description }, null, 2),
    );
    for (const rule of params.rules ?? []) {
      const rf = path.join(dir, "rules", `${rule.name ?? "rule"}.md`);
      fs.writeFileSync(rf, rule.content);
    }
    for (const skill of params.skills ?? []) {
      const sf = path.join(dir, "skills", `${skill.name}.md`);
      const body = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.content}`;
      fs.writeFileSync(sf, body);
    }
    this.reload();
    const def = this.agents.get(id);
    if (!def) throw new Error("Не удалось зарегистрировать агента");
    return def;
  }

  /** Системные агенты, которые нельзя удалить (программная защита). */
  private static readonly PROTECTED = new Set(["orchestrator", "agent-creator"]);

  /** Удаляет агента с диска и перечитывает реестр. Системных агентов не удаляет. */
  delete(id: string): void {
    if (AgentRegistry.PROTECTED.has(id)) {
      throw new Error(
        `Агент "${id}" является системным (оркестратор или агент-создатель) и не может быть удалён — даже по прямой просьбе пользователя.`,
      );
    }
    const dir = path.join(this.agentsDir, id);
    if (!fs.existsSync(dir)) {
      throw new Error(`Агент "${id}" не найден`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    this.reload();
  }
}
