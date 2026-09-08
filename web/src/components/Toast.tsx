import { useState } from "react";

export interface Toast {
  id: number;
  text: string;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = (text: string) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2500);
  };

  return { toasts, notify };
}

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[9999] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast-in rounded-lg border border-slate-600 bg-slate-800/95 px-4 py-2 text-sm text-slate-200 shadow-xl backdrop-blur"
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
