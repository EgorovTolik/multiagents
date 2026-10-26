import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import { getTargetPlan, toolError, toolOk } from "./plan-utils";

/**
 * Инструмент get_plan_status — получить текущий статус выполнения плана.
 */
export function makeGetPlanStatusTool(ctxId: string, store: ContextStore) {
  return defineTool({
    name: "get_plan_status",
    label: "Статус плана",
    description:
      "Получить текущий статус и прогресс выполнения активного плана (выполнено/всего шагов).",
    parameters: Type.Object({}),
    execute: async (_id, _params) => {
      // Получение целевого плана через утилиту
      const target = await getTargetPlan(ctxId, store);
      if ('error' in target) {
        return toolError(`Ошибка: ${target.error}`);
      }

      try {
        const progress = await target.plan.getOverallProgress();
        const done = progress.done;
        const total = progress.total;

        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        return toolOk(
          `План: "${target.plan.title}" (ID: ${target.plan.id})\n` +
          `Статус плана: ${target.plan.status}\n` +
          `Прогресс: ${done}/${total} шагов выполнено (${percent}%)`
        );
      } catch (err) {
        return toolError(`Ошибка получения статуса плана: ${String(err)}`);
      }
    },
  });
}
