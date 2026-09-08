import { useCallback, useState } from "react";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  text: string;
  /** sticky: не закрывается по таймеру, только крестиком */
  sticky?: boolean;
  action?: ToastAction;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const notify = useCallback((text: string, opts?: { sticky?: boolean; action?: ToastAction }) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, text, sticky: opts?.sticky, action: opts?.action }]);
    if (!opts?.sticky) {
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 2500);
    }
  }, []);

  return { toasts, notify, dismiss };
}

export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss?: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[9999] flex w-80 max-w-[90vw] -translate-x-1/2 flex-col items-stretch gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast-in pointer-events-auto flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800/95 px-4 py-2.5 text-sm text-slate-200 shadow-xl backdrop-blur"
        >
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          {t.action && (
            <button
              onClick={t.action.onClick}
              className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
            >
              {t.action.label}
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => onDismiss(t.id)}
              title="Закрыть"
              className="shrink-0 rounded px-1 text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
