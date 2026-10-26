import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import type { Emit } from "../runner.ts";
import { getTargetPlan, toolError, toolOk } from "./plan-utils";

/**
 * Инструмент delete_step — удалить шаг плана.
 */
export function makeDeleteStepTool(ctxId: string, store: ContextStore, emit: Emit) {
  return defineTool({
    name: "delete_step",
    label: "Удалить шаг плана",
    description:
      "Удалить указанный шаг из текущего активного плана вместе со всеми его подзадачами и вложенными субпланами.",
    parameters: Type.Object({
      stepId: Type.String({ description: "ID шага, который нужно удалить" }),
    }),
    execute: async (_id, params) => {
      // Валидация параметров
      if (!params.stepId || typeof params.stepId !== 'string' || params.stepId.trim() === '') {
        return toolError("Ошибка: параметр 'stepId' должен быть непустой строкой с ID шага для удаления. Получите ID через get_plan_status.");
      }

      // Получение целевого плана через утилиту
      const target = await getTargetPlan(ctxId, store);
      if ('error' in target) {
        return toolError(`Ошибка: ${target.error}`);
      }

      try {
        const stepId = params.stepId as string;
        
        // Проверить, существует ли шаг
        const step = await target.plan.findStepById(stepId);
        if (!step) {
          return toolError(`Ошибка: шага с ID ${stepId} не найден в плане`);
        }

        // Удалить шаг
        await target.plan.removeStep(stepId);
        emit({ type: "plan_updated", ctxId, planId: target.planId });

        return toolOk(`Шаг ${stepId} ("${step.task}") удалён из плана.`);
      } catch (err) {
        return toolError(`Ошибка удаления шага: ${String(err)}`);
      }
    },
  });
}
