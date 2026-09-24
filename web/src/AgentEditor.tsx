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
  /** Отключённые pi-инструменты (denylist). Всё, что не указано — включено. */
  disabledTools: string[];
  model: string | null;
  thinkingLevel: string | null;
  forgetSessionAfterStep: boolean;
  systemPrompt: string;
  rules: AgentFileEntry[];
  skills: AgentFileEntry[];
}

interface AgentListItem {
  id: string;
  name: string;
  description: string;
}

/** Системные инструменты проекта. locked = отключить нельзя; остальные можно
 * выключить через тот же denylist (disabledTools), что и pi-инструменты. */
const SYSTEM_TOOLS: { name: string; label: string; locked?: boolean }[] = [
  { name: "route_to_agent", label: "Передача другому агенту", locked: true },
  { name: "list_agents", label: "Список агентов", locked: true },
  { name: "ask_user", label: "Вопрос пользователю" },
  { name: "handoff_file", label: "Файл передачи" },
  { name: "list_skills", label: "Список навыков" },
  { name: "use_skill", label: "Применить навык" },
  { name: "artifact_store", label: "Хранилище артефактов" },
];

interface PiToolInfo {
  name: string;
  description?: string;
}

interface PiToolGroupInfo {
  id: string;
  title: string;
  tools: PiToolInfo[];
}

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
    isDirty("name") || isDirty("description") || isDirty("disabledTools") ||
    isDirty("model") || isDirty("thinkingLevel") || isDirty("forgetSessionAfterStep") ||
    isDirty("systemPrompt") ||
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

  // Инструменты pi: список групп с сервера (встроенные + пакеты из `pi install`)
  const [toolGroups, setToolGroups] = useState<PiToolGroupInfo[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/tools")
      .then((r) => r.json())
      .then((d: { groups: PiToolGroupInfo[] }) => {
        setToolGroups(d.groups ?? []);
        setOpenGroups(Object.fromEntries((d.groups ?? []).map((g) => [g.id, true])));
      })
      .catch(() => { /* ignore — раздел инструментов pi останется пустым */ });
  }, []);

  /** Включён ли инструмент (всё включено, кроме denylist). */
  const isToolEnabled = useCallback(
    (name: string): boolean => !!(data && !data.disabledTools.includes(name)),
    [data],
  );

  const toggleTool = (tool: string) => {
    if (!data) return;
    const disabled = data.disabledTools.includes(tool)
      ? data.disabledTools.filter((t) => t !== tool)
      : [...data.disabledTools, tool];
    updateField("disabledTools", disabled);
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

              {/* System tools — always on */}
              <Field label="Инструменты системы" dirty={isDirty("disabledTools")} help="Инструменты протокола работы проекта. Заблокированные отключить нельзя; ask_user можно выключить, чтобы запретить агенту задавать вопросы пользователю.">
                <div className={`flex flex-wrap gap-2 rounded-lg border bg-slate-900 p-3 ${borderClass(false)}`}>
                  {SYSTEM_TOOLS.map((tool) =>
                    tool.locked ? (
                      <label key={tool.name} title="Системное свойство (не отключаемое)" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs opacity-70">
                        <input type="checkbox" checked disabled className="h-3.5 w-3.5 accent-indigo-500" />
                        <span className="font-mono">{tool.name}</span>
                        <span className="text-slate-500">— {tool.label}</span>
                      </label>
                    ) : (
                      <label key={tool.name} title={`Отключить «${tool.label.toLowerCase()}» для этого агента`} className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-slate-800">
                        <input
                          type="checkbox"
                          checked={isToolEnabled(tool.name)}
                          onChange={() => toggleTool(tool.name)}
                          className="h-3.5 w-3.5 accent-indigo-500"
                        />
                        <span className="font-mono">{tool.name}</span>
                        <span className="text-slate-500">— {tool.label}</span>
                      </label>
                    ),
                  )}
                </div>
              </Field>

              {/* PI tools — grouped, master checkbox per group */}
              <Field label="Инструменты PI" dirty={isDirty("disabledTools")} help="Всё, что установлено через `pi install`, включено по умолчанию. Снимите галочку, чтобы отключить инструмент или группу целиком.">
                <div className={`space-y-2 rounded-lg border bg-slate-900 p-3 ${borderClass(isDirty("disabledTools"))}`}>
                  {toolGroups.length === 0 && (
                    <p className="text-xs text-slate-500">Список инструментов загружается…</p>
                  )}
                  {toolGroups.map((group) => {
                    const enabledCount = group.tools.filter((t) => isToolEnabled(t.name)).length;
                    const allEnabled = enabledCount === group.tools.length;
                    const open = openGroups[group.id] !== false;
                    return (
                      <div key={group.id} className="rounded-md border border-slate-800">
                        {/* Group header + master checkbox */}
                        <div
                          className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-slate-800/60"
                          onClick={() => setOpenGroups((s) => ({ ...s, [group.id]: !open }))}
                        >
                          <span className={`text-xs text-slate-500 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
                          <input
                            type="checkbox"
                            checked={allEnabled}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => {
                              if (!data) return;
                              const names = new Set(group.tools.map((t) => t.name));
                              const disabled = allEnabled
                                ? [...new Set([...data.disabledTools, ...group.tools.map((t) => t.name)])]
                                : data.disabledTools.filter((t) => !names.has(t));
                              updateField("disabledTools", disabled);
                            }}
                            title={allEnabled ? "Отключить всю группу" : "Включить всю группу"}
                            className="h-4 w-4 accent-indigo-500"
                          />
                          <span className="text-sm font-medium text-slate-200">{group.title}</span>
                          <span className="ml-auto text-xs text-slate-500">
                            {enabledCount}/{group.tools.length}
                          </span>
                        </div>
                        {/* Individual tools */}
                        {open && (
                          <div className="grid gap-1 border-t border-slate-800 px-3 py-2 sm:grid-cols-2">
                            {group.tools.map((tool) => (
                              <label key={tool.name} title={tool.description || undefined} className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-slate-800/60">
                                <input
                                  type="checkbox"
                                  checked={isToolEnabled(tool.name)}
                                  onChange={() => toggleTool(tool.name)}
                                  className="h-3.5 w-3.5 accent-indigo-500"
                                />
                                <span className="font-mono">{tool.name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
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

              {/* Forget session after step */}
              <Field
                label="Забывать сессию после завершения шага"
                dirty={isDirty("forgetSessionAfterStep")}
                help={'Когда этот агент завершает свой шаг и чат передаётся другому агенту, его pi-сессия удаляется (остаётся только история сообщений в чате). При возврате строится новая сессия из истории — естественное «сжатие» контекста агента.'}
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={data.forgetSessionAfterStep === true}
                    onChange={(e) => updateField("forgetSessionAfterStep", e.target.checked)}
                    className="h-4 w-4 accent-indigo-500"
                  />
                  <span>Удалять pi-сессию агента после передачи чата другому агенту</span>
                </label>
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
