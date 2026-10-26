import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import type { Emit } from "../runner.ts";
import { getTargetPlan, toolError, toolOk } from "./plan-utils";

export function makeAddStepTool(ctxId: string, store: ContextStore, emit: Emit) {
  return defineTool({
    name: "add_step",
    label: "Добавить шаг плана",
    description:
      "Добавить новый шаг в активный план (или во встроенный подплан через параметр planId). Для добавления шагов во вложенный подплан укажите его ID в планId — это создаст шаг внутри embedded плана, а не как inline подшаг.",
    parameters: Type.Object({
      task: Type.String({ description: "Описание задачи нового шага" }),
      index: Type.Optional(
        Type.Number({ description: "Позиция в списке (опционально, по умолчанию в конец)" })
      ),
      planId: Type.Optional(
        Type.String({ description: "ID целевого плана (опционально). Если не указан — используется активный план контекста. Используйте для добавления шагов во встроенные подпланы." })
      ),
    }),
    execute: async (_id, params: { task: string; index?: number; planId?: string }) => {
      // Валидация параметров
      if (!params.task || typeof params.task !== 'string' || params.task.trim() === '') {
        return toolError("Ошибка: параметр 'task' должен быть непустой строкой с описанием задачи. Пример: add_step(task='Реализовать API авторизации')");
      }

      // Получение целевого плана через утилиту
      const target = await getTargetPlan(ctxId, store, { planId: params.planId });
      if ('error' in target) {
        return toolError(`Ошибка: ${target.error}`);
      }

      try {
        const step = await target.plan.addStep(params.task, params.index);
        
        // Отправляем событие обновления плана в UI
        emit({ type: "plan_updated", ctxId, planId: target.planId });

        return toolOk(`Шаг добавлен в план ${target.planId}: "${params.task}" (ID: ${step.id})`);
      } catch (err) {
        return toolError(`Ошибка добавления шага: ${String(err)}`);
      }
    },
  });
}
