import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

/**
 * Инструмент list_plans — получить список всех планов для текущего контекста.
 */
export function makeListPlansTool(ctxId: string, store: ContextStore, planService: any) {
  return defineTool({
    name: "list_plans",
    label: "Список планов",
    description:
      "Получить список всех планов для текущего контекста (название, статус, создатель).",
    parameters: Type.Object({}),
    execute: async (_id, _params) => {
      try {
        const plans = await planService.listPlans(ctxId);

        if (plans.length === 0) {
          return okText("Для этого контекста нет планов. Создайте план через create_plan.");
        }

        let output = "Планы для этого контекста:\n\n";
        for (const plan of plans) {
          const statusMap: Record<string, string> = {
            planning: "планирование",
            approved: "утверждён",
            executing: "выполняется",
            completed: "завершён",
            archived: "архивирован"
          };
          const statusLabel = statusMap[plan.status] || plan.status;

          output += `- "${plan.title}" (ID: ${plan.id})\n`;
          output += `  Статус: ${statusLabel}\n`;
          if (plan.createdBy) {
            output += `  Создатель: ${plan.createdBy}\n`;
          }
        }

        return okText(output);
      } catch (err) {
        return okText(`Ошибка получения списка планов: ${String(err)}`);
      }
    },
  });
}