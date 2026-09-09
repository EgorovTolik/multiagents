import { useCallback, useEffect, useState } from "react";
import { HelpTip } from "./components/HelpTip";

interface SkillListItem {
  id: string;
  name: string;
  description: string;
}

interface SkillDetail extends SkillListItem {
  body: string;
}

function borderClass(dirty: boolean): string {
  return dirty ? "border-red-500" : "border-emerald-600/40";
}

function genId(): string {
  // skill- + 4 hex (crypto доступен в браузере)
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return "skill-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function SkillsPage({ onBack }: { onBack: () => void }) {
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<SkillDetail | null>(null);
  const [original, setOriginal] = useState<SkillDetail | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Мобильный drawer со списком
  const [listOpen, setListOpen] = useState(false);

  const refreshList = useCallback(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d: SkillListItem[]) => setSkills(d))
      .catch(() => setError("Не удалось загрузить список навыков"));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Загрузка деталей выбранного навыка
  useEffect(() => {
    if (!selectedId) return;
    setSaved(false);
    fetch(`/api/skills/${encodeURIComponent(selectedId)}/detail`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: SkillDetail) => {
        setData(d);
        setOriginal(JSON.parse(JSON.stringify(d)));
        setIsNew(false);
      })
      .catch(() => setError(`Не удалось загрузить навык ${selectedId}`));
  }, [selectedId]);

  const isDirty = useCallback(
    (field: keyof SkillDetail): boolean => {
      if (!data || !original) return false;
      return JSON.stringify(data[field]) !== JSON.stringify(original[field]);
    },
    [data, original],
  );

  const anyDirty = !!(data && original && (isDirty("name") || isDirty("description") || isDirty("body")));

  /** Запустить действие с защитой от потери изменений. */
  const guardedAction = (action: () => void) => {
    if (anyDirty) {
      const ok = window.confirm(
        "Есть несохранённые изменения.\nЕсли вы уйдёте сейчас, внесённые данные будут потеряны.\n\nПродолжить?",
      );
      if (!ok) return;
      action();
    } else {
      action();
    }
  };

  // Защита при закрытии вкладки/окна
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  const updateField = <K extends keyof SkillDetail>(key: K, value: SkillDetail[K]) => {
    setData((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  };

  const createNew = () => {
    guardedAction(() => {
      const id = genId();
      const fresh: SkillDetail = { id, name: "", description: "", body: "" };
      setData(fresh);
      setOriginal(JSON.parse(JSON.stringify(fresh)));
      setSelectedId(null);
      setIsNew(true);
      setSaved(false);
      setError(null);
      setListOpen(false);
    });
  };

  const save = async () => {
    if (!data) return;
    if (!data.name.trim()) {
      setError("Укажите название навыка");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = isNew
        ? await fetch("/api/skills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          })
        : await fetch(`/api/skills/${encodeURIComponent(data.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: data.name, description: data.description, body: data.body }),
          });
      const d: SkillDetail = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setOriginal(JSON.parse(JSON.stringify(d)));
      setData(d);
      setIsNew(false);
      setSelectedId(d.id);
      refreshList();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const removeSkill = () => {
    if (!data || isNew) return;
    guardedAction(() => {
      if (!confirm(`Удалить навык «${data.name}»?`)) return;
      fetch(`/api/skills/${encodeURIComponent(data.id)}`, { method: "DELETE" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(() => {
          setData(null);
          setOriginal(null);
          setSelectedId(null);
          setIsNew(false);
          refreshList();
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Ошибка удаления"));
    });
  };

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      {/* Верхняя панель */}
      <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-3 sm:gap-3 sm:px-6">
        <button
          onClick={() => setListOpen(true)}
          className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 md:hidden"
          aria-label="Список навыков"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="4" x2="14" y2="4" />
            <line x1="2" y1="8" x2="14" y2="8" />
            <line x1="2" y1="12" x2="14" y2="12" />
          </svg>
        </button>
        <button
          onClick={() => guardedAction(onBack)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          ← Чат
        </button>
        <h1 className="hidden text-lg font-semibold sm:block">Навыки</h1>
        {error && <span className="text-sm text-red-400">{error}</span>}
        <div className="ml-auto flex items-center gap-3">
          {saved && <span className="hidden text-sm text-emerald-400 sm:inline">✓ Сохранено</span>}
          <button
            onClick={save}
            disabled={!data || !anyDirty || saving}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 sm:px-5"
          >
            {saving ? "Сохранение…" : isNew ? "Создать" : "Сохранить"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Мобильный overlay для drawer */}
        {listOpen && (
          <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setListOpen(false)} />
        )}
        {/* Левая панель: список навыков (drawer на мобильных, статичная на md+) */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950 transition-transform duration-200 md:static md:w-64 md:translate-x-0 md:bg-slate-900/50 ${
            listOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="border-b border-slate-800 p-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            Навыки ({skills.length})
          </div>
          <nav className="flex-1 overflow-y-auto pb-3">
            {skills.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  if (s.id === selectedId && !isNew) return;
                  guardedAction(() => {
                    setSelectedId(s.id);
                    setIsNew(false);
                    setListOpen(false);
                  });
                }}
                className={`block w-full px-4 py-2.5 text-left text-sm transition-colors ${
                  selectedId === s.id && !isNew
                    ? "bg-indigo-600/20 text-indigo-300"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <div className="font-medium">⚡ {s.name}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{s.id}</div>
              </button>
            ))}
          </nav>
          <div className="border-t border-slate-800 p-3">
            <button
              onClick={createNew}
              className="w-full rounded-lg border border-dashed border-slate-600 py-2 text-sm text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
            >
              + Новый навык
            </button>
          </div>
        </aside>

        {/* Правая панель: форма */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {!data ? (
            <p className="text-slate-500">Выберите навык слева или создайте новый…</p>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {/* ID */}
              <Field label="ID" dirty={false} help="Уникальный идентификатор: строчные латинские буквы, цифры, _ и дефис. После создания изменить нельзя.">
                <input
                  value={data.id}
                  disabled={!isNew}
                  onChange={(e) => updateField("id", e.target.value.trim())}
                  className={`w-full rounded-lg border bg-slate-900/50 px-3 py-2 font-mono text-sm text-slate-500 ${
                    isNew ? "border-emerald-600/40 outline-none focus:border-indigo-500" : ""
                  }`}
                />
              </Field>

              {/* Name */}
              <Field label="Название (отображаемое)" dirty={isDirty("name")}>
                <input
                  value={data.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="Например: Формат отчёта"
                  className={`w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500 ${borderClass(isDirty("name"))}`}
                />
              </Field>

              {/* Description */}
              <Field
                label="Короткое описание"
                dirty={isDirty("description")}
                help="Показывается в списке навыков при выборе для чата. Опишите, что умеет навык и когда его применять."
              >
                <textarea
                  value={data.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  rows={2}
                  placeholder="Одно-два предложения"
                  className={`w-full resize-none rounded-lg border bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500 ${borderClass(isDirty("description"))}`}
                />
              </Field>

              {/* Body */}
              <Field
                label="Тело навыка (инструкции)"
                dirty={isDirty("body")}
                help="Детальные инструкции, которые агент получит и должен выполнять. Markdown поддерживается."
              >
                <textarea
                  value={data.body}
                  onChange={(e) => updateField("body", e.target.value)}
                  rows={16}
                  placeholder={"## Инструкция\n\nОпиши пошагово, что агент должен делать…"}
                  className={`w-full resize-y rounded-lg border bg-slate-900 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-indigo-500 ${borderClass(isDirty("body"))}`}
                />
              </Field>

              {/* Delete (только для существующих) */}
              {!isNew && (
                <div className="pt-2">
                  <button
                    onClick={removeSkill}
                    className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-1.5 text-sm text-red-300 hover:bg-red-900/40"
                  >
                    Удалить навык
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Компоненты формы ──────────────────────────────────────────────────────────────

function Field({
  label,
  dirty,
  help,
  children,
}: {
  label: string;
  dirty: boolean;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
        {dirty && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-red-500" />}
        {help && <HelpTip text={help} />}
      </label>
      {children}
    </div>
  );
}
