import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import type { Emit } from "../runner.ts";
import { getTargetPlan, toolError, toolOk } from "./plan-utils";

/**
 * Инструмент update_plan_step — обновить статус шага плана.
 */
export function makeUpdatePlanStepTool(ctxId: string, store: ContextStore, emit: Emit) {
  return defineTool({
    name: "update_plan_step",
    label: "Обновить шаг плана",
    description:
      "Обновить статус или информацию о шаге текущего активного плана.",
    parameters: Type.Object({
      stepId: Type.String({ description: "ID шага плана" }),
      status: Type.Optional(
        Type.Enum({ pending: "pending", in_progress: "in_progress", done: "done", blocked: "blocked" }, {
          description: "Новый статус шага (по умолчанию не меняется)"
        })
      ),
    }),
    execute: async (_id, params) => {
      // Валидация параметров
      if (!params.stepId || typeof params.stepId !== 'string' || params.stepId.trim() === '') {
        return toolError("Ошибка: параметр 'stepId' должен быть непустой строкой с ID шага плана. Получите ID через get_plan_status.");
      }

      // Получение целевого плана через утилиту
      const target = await getTargetPlan(ctxId, store);
      if ('error' in target) {
        return toolError(`Ошибка: ${target.error}`);
      }

      try {
        const stepId = params.stepId as string;
        const status = params.status as 'pending' | 'in_progress' | 'done' | 'blocked' | undefined;

        if (status) {
          await target.plan.setStepStatus(stepId, status);
          emit({ type: "plan_updated", ctxId, planId: target.planId });
          return toolOk(`Статус шага ${stepId} обновлен на "${status}".`);
        } else {
          return toolError("Ошибка: параметр status не указан.");
        }
      } catch (err) {
        return toolError(`Ошибка обновления шага плана: ${String(err)}`);
      }
    },
  });
}
