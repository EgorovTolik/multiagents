import { useState } from "react";

export function PlanStatusBadge({
  done,
  total,
  status,
  onClick,
}: {
  done: number;
  total: number;
  status: "planning" | "approved" | "executing" | "completed" | "archived";
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  // Color coding based on plan status
  let colorClass = "border-blue-500/60 bg-blue-500/10 text-blue-300";
  if (status === "planning") {
    colorClass = "border-yellow-500/60 bg-yellow-500/10 text-yellow-300";
  } else if (status === "completed") {
    colorClass = "border-green-500/60 bg-green-500/10 text-green-300";
  } else if (status === "archived") {
    colorClass = "border-gray-500/60 bg-gray-500/10 text-gray-400";
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`rounded border ${colorClass} px-2 py-0.5 text-xs transition-colors ${
        hovered ? "bg-opacity-30" : ""
      }`}
      title={`План: ${done}/${total} шагов (${percent}%) — статус: ${status}`}
    >
      📋 {done}/{total} ({percent}%)
    </button>
  );
}
