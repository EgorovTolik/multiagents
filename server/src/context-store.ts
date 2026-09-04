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

export interface Message {
  role: "user" | "assistant" | "system";
  agentId?: string;
  text: string;
  ts: number;
}

export interface ContextMeta {
  id: string;
  name: string;
  createdAt: number;
  activeAgentId: string;
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
  /**
   * Агент вызвал ask_user и ждёт ответа пользователя на свой вопрос.
   * Ответ пользователя уходит этому агенту (не оркестратору),
   * а обрыв цепочки НЕ считается прерыванием (восстановление не срабатывает).
   */
  awaitingUser?: { agentId: string; question: string };
  /** Время последнего сообщения (для авто-выбора контекста при загрузке). */
  lastMessageAt?: number;
  /** Пользователь нажал «Остановить» — не запускать recovery после abort. */
  aborted?: boolean;
}

/**
 * Контексты задач: contexts/<id>/ — рабочий каталог, в котором работают все
 * агенты цепочки. context.json — метаданные, messages.jsonl — лог чата.
 */
export class ContextStore {
  constructor(
    private root: string,
    private defaultAgent: string,
  ) {
    fs.mkdirSync(root, { recursive: true });
  }

  dir(ctxId: string) {
    return path.join(this.root, ctxId);
  }

  create(name: string): ContextMeta {
    const id = crypto.randomUUID().slice(0, 8);
    const meta: ContextMeta = {
      id,
      name: name.trim() || "Новая задача",
      createdAt: Date.now(),
      activeAgentId: this.defaultAgent,
      handoffs: [],
    };
    fs.mkdirSync(this.dir(id), { recursive: true });
    this.save(meta);
    return meta;
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

  get(id: string): ContextMeta | undefined {
    const p = path.join(this.dir(id), "context.json");
    if (!fs.existsSync(p)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return undefined;
    }
  }

  save(meta: ContextMeta) {
    fs.writeFileSync(
      path.join(this.dir(meta.id), "context.json"),
      JSON.stringify(meta, null, 2),
    );
  }

  delete(ctxId: string) {
    fs.rmSync(this.dir(ctxId), { recursive: true, force: true });
  }

  /**
   * Подменяет абсолютные пути внутри директории контекста на markdown-ссылки
   * на скачивание: /…/contexts/<id>/poem.txt → [poem.txt](/api/files?…)
   * Локальные пути сервера в клиент не уходят.
   */
  maskPaths(ctxId: string, text: string): string {
    const dir = this.dir(ctxId);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
    fs.appendFileSync(
      path.join(this.dir(ctxId), "messages.jsonl"),
      JSON.stringify(msg) + "\n",
    );
    const meta = this.get(ctxId);
    if (meta) {
      meta.lastMessageAt = msg.ts;
      this.save(meta);
    }
  }

  /** Удалить сообщения начиная с индекса fromIndex (включительно). */
  truncateHistory(ctxId: string, fromIndex: number): Message[] {
    const p = path.join(this.dir(ctxId), "messages.jsonl");
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
    const remaining = lines.slice(0, fromIndex).map((l) => JSON.parse(l));
    fs.writeFileSync(p, remaining.map((m) => JSON.stringify(m)).join("\n") + (remaining.length ? "\n" : ""), "utf8");
    return remaining;
  }

  readMessages(ctxId: string): Message[] {
    const p = path.join(this.dir(ctxId), "messages.jsonl");
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
