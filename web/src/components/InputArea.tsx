import { useRef } from "react";

export interface AttachedFile {
  name: string;
  mediaType: string;
  data: string;
  size: number;
}

export function InputArea({
  input,
  onInputChange,
  onSend,
  onAddFiles,
  attachedFiles,
  onRemoveFile,
  placeholder,
  disabled,
  sentText,
}: {
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  attachedFiles: AttachedFile[];
  onRemoveFile: (index: number) => void;
  placeholder: string;
  disabled: boolean;
  sentText: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autoExpand() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "3.5rem";
    el.style.height = Math.min(el.scrollHeight, 12 * 16) + "px";
  }

  return (
    <div className="border-t border-slate-800 p-3 sm:p-4">
      {attachedFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachedFiles.map((f, i) => (
            <div key={i} className="relative group/att">
              {f.mediaType.startsWith("image/") ? (
                <img
                  src={`data:${f.mediaType};base64,${f.data}`}
                  alt={f.name}
                  className="h-16 w-16 rounded-md border border-slate-700 object-cover"
                />
              ) : (
                <div className="flex h-16 w-24 flex-col items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-1">
                  <span className="text-lg">📄</span>
                  <span className="w-full truncate text-center text-[10px] text-slate-400">{f.name}</span>
                  <span className="text-[9px] text-slate-500">
                    {f.size < 1024 ? f.size + " Б" : f.size < 1048576 ? (f.size / 1024).toFixed(1) + " КБ" : (f.size / 1048576).toFixed(1) + " МБ"}
                  </span>
                </div>
              )}
              <button
                onClick={() => onRemoveFile(i)}
                className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-xs text-white opacity-0 group-hover/att:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) onAddFiles(e.target.files); e.target.value = ""; }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="self-stretch rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm hover:bg-slate-700"
          title="Прикрепить файл (или перетащите / вставьте)"
        >
          📎
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => { onInputChange(e.target.value); autoExpand(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (items) {
              const files: File[] = [];
              for (const item of items) {
                if (item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (file) files.push(file);
                }
              }
              if (files.length > 0) { e.preventDefault(); onAddFiles(files); }
            }
          }}
          rows={2}
          placeholder={placeholder}
          style={{ minHeight: "3.5rem", maxHeight: "12rem" }}
          className="flex-1 resize-none overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <button
          onClick={onSend}
          disabled={disabled}
          className="self-stretch rounded-lg bg-indigo-600 px-4 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 sm:px-5"
        >
          <span className="hidden sm:inline">{sentText !== null ? "Отправлено…" : "Отправить"}</span>
          <span className="sm:hidden">➤</span>
        </button>
      </div>
    </div>
  );
}
