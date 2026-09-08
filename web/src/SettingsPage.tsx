import { useCallback, useEffect, useState } from "react";

interface SystemConfig {
  model?: string;
  port?: number;
  apiKeys?: Record<string, string>;
  maxHandoffs?: number;
  maxRecoveries?: number;
  stallTimeoutMs?: number;
  maxUploadSizeMb?: number;
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

  const [keyEntries, setKeyEntries] = useState<{ provider: string; key: string }[]>([]);
  const [origKeys, setOrigKeys] = useState<string>("");

  const load = useCallback(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: SystemConfig) => {
        setCfg(data);
        setOriginal(JSON.parse(JSON.stringify(data)));
        const keys = data.apiKeys ?? {};
        const entries = Object.entries(keys).map(([provider, key]) => ({ provider, key }));
        setKeyEntries(entries);
        setOrigKeys(JSON.stringify(entries));
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => { load(); }, [load]);

  const anyDirty = (() => {
    if (!cfg || !original) return false;
    const keysDirty = JSON.stringify(keyEntries) !== origKeys;
    const fieldsDirty =
      (cfg.model ?? "") !== (original.model ?? "") ||
      (cfg.port ?? 3000) !== (original.port ?? 3000) ||
      (cfg.maxHandoffs ?? 200) !== (original.maxHandoffs ?? 200) ||
      (cfg.maxRecoveries ?? 2) !== (original.maxRecoveries ?? 2) ||
      (cfg.stallTimeoutMs ?? 180000) !== (original.stallTimeoutMs ?? 180000) ||
      (cfg.maxUploadSizeMb ?? 50) !== (original.maxUploadSizeMb ?? 50);
    return keysDirty || fieldsDirty;
  })();

  // Защита при закрытии вкладки
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
      const apiKeys: Record<string, string> = {};
      for (const e of keyEntries) {
        if (e.provider.trim()) apiKeys[e.provider.trim()] = e.key;
      }
      const payload: SystemConfig = {
        model: cfg.model,
        port: cfg.port,
        apiKeys,
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
      setOrigKeys(JSON.stringify(keyEntries));
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

  if (!cfg) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-slate-400">
        Загрузка…
      </div>
    );
  }

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
          <Field
            label="Модель ИИ (provider/model)"
            hint="Формат: provider/model-name. Применяется к новым сессиям."
          >
            <input
              value={cfg.model ?? ""}
              onChange={(e) => set("model", e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
              placeholder="eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf"
            />
          </Field>

          {/* Port */}
          <Field
            label="Порт сервера"
            hint="Изменение порта требует перезапуск сервера."
          >
            <input
              type="number"
              value={cfg.port ?? 3000}
              onChange={(e) => set("port", Number(e.target.value))}
              className="w-32 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
            />
          </Field>

          {/* API Keys */}
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-400">API-ключи</label>
            <div className="space-y-2">
              {keyEntries.map((entry, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={entry.provider}
                    onChange={(e) => {
                      const next = [...keyEntries];
                      next[i] = { ...next[i], provider: e.target.value };
                      setKeyEntries(next);
                      setSaved(false);
                    }}
                    className="w-36 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                    placeholder="provider"
                  />
                  <input
                    value={entry.key}
                    onChange={(e) => {
                      const next = [...keyEntries];
                      next[i] = { ...next[i], key: e.target.value };
                      setKeyEntries(next);
                      setSaved(false);
                    }}
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                    placeholder="api-key"
                  />
                  <button
                    onClick={() => { setKeyEntries(keyEntries.filter((_, j) => j !== i)); setSaved(false); }}
                    className="rounded-lg border border-slate-700 px-2.5 text-slate-500 hover:border-rose-500 hover:text-rose-400"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => { setKeyEntries([...keyEntries, { provider: "", key: "" }]); setSaved(false); }}
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
            ⚠️ Ограничения применяются после рестарта сервера. Модель и API-ключи — для новых сессий.
          </p>
        </div>
      </main>
    </div>
  );
}
