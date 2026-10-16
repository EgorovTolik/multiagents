/** Извлечение текста из сообщения (для восстановления контекста). */
export function extractText(msg: unknown): string {
  const c = (msg as any)?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  }
  return "";
}

/** Проверка — является ли вложение изображением. */
export function isImage(att: { mediaType: string }): boolean {
  return att.mediaType.startsWith("image/");
}

/** Очистка markdown-ссылок на несуществующие файлы. */
import fs from "node:fs";
import path from "node:path";

export function sanitizeFileLinks(ctxDir: string, text: string): string {
  return text.replace(
    /(!?)(\[[^\]]*\]\()\/api\/files\?ctx=[^&]+&path=([^)\s]+)(\))/g,
    (m: string, bang: string, label: string, encodedRel: string) => {
      let rel: string;
      try {
        rel = decodeURIComponent(encodedRel);
      } catch {
        return m;
      }
      const full = path.resolve(ctxDir, rel);
      if (full.startsWith(ctxDir + path.sep) && fs.existsSync(full)) return m;
      return bang ? "" : label.slice(1, -2).replace(/\)$/, "");
    },
  );
}

/** Генерация названия контекста из первого сообщения. */
export function generateName(firstMessage: string): string | null {
  const clean = firstMessage
    .replace(/[#*`~>]/g, "")
    .replace(/^[«"'"']+|[»"'"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  const max = 40;
  let name = clean;
  if (name.length > max) {
    name = name.slice(0, max);
    const lastSpace = name.lastIndexOf(" ");
    if (lastSpace > 15) name = name.slice(0, lastSpace);
    name += "…";
  }
  return name || null;
}