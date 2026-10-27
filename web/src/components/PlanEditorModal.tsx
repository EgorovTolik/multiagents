import { useEffect, useState } from "react";
import type { Plan, PlanStep } from "../api";

function StepItem({
  step,
  onStatusChange,
}: {
  step: PlanStep;
  onStatusChange: (stepId: string, status: "pending" | "in_progress" | "done" | "blocked") => void;
}) {
  const [expanded, setExpanded] = useState(true);

  // С getter'ом для step.steps нам не нужно различать inline и embedded —
  // getter автоматически возвращает правильные шаги
  const hasNested = step.steps && step.steps.length > 0;

  const statusColors: Record<string, string> = {
    pending: "text-slate-400",
    in_progress: "text-blue-400",
    done: "text-emerald-400",
    blocked: "text-rose-400",
  };

  return (
    <div className="ml-4">
      <div className="flex items-center gap-2 py-1">
        {hasNested ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-slate-500 hover:text-slate-300"
          >
            {expanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <input
          type="checkbox"
          checked={step.status === "done"}
          onChange={() => onStatusChange(step.id, step.status === "done" ? "in_progress" : "done")}
          className="accent-emerald-500"
        />

        <span className={`text-sm ${statusColors[step.status]}`}>{step.task}</span>

        <select
          value={step.status}
          onChange={(e) =>
            onStatusChange(
              step.id,
              e.target.value as "pending" | "in_progress" | "done" | "blocked"
            )
          }
          className="ml-auto rounded border border-slate-700 bg-slate-800 text-xs text-slate-300"
        >
          <option value="pending">Ожидание</option>
          <option value="in_progress">Выполняется</option>
          <option value="done">Готово</option>
          <option value="blocked">Заблокировано</option>
        </select>
      </div>

      {expanded && hasNested && (
        <div className="border-l border-slate-700/50 pl-4">
          {/* Шаги (inline или из встроенного подплана — getter автоматически определит) */}
          {(step.steps ?? []).map((sub) => (
            <StepItem key={sub.id} step={sub} onStatusChange={onStatusChange} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PlanEditorModal({
  isOpen,
  onClose,
  plan,
  onStatusChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  plan: Plan | null;
  onStatusChange: (stepId: string, status: "pending" | "in_progress" | "done" | "blocked") => void;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !plan) return null;

  // Calculate progress
  let done = 0;
  let total = 0;
  const countSteps = (steps: PlanStep[]) => {
    for (const step of steps) {
      total++;
      if (step.status === "done") done++;
      // Рекурсивно считаем подшаги — getter автоматически определит inline или embedded
      if (step.steps && step.steps.length > 0) countSteps(step.steps);
    }
  };
  countSteps(plan.steps);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="w-full max-w-3xl max-h-[80vh] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">{plan.title}</h3>
            <p className="text-xs text-slate-400">
              Статус: {plan.status} | Прогресс: {done}/{total} ({percent}%)
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
            aria-label="Закрыть"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="bg-slate-800 px-5 py-3">
          <div className="h-2 rounded-full bg-slate-700">
            <div
              className="h-2 rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="max-h-[calc(80vh-10rem)] overflow-y-auto px-5 py-4">
          {plan.steps.map((step) => (
            <StepItem key={step.id} step={step} onStatusChange={onStatusChange} />
          ))}
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
