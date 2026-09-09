import { useState } from "react";
import { createPortal } from "react-dom";
import type { AgentInfo, ContextMeta } from "../api";
import { agentColor, formatBytes } from "../utils/format";

export interface ArchiveInfo {
  state: "queued" | "preparing" | "ready" | "error";
  url?: string;
  error?: string;
}

const MENU_W = 176;
const MENU_H = 84;

export function Sidebar({
  contexts,
  agents,
  activeCtx,
  running,
  renamingCtx,
  renameValue,
  sidebarOpen,
  archiveStatus,
  contextSizes,
  onSidebarClose,
  onCreateContext,
  onSelectContext,
  onDeleteContext,
  onRenameStart,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
  onPrepareArchive,
  onDownloadArchive,
  agentName,
}: {
  contexts: ContextMeta[];
  agents: AgentInfo[];
  activeCtx: ContextMeta | null;
  running: { ctxId: string; agentId: string } | null;
  renamingCtx: string | null;
  renameValue: string;
  sidebarOpen: boolean;
  archiveStatus: Record<string, ArchiveInfo>;
  /** Размер директории контекста в байтах: { [ctxId]: number } */
  contextSizes: Record<string, number>;
  onSidebarClose: () => void;
  onCreateContext: () => void;
  onSelectContext: (id: string) => void;
  onDeleteContext: (id: string) => void;
  onRenameStart: (id: string) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  onPrepareArchive: (id: string) => void;
  onDownloadArchive: (id: string) => void;
  agentName: (id: string) => string;
}) {
  // Контекстное меню: координаты в fixed-системе (портал в body)
  const [menu, setMenu] = useState<{ ctxId: string; x: number; y: number } | null>(null);

  const openMenu = (ctxId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let x = rect.right - MENU_W;
    x = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8));
    let y = rect.bottom + 4;
    if (y + MENU_H > window.innerHeight - 8) y = Math.max(8, rect.top - MENU_H - 4);
    setMenu({ ctxId, x, y });
  };

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
            🤖 Редактор агентов
          </a>
          <a
            href="#/skills"
            className="mt-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
          >
            ⚡ Навыки
          </a>
          <a
            href="#/settings"
            className="mt-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
          >
            ⚙️ Настройки
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
          {contexts.map((c) => {
            const arch = archiveStatus[c.id];
            return (
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
                    onContextMenu={(e) => openMenu(c.id, e)}
                    title={contextSizes[c.id] != null
                      ? `contexts/${c.id} (${formatBytes(contextSizes[c.id])})`
                      : `contexts/${c.id}`}
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
                {/* Статус архива */}
                {arch?.state === "queued" || arch?.state === "preparing" ? (
                  <span
                    className="mx-1 h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-500 border-t-transparent"
                    title="Подготовка архива…"
                  />
                ) : arch?.state === "ready" ? (
                  <button
                    onClick={() => onDownloadArchive(c.id)}
                    title="Скачать архив"
                    className="mx-1 shrink-0 rounded px-1.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20"
                  >
                    ⬇
                  </button>
                ) : arch?.state === "error" ? (
                  <span className="mx-1 shrink-0 cursor-help px-1 text-xs" title={`Ошибка архива: ${arch.error}`}>
                    ⚠️
                  </span>
                ) : null}
                {/* Кнопка меню */}
                <button
                  onClick={(e) => openMenu(c.id, e)}
                  title="Действия"
                  className="shrink-0 rounded px-1.5 py-1 text-sm text-slate-500 hover:bg-slate-800 hover:text-white md:opacity-0 md:group-hover:opacity-100"
                >
                  ⋮
                </button>
              </div>
            );
          })}
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

      {/* Контекстное меню (портал: aside имеет transform, fixed внутри него ломается) */}
      {menu &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[60]"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(null);
              }}
            />
            <div
              style={{ left: menu.x, top: menu.y }}
              className="fixed z-[61] w-44 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
            >
              <button
                onClick={() => {
                  setMenu(null);
                  onPrepareArchive(menu.ctxId);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
              >
                ⬇️ Скачать архив
              </button>
              <button
                onClick={() => {
                  setMenu(null);
                  onDeleteContext(menu.ctxId);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-rose-300 hover:bg-rose-500/10"
              >
                🗑 Удалить
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
