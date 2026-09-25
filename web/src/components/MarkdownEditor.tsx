import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

export type MarkdownEditorMode = "edit" | "preview";

/** Ссылки открываются в новой вкладке — тот же паттерн, что в MessageRow.mdLink. */
const mdLink = ({ href }: { href?: string }, children: React.ReactNode) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

/**
 * Редактор markdown-текста с переключением режимов: редактирование (textarea) / просмотр.
 * Предпросмотр использует тот же CSS-класс `.md-content`, что и сообщения в чате —
 * одинаковый внешний вид: цвета, отступы, скругления кода.
 */
export default function MarkdownEditor({
  value = "",
  onChange,
  rows = 16,
  placeholder = "Введите markdown…",
}: {
  /** Текущий текст (controlled). */
  value?: string;
  /** Вызывается при изменении текста. */
  onChange: (text: string) => void;
  /** Высота textarea в строках при режиме редактирования. По умолчанию 16. */
  rows?: number;
  /** Placeholder для textarea. */
  placeholder?: string;
}) {
  const [mode, setMode] = useState<MarkdownEditorMode>("edit");

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Markdown</span>
        <div className="flex rounded-md bg-slate-950 p-0.5">
          <button
            onClick={() => setMode("edit")}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              mode === "edit" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Редактор
          </button>
          <button
            onClick={() => setMode("preview")}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              mode === "preview" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Предпросмотр
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-h-[60vh] overflow-auto">
        {mode === "edit" ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className="w-full resize-y bg-transparent px-3 py-2.5 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-indigo-500/40"
          />
        ) : (
          <div className="md-content prose-invert prose-sm max-w-none p-3">
            {value.trim() ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{ a: mdLink }}
              >
                {value}
              </ReactMarkdown>
            ) : (
              <p className="text-sm italic text-slate-500">Пусто — переключитесь в режим редактирования.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
