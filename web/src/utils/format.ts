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
