import type { ContextMeta, Handoff } from "../api";
import type { ConnStatus } from "../api";
import { agentColor } from "../utils/format";

export function ChatHeader({
  ctx,
  running,
  pending,
  wsStatus,
  onOpenSidebar,
  onCancelHandoff,
  onAbort,
  agentName,
}: {
  ctx: ContextMeta;
  running: { ctxId: string; agentId: string } | null;
  pending: Handoff | null;
  wsStatus: ConnStatus;
  onOpenSidebar: () => void;
  onCancelHandoff: () => void;
  onAbort: () => void;
  agentName: (id: string) => string;
}) {
  return (
    <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3">
      <button
        onClick={onOpenSidebar}
        className="-ml-1 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white md:hidden"
        aria-label="Меню"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <h2 className="min-w-0 truncate font-semibold text-white">{ctx.name}</h2>
      <span className={`rounded border px-2 py-0.5 text-xs ${agentColor(ctx.activeAgentId)}`}>
        {agentName(ctx.activeAgentId)}
      </span>
      {running?.ctxId === ctx.id && (
        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          {agentName(running.agentId)} работает…
        </span>
      )}
      <span
        className={`ml-auto h-2.5 w-2.5 shrink-0 rounded-full ${
          wsStatus === "connected" ? "bg-emerald-400" : wsStatus === "connecting" ? "bg-amber-400 animate-pulse" : "bg-red-500"
        }`}
        title={wsStatus === "connected" ? "Подключено" : wsStatus === "connecting" ? "Подключение…" : "Отключено"}
      />
      <div className="flex shrink-0 gap-1.5 sm:gap-2">
        {pending && (
          <button
            onClick={onCancelHandoff}
            className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/20 sm:px-3"
          >
            <span className="hidden sm:inline">Отменить передачу → {agentName(pending.to)}</span>
            <span className="sm:hidden">✕ {agentName(pending.to)}</span>
          </button>
        )}
        {running && (
          <button
            onClick={onAbort}
            className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20 sm:px-3"
          >
            <span className="hidden sm:inline">■ Остановить</span>
            <span className="sm:hidden">■</span>
          </button>
        )}
      </div>
    </header>
  );
}
