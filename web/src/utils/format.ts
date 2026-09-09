/** Форматирование времени: сегодня hh:mm, раньше dd.MM.yyyy hh:mm */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mo}.${yyyy} ${hh}:${mm}`;
}

/**
 * Размер в байтах → человекочитаемая строка с авто-единицей:
 * 512 Б, 1.48 КБ, 3.02 МБ, … (до двух знаков после запятой).
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes) || bytes < 0) return "";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  // «#.##»: до двух знаков после запятой, без хвостовых нулей
  const s = v.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${s} ${units[i]}`;
}

/** Время суток: hh:mm */
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Заголовок группы по дате создания: «15 июля 2026» */
export function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/** Цвет бейджа агента */
export function agentColor(id: string): string {
  const map: Record<string, string> = {
    orchestrator: "border-indigo-500 text-indigo-300",
    "agent-creator": "border-purple-500 text-purple-300",
    "code-worker": "border-emerald-500 text-emerald-300",
    "code-reviewer": "border-cyan-500 text-cyan-300",
    "web-researcher": "border-amber-500 text-amber-300",
    "feature-planner": "border-pink-500 text-pink-300",
    "git-manager": "border-orange-500 text-orange-300",
  };
  return map[id] ?? "border-slate-600 text-slate-400";
}
