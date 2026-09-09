import { useCallback, useEffect, useState } from "react";
import { HelpTip } from "./components/HelpTip";

interface AgentFileEntry {
  filename: string;
  content: string;
}

interface AgentDetail {
  id: string;
  name: string;
  description: string;
  tools: string[];
  model: string | null;
  thinkingLevel: string | null;
  systemPrompt: string;
  rules: AgentFileEntry[];
  skills: AgentFileEntry[];
}

interface AgentListItem {
  id: string;
  name: string;
  description: string;
}

const KNOWN_TOOLS = [
  "read", "write", "edit", "bash",
  "mcp", "mcpScript",
  "route_to_agent", "list_agents", "ask_user",
  "create_agent", "delete_agent",
];

function borderClass(dirty: boolean): string {
  return dirty
    ? "border-red-500"
    : "border-emerald-600/40";
}

export default function AgentEditor({ onBack }: { onBack: () => void }) {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<AgentDetail | null>(null);
  const [original, setOriginal] = useState<AgentDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Список моделей всех провайдеров для dropdown
  const [allModels, setAllModels] = useState<string[]>([]);
  const [globalModel, setGlobalModel] = useState<string>("");

  // Загрузка списка агентов
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d: AgentListItem[]) => {
        setAgents(d);
        if (d.length > 0) setSelectedId(d[0].id);
      })
      .catch(() => setError("Не удалось загрузить список агентов"));
  }, []);

  // Загрузка моделей всех провайдеров + глобальная модель
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: { model?: string; providers?: Record<string, { url: string; apiKey: string }> }) => {
        setGlobalModel(cfg.model ?? "");
        const provs = cfg.providers ?? {};
        const ids = Object.keys(provs);
        if (ids.length === 0) return;
        Promise.all(
          ids.map((id) =>
            fetch(`/api/providers/${encodeURIComponent(id)}/models`)
              .then((r) => r.json())
              .then((d: { models: string[] }) =>
                (d.models ?? []).map((m) => `${id}/${m}`)
              )
              .catch(() => [] as string[])
          )
        ).then((results) => {
          setAllModels(results.flat().sort());
        });
      })
      .catch(() => { /* ignore */ });
  }, []);

  // Загрузка деталей выбранного агента
  useEffect(() => {
    if (!selectedId) return;
    setSaved(false);
    fetch(`/api/agents/${selectedId}/detail`)
      .then((r) => r.json())
      .then((d: AgentDetail) => {
        setData(d);
        setOriginal(JSON.parse(JSON.stringify(d)));
      })
      .catch(() => setError(`Не удалось загрузить агента ${selectedId}`));
  }, [selectedId]);

  const isDirty = useCallback(
    (field: keyof AgentDetail): boolean => {
      if (!data || !original) return false;
      return JSON.stringify(data[field]) !== JSON.stringify(original[field]);
    },
    [data, original],
  );

  const anyDirty = !!(data && original && (
    isDirty("name") || isDirty("description") || isDirty("tools") ||
    isDirty("model") || isDirty("thinkingLevel") || isDirty("systemPrompt") ||
    isDirty("rules") || isDirty("skills")
  ));

  /** Запустить действие с защитой от потери изменений. */
  const guardedAction = (action: () => void) => {
    if (anyDirty) {
      const ok = window.confirm("Есть несохранённые изменения.\nЕсли вы уйдёте сейчас, внесённые данные будут потеряны.\n\nПродолжить?");
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

  // Мобильный drawer со списком агентов
  const [listOpen, setListOpen] = useState(false);



  const save = async () => {
    if (!data || !original) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOriginal(JSON.parse(JSON.stringify(data)));
      // Обновляем список агентов (имя могло измениться)
      const fresh = await fetch("/api/agents").then((r) => r.json());
      setAgents(fresh);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof AgentDetail>(key: K, value: AgentDetail[K]) => {
    setData((prev) => prev ? { ...prev, [key]: value } : prev);
    setSaved(false);
  };

  // Rules / Skills helpers
  const updateFile = (
    listKey: "rules" | "skills",
    index: number,
    field: "filename" | "content",
    value: string,
  ) => {
    if (!data) return;
    const arr = [...(data[listKey] as AgentFileEntry[])];
    arr[index] = { ...arr[index], [field]: value };
    updateField(listKey, arr as never);
  };

  const addFile = (listKey: "rules" | "skills") => {
    if (!data) return;
    const arr = [...(data[listKey] as AgentFileEntry[]), { filename: `new-${listKey}.md`, content: "" }];
    updateField(listKey, arr as never);
  };

  const removeFile = (listKey: "rules" | "skills", index: number) => {
    if (!data) return;
    const arr = [...(data[listKey] as AgentFileEntry[])];
    arr.splice(index, 1);
    updateField(listKey, arr as never);
  };

  const toggleTool = (tool: string) => {
    if (!data) return;
    const tools = data.tools.includes(tool)
      ? data.tools.filter((t) => t !== tool)
      : [...data.tools, tool];
    updateField("tools", tools);
  };

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      {/* Верхняя панель */}
      <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-3 sm:gap-3 sm:px-6">
        <button
          onClick={() => setListOpen(true)}
          className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 md:hidden"
          aria-label="Список агентов"
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
        <h1 className="hidden text-lg font-semibold sm:block">Редактор агентов</h1>
        {error && <span className="text-sm text-red-400">{error}</span>}
        <div className="ml-auto flex items-center gap-3">
          {saved && <span className="hidden text-sm text-emerald-400 sm:inline">✓ Сохранено</span>}
          <button
            onClick={save}
            disabled={!anyDirty || saving}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 sm:px-5"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Мобильный overlay для drawer */}
        {listOpen && (
          <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setListOpen(false)} />
        )}
        {/* Левая панель: список агентов (drawer на мобильных, статичная на md+) */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950 transition-transform duration-200 md:static md:w-64 md:translate-x-0 md:bg-slate-900/50 ${
            listOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="border-b border-slate-800 p-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            Агенты ({agents.length})
          </div>
          <nav className="flex-1 overflow-y-auto pb-3">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  if (a.id === selectedId) return;
                  guardedAction(() => {
                    setSelectedId(a.id);
                    setListOpen(false);
                  });
                }}
                className={`block w-full px-4 py-2.5 text-left text-sm transition-colors ${
                  selectedId === a.id
                    ? "bg-indigo-600/20 text-indigo-300"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <div className="font-medium">{a.name}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{a.id}</div>
              </button>
            ))}
          </nav>
        </aside>

        {/* Правая панель: форма */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {!data ? (
            <p className="text-slate-500">Выберите агента…</p>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {/* ID (read-only) */}
              <Field label="ID" dirty={false}>
                <input
                  value={data.id}
                  disabled
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-500"
                />
              </Field>

              {/* Name */}
              <Field label="Название (отображаемое)" dirty={isDirty("name")}>
                <input
                  value={data.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  className={`w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500 ${borderClass(isDirty("name"))}`}
                />
              </Field>

              {/* Description */}
              <Field label="Описание" dirty={isDirty("description")}>
                <textarea
                  value={data.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  rows={3}
                  className={`w-full resize-y rounded-lg border bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500 ${borderClass(isDirty("description"))}`}
                />
              </Field>

              {/* Tools */}
              <Field label="Инструменты" dirty={isDirty("tools")}>
                <div className={`flex flex-wrap gap-2 rounded-lg border bg-slate-900 p-3 ${borderClass(isDirty("tools"))}`}>
                  {KNOWN_TOOLS.map((tool) => (
                    <label key={tool} className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-slate-800">
                      <input
                        type="checkbox"
                        checked={data.tools.includes(tool)}
                        onChange={() => toggleTool(tool)}
                        className="h-3.5 w-3.5 accent-indigo-500"
                      />
                      <span className="font-mono">{tool}</span>
                    </label>
                  ))}
                </div>
              </Field>

              {/* Model (override) */}
              <Field
                label="Модель (опционально, override)"
                dirty={isDirty("model")}
                help={'По умолчанию используется глобальная модель из config.json. Выберите конкретную модель для override.'}
              >
                <select
                  value={data.model ?? ""}
                  onChange={(e) => updateField("model", e.target.value || null)}
                  className={`w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500 ${borderClass(isDirty("model"))}`}
                >
                  <option value="">{globalModel ? `(глобальная: ${globalModel})` : "(использовать глобальную)"}</option>
                  {allModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>

              {/* Thinking level */}
              <Field label="Thinking Level (опционально)" dirty={isDirty("thinkingLevel")}>
                <select
                  value={data.thinkingLevel ?? ""}
                  onChange={(e) => updateField("thinkingLevel", e.target.value || null)}
                  className={`w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500 ${borderClass(isDirty("thinkingLevel"))}`}
                >
                  <option value="">(по умолчанию)</option>
                  {["off", "minimal", "low", "medium", "high", "xhigh"].map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </Field>

              {/* System Prompt */}
              <Field label="Системный промпт (AGENT.md)" dirty={isDirty("systemPrompt")}>
                <textarea
                  value={data.systemPrompt}
                  onChange={(e) => updateField("systemPrompt", e.target.value)}
                  rows={14}
                  className={`w-full rounded-lg border bg-slate-900 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-indigo-500 ${borderClass(isDirty("systemPrompt"))}`}
                />
              </Field>

              {/* Rules */}
              <SectionFiles
                title="Правила (rules/)"
                help={'Отдельные .md-файлы с правилами для агента. Каждый файл — одно правило (напр. commit-messages.md, safety-first.md). Содержимое подключается к системному промпту автоматически.'}
                files={data.rules}
                dirty={isDirty("rules")}
                onAdd={() => addFile("rules")}
                onRemove={(i) => removeFile("rules", i)}
                onChange={(i, field, val) => updateFile("rules", i, field, val)}
              />

              {/* Skills */}
              <SectionFiles
                title="Навыки (skills/)"
                help={'Markdown-файлы с инструкциями для повторяющихся задач. Формат: frontmatter (name, description) + тело. Агент выбирает нужный навык по контексту.'}
                files={data.skills}
                dirty={isDirty("skills")}
                onAdd={() => addFile("skills")}
                onRemove={(i) => removeFile("skills", i)}
                onChange={(i, field, val) => updateFile("skills", i, field, val)}
              />

              {/* Save button (bottom) */}
              <div className="flex justify-end pb-8">
                <button
                  onClick={save}
                  disabled={!anyDirty || saving}
                  className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40"
                >
                  {saving ? "Сохранение…" : "Сохранить изменения"}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

    </div>
  );
}

// --- Вспомогательные компоненты ---

function Field({ label, dirty, help, children }: { label: string; dirty: boolean; help?: string; children: React.ReactNode }) {
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

function SectionFiles({
  title, files, dirty, onAdd, onRemove, onChange, help,
}: {
  title: string;
  files: AgentFileEntry[];
  dirty: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, field: "filename" | "content", value: string) => void;
  help?: string;
}) {
  return (
    <Field label={title} dirty={dirty} help={help}>
      <div className={`space-y-3 rounded-lg border bg-slate-900/50 p-3 ${borderClass(dirty)}`}>
        {files.length === 0 && (
          <p className="text-xs text-slate-500">Нет файлов</p>
        )}
        {files.map((f, i) => (
          <div key={i} className="rounded-lg border border-slate-700 bg-slate-900 p-2.5">
            <div className="mb-2 flex items-center gap-2">
              <input
                value={f.filename}
                onChange={(e) => onChange(i, "filename", e.target.value)}
                className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-xs outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => onRemove(i)}
                className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
                title="Удалить файл"
              >
                ✕
              </button>
            </div>
            <textarea
              value={f.content}
              onChange={(e) => onChange(i, "content", e.target.value)}
              rows={6}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 font-mono text-xs leading-relaxed outline-none focus:border-indigo-500"
            />
          </div>
        ))}
        <button
          onClick={onAdd}
          className="w-full rounded-lg border border-dashed border-slate-600 py-2 text-xs text-slate-400 hover:border-indigo-500 hover:text-indigo-300"
        >
          + Добавить файл
        </button>
      </div>
    </Field>
  );
}
