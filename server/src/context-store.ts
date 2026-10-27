import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface Handoff {
  from: string;
  to: string;
  reason: string;
  context: string;
  ts: number;
}

/** Запись об одном событии восстановления цепочки. */
export interface RecoveryEntry {
  /** Время события (unix ms). */
  timestamp: number;
  /** ID агента, который не смог обработать задачу (проблемная модель/агент). */
  brokenAgent: string;
  /** Решение роутера — кто заменил сломанного агента. */
  routerDecision?: string;
  /** Результат восстановления. */
  result: "success" | "fallback" | "limit_reached";
}

export interface Message {
  role: "user" | "assistant" | "system";
  agentId?: string;
  text: string;
  /** Рассуждения модели (thinking-блоки) — для отображения, в сессию pi не попадают. */
  thinking?: string;
  ts: number;
  /** Отметка частичного сообщения во время стриминга ответа. */
  streaming?: boolean;
}

export type ContextType = "work" | "training" | "mistakes";

export interface ContextMeta {
  id: string;
  name: string;
  createdAt: number;
  activeAgentId: string;
  /** ID агента, для которого создана эта обучающая сессия. */
  trainingAgentId?: string;
  handoffs: Handoff[];
  /** Передача, запланированная route_to_agent, но ещё не выполненная (текущий ход не завершён). */
  pendingHandoff?: Handoff;
  /**
   * Текущий ход был запущен handoff'ом (агент «в цепочке»), а не прямым
   * сообщением пользователя. Если агент в цепочке завершит ход без передачи —
   * цепочка прервалась → автопроверка оркестратором.
   */
  inChain?: boolean;
  /** Сколько автоматических восстановлений уже было в текущей цепочке. */
  recoveryCount?: number;
  /** История событий восстановления для этого контекста. */
  recoveryLog?: RecoveryEntry[];
  /**
   * Агент вызвал ask_user и ждёт ответа пользователя на свой вопрос.
   * Ответ пользователя уходит этому агенту (не оркестратору),
   * а обрыв цепочки НЕ считается прерыванием (восстановление не срабатывает).
   */
  awaitingUser?: { agentId: string; question: string };
  /** Время последнего сообщения (для авто-выбора контекста при загрузке). */
  lastMessageAt?: number;
  /** Счётчик задач для именования файлов task-XXX/result-XXX */
  taskCounter?: number;
  /** Пользователь нажал «Остановить» — не запускать recovery после abort. */
  aborted?: boolean;
  /** Сессия обучения завершена (не удалена, но помечена как completed). */
  completed?: boolean;
  /** Время последнего обновления метаданных. */
  updatedAt?: Date;
  /** ID анализируемой задачи (для сессий работы над ошибками). */
  flowMistakesOfCtxId?: string;
  /** Навыки (skills/), применённые к этому чату. */
  skills?: string[];
  /** Какие навыки уже переданы какому агенту (agentId → id навыков). */
  deliveredSkills?: Record<string, string[]>;
  /** ID активного плана для этого контекста. */
  activePlanId?: string;
}

/**
 * Контексты задач: contexts/<id>/ — рабочий каталог для обычных чатов,
 * training/<id>/ — обучающие сессии. context.json — метаданные,
 * messages.jsonl — лог чата.
 */
export class ContextStore {
  private trainingRoot: string;
  private mistakesRoot: string;

  constructor(
    private root: string,
    private defaultAgent: string,
  ) {
    fs.mkdirSync(root, { recursive: true });
    this.trainingRoot = path.join(path.dirname(root), "training");
    fs.mkdirSync(this.trainingRoot, { recursive: true });
    this.mistakesRoot = path.join(path.dirname(root), "flow-mistakes");
    fs.mkdirSync(this.mistakesRoot, { recursive: true });
  }

  dir(ctxId: string) {
    return path.join(this.root, ctxId);
  }

  trainingDir(ctxId: string) {
    return path.join(this.trainingRoot, ctxId);
  }

  mistakesDir(ctxId: string) {
    return path.join(this.mistakesRoot, ctxId);
  }

  create(name: string, type: ContextType = "work"): ContextMeta {
    const id = crypto.randomUUID().slice(0, 8);
    const meta: ContextMeta = {
      id,
      name: name.trim() || "Новая задача",
      createdAt: Date.now(),
      activeAgentId: this.defaultAgent,
      handoffs: [],
    };
    if (type === "training") {
      const dir = this.trainingDir(id);
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
      fs.mkdirSync(path.join(dir, "results"), { recursive: true });
    } else if (type === "mistakes") {
      const dir = this.mistakesDir(id);
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
      fs.mkdirSync(path.join(dir, "results"), { recursive: true });
    } else {
      const dir = this.dir(id);
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
      fs.mkdirSync(path.join(dir, "results"), { recursive: true });
    }
    this.save(meta, type);
    return meta;
  }

  /** Создать сессию работы над ошибками для анализируемого контекста. */
  createMistakesSession(analyzedCtxId: string, analyzedName: string): ContextMeta {
    const meta = this.create(`Работа над ошибками: ${analyzedName}`, "mistakes");
    meta.activeAgentId = "flow-manager";
    meta.flowMistakesOfCtxId = analyzedCtxId;
    this.save(meta, "mistakes");
    return meta;
  }

  /** Найти существующую сессию работы над ошибками для анализируемого контекста. */
  findMistakesSession(analyzedCtxId: string): ContextMeta | null {
    if (!fs.existsSync(this.mistakesRoot)) return null;
    try {
      const dirs = fs.readdirSync(this.mistakesRoot, { withFileTypes: true });
      for (const e of dirs) {
        if (!e.isDirectory()) continue;
        try {
          const meta = this.get(e.name);
          if (meta && meta.flowMistakesOfCtxId === analyzedCtxId) {
            return meta;
          }
        } catch (err) {
          console.warn(`[context-store] Failed to read mistakes session ${e.name}:`, err);
        }
      }
    } catch (err) {
      console.warn(`[context-store] Failed to list mistakes sessions:`, err);
    }
    return null;
  }

  list(): ContextMeta[] {
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => this.get(e.name))
      .filter((c): c is ContextMeta => !!c)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  listTraining(): ContextMeta[] {
    if (!fs.existsSync(this.trainingRoot)) return [];
    return fs
      .readdirSync(this.trainingRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => this.getTraining(e.name))
      .filter((c): c is ContextMeta => !!c)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): ContextMeta | undefined {
    // Сначала проверяем обычное хранилище
    const p = path.join(this.dir(id), "context.json");
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        // ignore
      }
    }
    // Затем обучающее
    const tp = path.join(this.trainingDir(id), "context.json");
    if (fs.existsSync(tp)) {
      try {
        return JSON.parse(fs.readFileSync(tp, "utf8"));
      } catch {
        // ignore
      }
    }
    // Затем сессии работы над ошибками
    const mp = path.join(this.mistakesDir(id), "context.json");
    if (fs.existsSync(mp)) {
      try {
        return JSON.parse(fs.readFileSync(mp, "utf8"));
      } catch {
        // ignore
      }
    }
    return undefined;
  }

  isTrainingContext(id: string): boolean {
    const p = path.join(this.trainingDir(id), "context.json");
    return fs.existsSync(p);
  }

  getTraining(id: string): ContextMeta | undefined {
    const p = path.join(this.trainingDir(id), "context.json");
    if (!fs.existsSync(p)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return undefined;
    }
  }

  save(meta: ContextMeta, type?: ContextType) {
    if (type === undefined) {
      // Auto-detect based on context properties
      if (meta.trainingAgentId) {
        type = "training";
      } else if (meta.flowMistakesOfCtxId) {
        type = "mistakes";
      } else {
        type = "work";
      }
    }
    let dir: string;
    if (type === "training") {
      dir = this.trainingDir(meta.id);
    } else if (type === "mistakes") {
      dir = this.mistakesDir(meta.id);
    } else {
      dir = this.dir(meta.id);
    }
    fs.writeFileSync(
      path.join(dir, "context.json"),
      JSON.stringify(meta, null, 2),
    );
  }

  delete(ctxId: string) {
    fs.rmSync(this.dir(ctxId), { recursive: true, force: true });
  }

  deleteTraining(ctxId: string) {
    fs.rmSync(this.trainingDir(ctxId), { recursive: true, force: true });
  }

  /** Сбрасывает флаги доставки навыков (навыки будут инжектиться заново). */
  resetDeliveredSkills(meta: ContextMeta): void {
    if (meta.deliveredSkills && Object.keys(meta.deliveredSkills).length > 0) {
      meta.deliveredSkills = {};
    }
  }

  /** Устанавливает ID активного плана для контекста. */
  setActivePlanId(meta: ContextMeta, planId: string): void {
    meta.activePlanId = planId;
  }

  /** Получает ID активного плана для контекста. */
  getActivePlanId(meta: ContextMeta): string | undefined {
    return meta.activePlanId;
  }

  /** Определяет тип контекста по ID и возвращает соответствующую директорию. */
  resolveDir(ctxId: string): { dir: string; type: ContextType } {
    if (this.isTrainingContext(ctxId)) {
      return { dir: this.trainingDir(ctxId), type: "training" };
    }
    // Check for mistakes session
    const mp = path.join(this.mistakesDir(ctxId), "context.json");
    if (fs.existsSync(mp)) {
      return { dir: this.mistakesDir(ctxId), type: "mistakes" };
    }
    return { dir: this.dir(ctxId), type: "work" };
  }

  /** Рекурсивный размер директории контекста в байтах (0, если не существует). */
  dirSize(ctxId: string): number {
    const { dir } = this.resolveDir(ctxId);
    let total = 0;
    const walk = (p: string) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, e.name);
        try {
          if (e.isDirectory()) walk(full);
          else if (e.isFile()) total += fs.statSync(full).size;
        } catch { /* ignore */ }
      }
    };
    try {
      walk(dir);
    } catch { /* нет директории */ }
    return total;
  }

  /**
   * Подменяет абсолютные пути внутри директории контекста на markdown-ссылки
   * на скачивание: /…/contexts/<id>/poem.txt → [poem.txt](/api/files?…)
   * Локальные пути сервера в клиент не уходят.
   */
  maskPaths(ctxId: string, text: string): string {
    const { dir } = this.resolveDir(ctxId);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Проход 0: image-ссылки ![alt](<префикс>:/path/in/ctx/dir/file.png), где цель — локальный путь
    // (модель часто вставляет пути из tool results, иногда с префиксом sandbox:).
    // Заменяем ВСЁ содержимое скобок на api_url: если заменить только путь (проход 2),
    // получится вложенная ссылка ![alt](sandbox:[file.png](url)), которую ReactMarkdown ломает.
    const imgRe = new RegExp(
      "(!\\[[^\\]]*\\]\\()([^)]*?" + esc(dir) + path.sep + "([^)\\s]+))(\\))",
      "g",
    );
    text = text.replace(imgRe, (_m, p1: string, _full: string, rel: string, p4: string) => {
      return `${p1}/api/files?ctx=${ctxId}&path=${encodeURIComponent(rel)}${p4}`;
    });

    // Проход 1: пути внутри markdown-ссылок [text](full_path) → [text](api_url)
    const mdLinkRe = new RegExp(
      "(\\[[^\\]]*\\]\\()(" + esc(dir) + path.sep + "([^\\s`\")\\]]+))(\\))",
      "g",
    );
    text = text.replace(mdLinkRe, (_m, prefix: string, _full: string, rel: string, suffix: string) => {
      return `${prefix}/api/files?ctx=${ctxId}&path=${encodeURIComponent(rel)}${suffix}`;
    });

    // Проход 2: standalone-пути (не внутри markdown-ссылок) → [name](api_url)
    const standaloneRe = new RegExp(
      "(?:`)?(" + esc(dir) + path.sep + "([^\\s`\")\\]]+))(?:`)?",
      "g",
    );
    text = text.replace(standaloneRe, (_m, _full: string, rel: string) => {
      const name = path.basename(rel);
      return `[${name}](/api/files?ctx=${ctxId}&path=${encodeURIComponent(rel)})`;
    });

    return text;
  }

  appendMessage(ctxId: string, msg: Message) {
    const { dir, type } = this.resolveDir(ctxId);
    fs.appendFileSync(
      path.join(dir, "messages.jsonl"),
      JSON.stringify(msg) + "\n",
    );
    const meta = this.get(ctxId);
    if (meta) {
      meta.lastMessageAt = msg.ts;
      this.save(meta, type);
    }
  }

  /** Добавить навыки в контекст. Возвращает обновлённые метаданные. */
  applySkills(ctxId: string, ids: string[]): ContextMeta {
    const meta = this.get(ctxId);
    if (!meta) throw new Error("Контекст не найден: " + ctxId);
    const cur = meta.skills ?? [];
    for (const id of ids) {
      if (id && !cur.includes(id)) cur.push(id);
    }
    meta.skills = cur;
    this.save(meta);
    return meta;
  }

  /** Удалить сообщения начиная с индекса fromIndex (включительно). */
  truncateHistory(ctxId: string, fromIndex: number): Message[] {
    const { dir } = this.resolveDir(ctxId);
    const p = path.join(dir, "messages.jsonl");
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
    // Убедиться что fromIndex — это число
    const idx = typeof fromIndex === "number" ? fromIndex : Number(fromIndex);
    if (Number.isNaN(idx) || idx < 0) return [];
    // slice(0, idx) keeps indices 0..idx-1, removes idx and above
    const remaining = lines.slice(0, idx).map((l) => JSON.parse(l));
    fs.writeFileSync(p, remaining.map((m) => JSON.stringify(m)).join("\n") + (remaining.length ? "\n" : ""), "utf8");
    return remaining;
  }

  readMessages(ctxId: string): Message[] {
    const { dir } = this.resolveDir(ctxId);
    const p = path.join(dir, "messages.jsonl");
    if (!fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}
