import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import { getTargetPlan, toolError, toolOk } from "./plan-utils";

/**
 * Инструмент add_subtask — добавить подзадачу к шагу плана.
 */
export function makeAddSubtaskTool(ctxId: string, store: ContextStore) {
  return defineTool({
    name: "add_subtask",
    label: "Добавить подзадачу",
    description:
      "Добавить подзадачу к существующему шагу текущего активного плана. Если у шага есть встроенный подплан (через embed_subplan), подзадача добавляется туда; иначе — как inline подзадача к самому шагу.",
    parameters: Type.Object({
      parentStepId: Type.String({ description: "ID родительского шага" }),
      task: Type.String({ description: "Описание новой подзадачи" }),
    }),
    execute: async (_id, params) => {
      // Валидация параметров
      if (!params.parentStepId || typeof params.parentStepId !== 'string' || params.parentStepId.trim() === '') {
        return toolError("Ошибка: параметр 'parentStepId' должен быть непустой строкой с ID родительского шага. Получите ID через get_plan_status.");
      }
      if (!params.task || typeof params.task !== 'string' || params.task.trim() === '') {
        return toolError("Ошибка: параметр 'task' должен быть непустой строкой с описанием подзадачи.");
      }

      // Получение целевого плана через утилиту
      const target = await getTargetPlan(ctxId, store);
      if ('error' in target) {
        return toolError(`Ошибка: ${target.error}`);
      }

      try {
        const parentStepId = params.parentStepId as string;
        const task = params.task as string;

        // Проверить, существует ли родительский шаг
        const parentStep = await target.plan.findStepById(parentStepId);
        if (!parentStep) {
          return toolError(`Ошибка: шага с ID ${parentStepId} не найден в плане`);
        }

        // addSubtask переименован в addSubStep
        const substep = await target.plan.addSubStep(parentStepId, task);
        return toolOk(`Подзадача добавлена к шагу ${parentStepId}: "${task}" (ID: ${substep.id})`);
      } catch (err) {
        return toolError(`Ошибка добавления подзадачи: ${String(err)}`);
      }
    },
  });
}
