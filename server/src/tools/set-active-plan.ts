import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import type { Emit } from "../runner.ts";
import { getTargetPlan, toolError, toolOk } from "./plan-utils";

/**
 * Инструмент set_active_plan — установить выбранный план как активный для контекста.
 */
export function makeSetActivePlanTool(ctxId: string, store: ContextStore, emit: Emit) {
  return defineTool({
    name: "set_active_plan",
    label: "Установить активный план",
    description:
      "Установить выбранный план как активный для текущего контекста. Перед этим убедитесь, что план существует (через list_plans).",
    parameters: Type.Object({
      planId: Type.String({ description: "ID плана, который нужно установить как активный" }),
    }),
    execute: async (_id, params: { planId: string }) => {
      // Получение целевого плана через утилиту (проверяет существование)
      const target = await getTargetPlan(ctxId, store, { planId: params.planId });
      if ('error' in target) {
        return toolError(`Ошибка: ${target.error}`);
      }

      try {
        // Устанавливаем активный план
        const ctx = store.get(ctxId)!;
        store.setActivePlanId(ctx, target.planId);
        store.save(ctx);

        // Отправляем событие обновления плана в UI
        emit({ type: "plan_updated", ctxId, planId: target.planId });

        return toolOk(
          `План «${target.plan.title}» (ID: ${target.planId}) установлен как активный для этого контекста. ` +
          `Теперь инструменты планирования (add_step, update_plan_step и др.) будут работать с этим планом.`
        );
      } catch (err) {
        return toolError(`Ошибка установки активного плана: ${String(err)}`);
      }
    },
  });
}
