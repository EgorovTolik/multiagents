import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Message } from "../api";
import { fmtTime, agentColor } from "../utils/format";

function MessageMenu({ onTruncate, onCopy }: { onTruncate: () => void; onCopy: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <span ref={ref} className="relative ml-1.5 inline-block align-middle">
      <button
        onClick={() => setOpen(!open)}
        className="flex h-5 w-5 items-center justify-center rounded-md border border-slate-700 bg-slate-800/80 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 hover:border-slate-600 hover:text-slate-300"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <circle cx="5" cy="2" r="1" />
          <circle cx="5" cy="5" r="1" />
          <circle cx="5" cy="8" r="1" />
        </svg>
      </button>
      {open && (
        <span className="absolute right-0 top-full z-50 mt-1 block w-36 rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl">
          <button
            onClick={() => { setOpen(false); onCopy(); }}
            className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-700"
          >
            Копировать
          </button>
          <button
            onClick={() => { setOpen(false); onTruncate(); }}
            className="block w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-slate-700"
          >
            Удалить
          </button>
        </span>
      )}
    </span>
  );
}

// memo: во время стриминга messages обновляется на каждый delta — без мемо
// пере-рендерятся ВСЕ строки (и ReactMarkdown перепарсит весь текст), отсюда «дрожание» чата.
function MessageRowInner({
  m,
  index,
  streaming = false,
  agentName,
  onImageClick,
  onTruncate,
  notify,
}: {
  m: Message;
  index: number;
  /** Стримится прямо сейчас: рисуем plain-text без markdown, чтобы не «дышало» на каждый токен. */
  streaming?: boolean;
  agentName: (id: string) => string;
  onImageClick: (url: string) => void;
  onTruncate: (index: number) => void;
  notify: (text: string) => void;
}) {
  const menuBtn = <MessageMenu onTruncate={() => onTruncate(index)} onCopy={() => { navigator.clipboard.writeText(m.text); notify("Скопировано"); }} />;

  if (m.role === "system") {
    // Системные сообщения (передачи между агентами) — без контекстного меню
    return (
      <div className="my-3 flex justify-center">
        <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-400">
          {m.text}
        </span>
      </div>
    );
  }
  if (m.role === "user") {
    return (
      <div className="group mb-2 flex items-start justify-end sm:mb-3">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600/80 px-3 py-2 text-sm sm:max-w-[75%] sm:px-4">
          {streaming ? (
            <div className="whitespace-pre-wrap break-words">{m.text}</div>
          ) : (
            <div className="md-content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  img: ({ src, alt }) => (
                    <img src={src} alt={alt ?? ""} onClick={() => src && onImageClick(src)} />
                  ),
                }}
              >
                {m.text}
              </ReactMarkdown>
            </div>
          )}
          <div className="mt-1 text-right text-[10px] text-indigo-200/70">{fmtTime(m.ts)}</div>
        </div>
        {menuBtn}
      </div>
    );
  }
  return (
    <div className="group mb-2 flex items-start justify-start sm:mb-3">
      <div className="max-w-[85%] sm:max-w-[75%]">
        <span
          className={`mb-1 inline-block rounded border px-1.5 py-0.5 text-[10px] ${
            m.agentId ? agentColor(m.agentId) : "border-slate-700 text-slate-400"
          }`}
        >
          {m.agentId ? agentName(m.agentId) : "система"}
        </span>
        <div className="rounded-2xl rounded-tl-sm border border-slate-800 bg-slate-900 px-4 py-2 text-sm">
          {streaming ? (
            <div className="whitespace-pre-wrap break-words">{m.text}</div>
          ) : (
            <div className="md-content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  img: ({ src, alt }) => (
                    <img src={src} alt={alt ?? ""} onClick={() => src && onImageClick(src)} />
                  ),
                }}
              >
                {m.text}
              </ReactMarkdown>
            </div>
          )}
          <div className="mt-1 text-left text-[10px] text-slate-500">{fmtTime(m.ts)}</div>
        </div>
      </div>
      {menuBtn}
    </div>
  );
}

export const MessageRow = memo(MessageRowInner);
