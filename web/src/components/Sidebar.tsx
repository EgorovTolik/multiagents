import type { AgentInfo, ContextMeta } from "../api";
import { agentColor } from "../utils/format";

export function Sidebar({
  contexts,
  agents,
  activeCtx,
  running,
  renamingCtx,
  renameValue,
  sidebarOpen,
  onSidebarClose,
  onCreateContext,
  onSelectContext,
  onDeleteContext,
  onRenameStart,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
  agentName,
}: {
  contexts: ContextMeta[];
  agents: AgentInfo[];
  activeCtx: ContextMeta | null;
  running: { ctxId: string; agentId: string } | null;
  renamingCtx: string | null;
  renameValue: string;
  sidebarOpen: boolean;
  onSidebarClose: () => void;
  onCreateContext: () => void;
  onSelectContext: (id: string) => void;
  onDeleteContext: (id: string) => void;
  onRenameStart: (id: string) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  agentName: (id: string) => string;
}) {
  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onSidebarClose} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-slate-800 p-4">
          <h1 className="text-lg font-semibold text-white">Multiagents</h1>
          <p className="mt-1 text-xs text-slate-500">мультиагентная система на pi</p>
          <a
            href="#/agents"
            className="mt-3 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
          >
            ⚙️ Редактор агентов
          </a>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Контексты задач
            </span>
            <button
              onClick={onCreateContext}
              className="rounded px-2 py-0.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              +
            </button>
          </div>
          {contexts.map((c) => (
            <div
              key={c.id}
              className={`group mb-1 flex items-center rounded-md pr-1 ${
                activeCtx?.id === c.id ? "bg-slate-800" : "hover:bg-slate-900"
              }`}
            >
              {renamingCtx === c.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => onRenameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onRenameConfirm();
                    if (e.key === "Escape") onRenameCancel();
                  }}
                  onBlur={onRenameConfirm}
                  className="w-full min-w-0 flex-1 rounded border border-indigo-500 bg-slate-900 px-2 py-1 text-sm text-white outline-none"
                />
              ) : (
                <button
                  onClick={() => onSelectContext(c.id)}
                  onDoubleClick={() => onRenameStart(c.id)}
                  className={`block w-full min-w-0 flex-1 px-3 py-2 text-left text-sm ${
                    activeCtx?.id === c.id ? "text-white" : "text-slate-400"
                  }`}
                >
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        activeCtx?.id === c.id && running?.ctxId === c.id ? "animate-pulse bg-emerald-400" : "bg-slate-600"
                      }`}
                    />
                    {agentName(c.activeAgentId)}
                    {c.handoffs.length > 0 && (
                      <span className="text-slate-600">· {c.handoffs.length} передач</span>
                    )}
                  </div>
                </button>
              )}
              <button
                onClick={() => onDeleteContext(c.id)}
                title="Удалить контекст"
                className="hidden shrink-0 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-rose-500/20 hover:text-rose-300 group-hover:block"
              >
                ✕
              </button>
            </div>
          ))}
          {contexts.length === 0 && (
            <p className="px-2 py-4 text-xs text-slate-600">
              Нет контекстов — создай первый, чтобы начать
            </p>
          )}
        </div>
        <div className="border-t border-slate-800 p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Агенты</span>
          <ul className="mt-2 space-y-1">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-xs text-slate-400" title={a.description}>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${agentColor(a.id)}`}>
                  {a.id}
                </span>
                <span className="truncate">{a.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}
