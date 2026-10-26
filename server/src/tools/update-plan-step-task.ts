import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import type { Emit } from "../runner.ts";
import { getTargetPlan, toolError, toolOk } from "./plan-utils";

/**
 * Инструмент update_plan_step_task — обновить текст задачи шага плана.
 */
export function makeUpdatePlanStepTaskTool(ctxId: string, store: ContextStore, emit: Emit) {
  return defineTool({
    name: "update_plan_step_task",
    label: "Редактировать задачу шага",
    description:
      "Обновить текст задачи (описание) шага текущего активного плана.",
    parameters: Type.Object({
      stepId: Type.String({ description: "ID шага плана" }),
      task: Type.String({ description: "Новое описание задачи" }),
    }),
    execute: async (_id, params) => {
      // Валидация параметров
      if (!params.stepId || typeof params.stepId !== 'string' || params.stepId.trim() === '') {
        return toolError("Ошибка: параметр 'stepId' должен быть непустой строкой с ID шага плана. Получите ID через get_plan_status.");
      }

      if (!params.task || typeof params.task !== 'string' || params.task.trim() === '') {
        return toolError("Ошибка: параметр 'task' должен быть непустой строкой с новым описанием задачи.");
      }

      // Получение целевого плана через утилиту
      const target = await getTargetPlan(ctxId, store);
      if ('error' in target) {
        return toolError(`Ошибка: ${target.error}`);
      }

      try {
        const stepId = params.stepId as string;
        const task = params.task as string;

        await target.plan.setStepTask(stepId, task);
        emit({ type: "plan_updated", ctxId, planId: target.planId });
        return toolOk(`Задача шага ${stepId} обновлена на "${task}".`);
      } catch (err) {
        return toolError(`Ошибка обновления задачи шага плана: ${String(err)}`);
      }
    },
  });
}
