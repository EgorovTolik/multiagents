import { useEffect } from "react";

export interface RecoveryEntry {
  ts: number;
  agentId?: string;
  event: "started" | "decision" | "completed";
  brokenAgent?: string;
  attempt?: number;
  maxAttempts?: number;
  decision?: string;
  targetAgent?: string;
  success?: boolean;
  reason?: string;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ru-RU");
}

function decisionLabel(d: string): string {
  switch (d) {
    case "router_fallback": return "Маршрутизатор → оркестратор";
    case "auto_recover_incomplete": return "Возврат агенту для продолжения";
    case "route_to_router": return "Разбор маршрута (chain-router)";
    case "orchestrator_check": return "Проверка оркестратором";
    default: return d;
  }
}

function eventIcon(e: RecoveryEntry["event"]): string {
  switch (e) {
    case "started": return "⚠️";
    case "decision": return "🔄";
    case "completed": return e === "completed" ? "✅" : "❌";
  }
}

export function RecoveryHistoryModal({
  isOpen,
  onClose,
  history,
  agentName,
}: {
  isOpen: boolean;
  onClose: () => void;
  history: RecoveryEntry[];
  agentName: (id: string) => string;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="w-full max-w-3xl max-h-[80vh] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <h3 className="text-lg font-semibold text-white">История восстановлений цепочки</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
            aria-label="Закрыть"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(80vh-4rem)] overflow-y-auto">
          {history.length === 0 ? (
            <p className="px-5 py-8 text-center text-slate-400">Нет событий восстановления</p>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Время</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Событие</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Агент</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Детали</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {history.map((entry, i) => (
                  <tr key={i} className="hover:bg-slate-800/50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-400">{formatTime(entry.ts)}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        {eventIcon(entry.event)}
                        <span className={entry.event === "completed" && entry.success ? "text-emerald-400" : entry.event === "completed" && !entry.success ? "text-rose-400" : "text-slate-300"}>
                          {entry.event === "started" ? "Начато" : entry.event === "decision" ? "Решение" : entry.success ? "Завершено" : "Ошибка"}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {entry.event === "started" && entry.brokenAgent
                        ? agentName(entry.brokenAgent)
                        : entry.event === "decision" && entry.targetAgent
                          ? agentName(entry.targetAgent)
                          : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {entry.event === "started" && (
                        <span>Попытка {entry.attempt}/{entry.maxAttempts}</span>
                      )}
                      {entry.event === "decision" && entry.decision && (
                        <span>{decisionLabel(entry.decision)}</span>
                      )}
                      {entry.event === "completed" && !entry.success && entry.reason && (
                        <span>{entry.reason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 px-5 py-3 text-right">
          <button
            onClick={onClose}
            className="rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}