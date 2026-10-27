import { useState } from "react";

export function RecoveryBadge({ count, onClick }: { count: number; onClick?: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`rounded border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300 transition-colors ${
        hovered ? "bg-amber-500/20" : ""
      }`}
      title={`Восстановлений цепочки: ${count}`}
    >
      🔄 {count}
    </button>
  );
}
