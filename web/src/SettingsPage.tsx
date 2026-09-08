import { useCallback, useEffect, useState } from "react";

interface Provider {
  url: string;
  apiKey: string;
}

interface SystemConfig {
  model?: string;
  port?: number;
  providers?: Record<string, Provider>;
  apiKeys?: Record<string, string>; // legacy
  maxHandoffs?: number;
  maxRecoveries?: number;
  stallTimeoutMs?: number;
  maxUploadSizeMb?: number;
}

interface ProviderEntry {
  id: string;
  url: string;
  apiKey: string;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-400">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

export default function SettingsPage({ onBack }: { onBack: () => void }) {
  const [cfg, setCfg] = useState<SystemConfig | null>(null);
  const [original, setOriginal] = useState<SystemConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Providers as flat list
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [origProviders, setOrigProviders] = useState<string>("");

  // Model selection
  const [selectedProvider, setSelectedProvider] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsStale, setModelsStale] = useState(false);

  const load = useCallback(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: SystemConfig) => {
        setCfg(data);
        setOriginal(JSON.parse(JSON.stringify(data)));
        // Providers
        const provs = data.providers ?? {};
        const entries = Object.entries(provs).map(([id, p]) => ({ id, url: p.url ?? "", apiKey: p.apiKey ?? "" }));
        setProviders(entries);
        setOrigProviders(JSON.stringify(entries));
        // Default selected provider from current model
        const model = data.model ?? "";
        const provId = model.split("/")[0];
        if (provs[provId]) {
          setSelectedProvider(provId);
        } else if (entries.length > 0) {
          setSelectedProvider(entries[0].id);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load models when provider changes
  useEffect(() => {
    if (!selectedProvider) return;
    setModelsLoading(true);
    setModelsStale(false);
    fetch(`/api/providers/${encodeURIComponent(selectedProvider)}/models`)
      .then((r) => r.json())
      .then((data: { models: string[]; stale?: boolean; error?: string }) => {
        setAvailableModels(data.models ?? []);
        setModelsStale(!!data.stale);
        if (data.error) console.warn("Models fetch warning:", data.error);
      })
      .catch(() => setAvailableModels([]))
      .finally(() => setModelsLoading(false));
  }, [selectedProvider]);

  const anyDirty = (() => {
    if (!cfg || !original) return false;
    const provsDirty = JSON.stringify(providers) !== origProviders;
    const fieldsDirty =
      (cfg.model ?? "") !== (original.model ?? "") ||
      (cfg.port ?? 3000) !== (original.port ?? 3000) ||
      (cfg.maxHandoffs ?? 200) !== (original.maxHandoffs ?? 200) ||
      (cfg.maxRecoveries ?? 2) !== (original.maxRecoveries ?? 2) ||
      (cfg.stallTimeoutMs ?? 180000) !== (original.stallTimeoutMs ?? 180000) ||
      (cfg.maxUploadSizeMb ?? 50) !== (original.maxUploadSizeMb ?? 50);
    return provsDirty || fieldsDirty;
  })();

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  const guardedAction = (action: () => void) => {
    if (anyDirty) {
      const ok = window.confirm("Есть несохранённые изменения.\nПродолжить?");
      if (!ok) return;
    }
    action();
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    setError(null);
    try {
      const provs: Record<string, Provider> = {};
      for (const p of providers) {
        if (p.id.trim()) provs[p.id.trim()] = { url: p.url, apiKey: p.apiKey };
      }
      const payload: SystemConfig = {
        model: cfg.model,
        port: cfg.port,
        providers: provs,
        maxHandoffs: cfg.maxHandoffs,
        maxRecoveries: cfg.maxRecoveries,
        stallTimeoutMs: cfg.stallTimeoutMs,
        maxUploadSizeMb: cfg.maxUploadSizeMb,
      };
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOriginal(JSON.parse(JSON.stringify(payload)));
      setOrigProviders(JSON.stringify(providers));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const set = (field: keyof SystemConfig, value: unknown) => {
    setCfg((c) => (c ? { ...c, [field]: value } : c));
    setSaved(false);
  };

  const updateProvider = (index: number, field: keyof ProviderEntry, value: string) => {
    const next = [...providers];
    next[index] = { ...next[index], [field]: value };
    setProviders(next);
    setSaved(false);
  };

  if (!cfg) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-slate-400">
        Загрузка…
      </div>
    );
  }

  const modelProvider = selectedProvider || (cfg.model ?? "").split("/")[0];
  const modelValue = cfg.model ?? "";

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3 sm:px-6">
        <button
          onClick={() => guardedAction(onBack)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          ← Чат
        </button>
        <h1 className="text-lg font-semibold">Настройки системы</h1>
        {error && <span className="text-sm text-red-400">{error}</span>}
        <div className="ml-auto flex items-center gap-3">
          {saved && <span className="text-sm text-emerald-400">✓ Сохранено</span>}
          <button
            onClick={save}
            disabled={!anyDirty || saving}
            className="rounded-lg bg-indigo-600 px-5 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-2xl space-y-5">

          {/* Model */}
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-400">Модель ИИ</label>
            <div className="flex gap-2">
              <select
                value={modelProvider}
                onChange={(e) => {
                  const pid = e.target.value;
                  setSelectedProvider(pid);
                  // Clear model when provider changes
                  set("model", "");
                }}
                className="w-40 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.id || "—"}</option>
                ))}
              </select>
              <select
                value={modelValue.includes("/") ? modelValue.split("/").slice(1).join("/") : modelValue}
                onChange={(e) => {
                  const modelName = e.target.value;
                  set("model", modelName ? `${modelProvider}/${modelName}` : "");
                }}
                disabled={modelsLoading || availableModels.length === 0}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-50"
              >
                <option value="">
                  {modelsLoading ? "Загрузка…" : availableModels.length === 0 ? "Недоступно" : "Выберите модель"}
                </option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            {modelsStale && (
              <p className="text-xs text-amber-500">⚠️ Провайдер недоступен — показан кеш моделей.</p>
            )}
            {modelValue && (
              <p className="text-xs text-slate-600">Текущая: <code className="text-slate-400">{modelValue}</code></p>
            )}
          </div>

          {/* Port */}
          <Field label="Порт сервера" hint="Изменение порта требует перезапуск сервера.">
            <input
              type="number"
              value={cfg.port ?? 3000}
              onChange={(e) => set("port", Number(e.target.value))}
              className="w-32 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
            />
          </Field>

          {/* Providers */}
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-400">Провайдеры</label>
            <div className="space-y-3">
              {providers.map((p, i) => (
                <div key={i} className="rounded-lg border border-slate-800 bg-slate-900/30 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      value={p.id}
                      onChange={(e) => updateProvider(i, "id", e.target.value)}
                      className="w-36 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
                      placeholder="id (e.g. eac-mac-ai)"
                    />
                    <button
                      onClick={() => { setProviders(providers.filter((_, j) => j !== i)); setSaved(false); }}
                      className="rounded-lg border border-slate-700 px-2 text-xs text-slate-500 hover:border-rose-500 hover:text-rose-400"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="space-y-2">
                    <input
                      value={p.url}
                      onChange={(e) => updateProvider(i, "url", e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
                      placeholder="URL (e.g. http://localhost:44221)"
                    />
                    <input
                      value={p.apiKey}
                      onChange={(e) => updateProvider(i, "apiKey", e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
                      placeholder="API key"
                    />
                  </div>
                </div>
              ))}
              <button
                onClick={() => { setProviders([...providers, { id: "", url: "", apiKey: "" }]); setSaved(false); }}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                + Добавить провайдера
              </button>
            </div>
          </div>

          {/* Limits */}
          <div className="border-t border-slate-800 pt-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Ограничения</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Макс. передач в цепочке" hint="Защита от бесконечных циклов.">
                <input
                  type="number"
                  value={cfg.maxHandoffs ?? 200}
                  onChange={(e) => set("maxHandoffs", Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                />
              </Field>
              <Field label="Макс. авто-восстановлений" hint="Сколько раз система чинит прерванную цепочку.">
                <input
                  type="number"
                  value={cfg.maxRecoveries ?? 2}
                  onChange={(e) => set("maxRecoveries", Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                />
              </Field>
              <Field label="Таймаут зависшей сессии (сек)" hint="Нет событий дольше — сессия прерывается.">
                <input
                  type="number"
                  value={Math.round((cfg.stallTimeoutMs ?? 180000) / 1000)}
                  onChange={(e) => set("stallTimeoutMs", Number(e.target.value) * 1000)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                />
              </Field>
              <Field label="Макс. размер файла (МБ)" hint="Ограничение на загрузку файлов.">
                <input
                  type="number"
                  value={cfg.maxUploadSizeMb ?? 50}
                  onChange={(e) => set("maxUploadSizeMb", Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                />
              </Field>
            </div>
          </div>

          {/* Note */}
          <p className="text-xs text-slate-600">
            ⚠️ Ограничения применяются после рестарта сервера. Модель и провайдеры — для новых сессий.
          </p>
        </div>
      </main>
    </div>
  );
}
