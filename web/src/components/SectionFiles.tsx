import { Field } from "./Field";
import { borderClass } from "../utils/style";

export function SectionFiles({
  title,
  files,
  dirty,
  onAdd,
  onRemove,
  onChange,
  content,
  help,
}: {
  title: string;
  files: Array<{ filename: string; content: string }>;
  dirty: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, field: "filename" | "content", value: string) => void;
  content: (file: { filename: string; content: string }, index: number) => React.ReactNode;
  help?: string;
}) {
  return (
    <Field label={title} dirty={dirty} help={help}>
      <div className={`space-y-3 rounded-lg border bg-slate-900/50 p-3 ${borderClass(dirty)}`}>
        {files.length === 0 && <p className="text-xs text-slate-500">Нет файлов</p>}
        {files.map((f, i) => (
          <div key={i} className="rounded-lg border border-slate-700 bg-slate-900 p-2.5">
            <div className="mb-1 flex items-center gap-2">
              <input
                value={f.filename}
                onChange={(e) => onChange(i, "filename", e.target.value)}
                className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-xs outline-none focus:border-indigo-500"
              />
              <button onClick={() => onRemove(i)} className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10" title="Удалить файл">✕</button>
            </div>
            {content(f, i)}
          </div>
        ))}
        <button onClick={onAdd} className="w-full rounded-lg border border-dashed border-slate-600 py-2 text-xs text-slate-400 hover:border-indigo-500 hover:text-indigo-300">+ Добавить файл</button>
      </div>
    </Field>
  );
}