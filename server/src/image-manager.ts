import fs from "node:fs";
import path from "node:path";
import type { ServerToClientMessage } from "./ws-types";
import type { Message } from "./context-store";

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

interface ImageManagerOptions {
  getCtxDir: (ctxId: string) => string;
  storeAppendMessage: (ctxId: string, msg: Message) => void;
  emit: (msg: ServerToClientMessage) => void;
}

/** Менеджер изображений из результатов инструментов (скриншоты MCP и т.п.). */
export class ImageManager {
  private pendingImages = new Map<string, string[]>();
  private options: ImageManagerOptions;

  constructor(options: ImageManagerOptions) {
    this.options = options;
  }

  /** Сохраняет image-блоки из результата инструмента и возвращает markdown-ссылки. */
  saveToolImages(ctxId: string, result: any): string[] {
    const content = Array.isArray(result?.content) ? result.content : [];
    const images = content.filter((b: any) => b?.type === "image" && typeof b.data === "string" && b.data.length > 0);
    if (images.length === 0) return [];

    const dir = path.join(this.options.getCtxDir(ctxId), "attachments");
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();

    return images.map((b: any, i: number) => {
      const ext = IMAGE_EXT[b.mimeType] ?? "png";
      const fname = `img-${ts}-${i}.${ext}`;
      fs.writeFileSync(path.join(dir, fname), Buffer.from(b.data, "base64"));
      const url = `/api/files?ctx=${ctxId}&path=attachments/${encodeURIComponent(fname)}`;
      return `![скриншот](${url})`;
    });
  }

  /** Проставляет накопленные изображения в сообщение ассистента. */
  withPendingImages(ctxId: string, agentId: string, text: string): string {
    const key = `${ctxId}/${agentId}`;
    const imgs = this.pendingImages.get(key) ?? [];
    if (imgs.length === 0) return text;
    this.pendingImages.delete(key);
    return text + "\n\n" + imgs.join("\n");
  }

  /** Остаток изображений без завершающего сообщения — отправляем отдельным сообщением. */
  flushPendingImages(ctxId: string, agentId: string) {
    const key = `${ctxId}/${agentId}`;
    const imgs = this.pendingImages.get(key);
    if (!imgs || imgs.length === 0) return;
    this.pendingImages.delete(key);
    const msg: Message = { role: "assistant", agentId, text: imgs.join("\n"), ts: Date.now() };
    this.options.storeAppendMessage(ctxId, msg);
    this.options.emit({ type: "assistant_end", ctxId, agentId, msgId: 0, text: msg.text });
  }

  /** Добавить накопленные изображения для агента. */
  addPendingImages(ctxId: string, agentId: string, markdowns: string[]) {
    const key = `${ctxId}/${agentId}`;
    this.pendingImages.set(key, [...(this.pendingImages.get(key) ?? []), ...markdowns]);
  }
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}