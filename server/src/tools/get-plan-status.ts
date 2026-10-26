import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import { PlanManager } from "@multiagents/plan-manager";

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

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
      const ctx = store.get(ctxId);
      if (!ctx) {
        return okText(`Ошибка: контекст ${ctxId} не найден`);
      }

      try {
        const activePlanId = store.getActivePlanId(ctx);
        if (!activePlanId) {
          return okText("Для этого контекста нет активного плана. Создайте план через create_plan.");
        }

        const manager = PlanManager.getInstance();
        const plan: any = await manager.loadPlan(ctxId, activePlanId);
        if (!plan) {
          return okText(`Ошибка: активный план ${activePlanId} не найден`);
        }

        // Использовать встроенный метод getOverallProgress плана
        const planObj: any = plan;
        const progress = await planObj.getOverallProgress();
        const done = progress.done;
        const total = progress.total;

        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        return okText(
          `План: "${plan.title}" (ID: ${plan.id})\n` +
          `Статус плана: ${plan.status}\n` +
          `Прогресс: ${done}/${total} шагов выполнено (${percent}%)`
        );
      } catch (err) {
        return okText(`Ошибка получения статуса плана: ${String(err)}`);
      }
    },
  });
}