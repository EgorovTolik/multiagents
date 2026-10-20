import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import type { Emit } from "../runner.ts";

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

/**
 * Инструмент delete_plan — удалить план.
 */
export function makeDeletePlanTool(ctxId: string, store: ContextStore, planService: any, getCtxDir: (ctxId: string) => string, emit: Emit) {
  return defineTool({
    name: "delete_plan",
    label: "Удалить план",
    description:
      "Удалить указанный план по ID. Если это был активный план контекста — активный план станет не установленным.",
    parameters: Type.Object({
      planId: Type.String({ description: "ID плана для удаления" }),
    }),
    execute: async (_id, params) => {
      // Валидация параметров
      if (!params.planId || typeof params.planId !== 'string' || params.planId.trim() === '') {
        return okText("Ошибка: параметр 'planId' должен быть непустой строкой с ID плана для удаления.");
      }

      const ctx = store.get(ctxId);
      if (!ctx) {
        return okText(`Ошибка: контекст ${ctxId} не найден`);
      }

      try {
        const planId = params.planId as string;

        // Загрузить план для проверки существования и получения названия
        let planTitle = "(неизвестный)";
        try {
          const manager = planService.getManager(ctxId, getCtxDir(ctxId));
          const plan = await manager.loadPlan(planId);
          if (plan) {
            planTitle = plan.title;
          }
        } catch (e) {
          // Если план не загрузился — продолжаем, просто не выводим название
        }

        // Просто обнуляем ссылку на активный план, файл остаётся для истории
        const activePlanId = store.getActivePlanId(ctx);
        if (activePlanId === planId) {
          store.setActivePlanId(ctx, null);
          store.save(ctx);
          emit({ type: "plan_deleted", ctxId });
          return okText(`Ссылка на активный план обнулена. План ${planId} ("${planTitle}") сохранён для истории.`);
        } else {
          return okText(`План ${planId} не был активным — ссылка не менялась.`);
        }
      } catch (err) {
        return okText(`Ошибка: ${String(err)}`);
      }
    },
  });
}