import fs from "node:fs";
import path from "node:path";

/** Валидирует URL-параметр: запрет на .. и / — защита от path traversal. */
export function validateParam(value: string): boolean {
  return !!value && !value.includes("..") && !value.includes("/");
}

/** Парсинг списка моделей из ответа OpenAI-compatible API (data или models). */
export function parseModelList(data: any): string[] {
  const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return [...new Set(arr.map((m: any) => m.id ?? m.model ?? m.name).filter(Boolean))].sort();
}

/** Прочитать все *.md файлы из директории в {filename, content}. */
export function readMarkdownDir(dir: string): Array<{ filename: string; content: string }> {
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ filename: string; content: string }> = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (f.endsWith(".md")) {
      out.push({ filename: f, content: fs.readFileSync(path.join(dir, f), "utf8") });
    }
  }
  return out;
}

/** Синхронизировать содержимое директории с мапой {filename→content}: удалить лишнее, записать новые. */
export function syncMarkdownDir(dir: string, entries: Array<{ filename: string; content: string }>): void {
  fs.mkdirSync(dir, { recursive: true });
  // Удалить файлы, которых нет в списке
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".md") && !entries.some((e) => e.filename === f)) {
      fs.unlinkSync(path.join(dir, f));
    }
  }
  // Записать/обновить файлы из списка
  for (const e of entries) {
    if (e.filename && validateParam(e.filename)) {
      fs.writeFileSync(path.join(dir, e.filename), e.content);
    }
  }
}

/** Прочитать и распарсить JSON-файл; при ошибке вернуть fallback. */
export function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}