import { HelpTip } from "./HelpTip";

export function Field({
  label,
  dirty = false,
  help,
  children,
}: {
  label: string;
  dirty?: boolean;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
        {dirty && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-red-500" />}
        {help && <HelpTip text={help} />}
      </label>
      {children}
    </div>
  );
}