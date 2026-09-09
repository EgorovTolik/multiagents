import { useEffect, useRef, useState } from "react";
import type { SkillInfo } from "../api";

/**
 * Кнопка «⚡ Навыки» + всплывающая панель выбора навыков для текущего чата.
 *
 * Состояния элементов списка:
 *  - обычный  — навык доступен, клик выбирает (toggle);
 *  - зелёный  — выбран для активации, клик снимает выбор;
 *  - серый    — уже применён в этом чате, не кликабелен.
 */
export function SkillPicker({
  skills,
  applied,
  onApply,
  disabled,
}: {
  skills: SkillInfo[];
  /** id навыков, уже применённых к текущему контексту */
  applied: string[];
  /** применить выбранные навыки (id) к текущему контексту */
  onApply: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Закрытие по клику вне панели
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (id: string) => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const apply = () => {
    onApply(selected);
    setSelected([]);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        title="Навыки — дополнительные инструкции для агентов этого чата"
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${
          open
            ? "border-indigo-500 bg-slate-800 text-indigo-300"
            : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
        }`}
      >
        ⚡ Навыки
        {applied.length > 0 && (
          <span className="rounded-full bg-indigo-600/50 px-1.5 text-xs text-indigo-200">{applied.length}</span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
          <div className="border-b border-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200">
            Навыки для этого чата
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {skills.length === 0 && (
              <p className="px-2 py-3 text-center text-xs leading-relaxed text-slate-500">
                Навыков пока нет.
                <br />
                Создайте их на странице «Навыки».
              </p>
            )}
            {skills.map((s) => {
              const isApplied = applied.includes(s.id);
              const isSelected = selected.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => !isApplied && toggle(s.id)}
                  disabled={isApplied}
                  className={`mb-1 flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left last:mb-0 ${
                    isApplied
                      ? "cursor-default border-slate-800 bg-slate-950/60"
                      : isSelected
                        ? "border-emerald-600 bg-emerald-900/30"
                        : "border-transparent hover:border-slate-700 hover:bg-slate-800/60"
                  }`}
                >
                  <span
                    className={`text-sm ${
                      isApplied ? "text-slate-500" : isSelected ? "text-emerald-300" : "text-slate-200"
                    }`}
                  >
                    {isSelected && "✓ "}
                    {s.name}
                    {isApplied && <span className="ml-1.5 text-xs text-slate-600">(применён)</span>}
                  </span>
                  <span className={`mt-0.5 text-xs ${isApplied ? "text-slate-600" : "text-slate-400"}`}>
                    {s.description}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end border-t border-slate-800 p-2">
            <button
              onClick={apply}
              disabled={selected.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40"
            >
              Применить{selected.length > 0 ? ` (${selected.length})` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
