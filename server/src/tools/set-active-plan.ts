import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import type { Emit } from "../runner.ts";

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

/**
 * Инструмент set_active_plan — установить выбранный план как активный для контекста.
 */
export function makeSetActivePlanTool(ctxId: string, store: ContextStore, planService: any, emit: Emit) {
  return defineTool({
    name: "set_active_plan",
    label: "Установить активный план",
    description:
      "Установить выбранный план как активный для текущего контекста. Перед этим убедитесь, что план существует (через list_plans).",
    parameters: Type.Object({
      planId: Type.String({ description: "ID плана, который нужно установить как активный" }),
    }),
    execute: async (_id, params: { planId: string }) => {
      const ctx = store.get(ctxId);
      if (!ctx) {
        return okText(`Ошибка: контекст ${ctxId} не найден`);
      }

      try {
        // Проверяем что план существует
        const plan = await planService.loadPlan(ctxId, params.planId);
        if (!plan) {
          return okText(
            `Ошибка: план с ID «${params.planId}» не найден в контексте. ` +
            `Сначала получите список доступных планов через list_plans.`
          );
        }

        // Устанавливаем активный план
        store.setActivePlanId(ctx, params.planId);
        store.save(ctx);

        // Отправляем событие обновления плана в UI
        emit({ type: "plan_updated", ctxId, planId: params.planId });

        return okText(
          `План «${plan.title}» (ID: ${params.planId}) установлен как активный для этого контекста. ` +
          `Теперь инструменты планирования (add_step, update_plan_step и др.) будут работать с этим планом.`
        );
      } catch (err) {
        return okText(`Ошибка установки активного плана: ${String(err)}`);
      }
    },
  });
}