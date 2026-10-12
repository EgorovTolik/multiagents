interface PageHeaderProps {
  title: string;
  onBack?: () => void;
}

export default function PageHeader({ title, onBack }: PageHeaderProps) {
  return (
    <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-3 sm:gap-3 sm:px-6">
      {onBack && (
        <button
          onClick={onBack}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          ← Чаты
        </button>
      )}
      <h1 className="text-lg font-semibold">{title}</h1>
    </header>
  );
}
