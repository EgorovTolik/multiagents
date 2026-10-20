import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import type { Emit } from "../runner.ts";

export function makeAddStepTool(ctxId: string, store: ContextStore, planService: any, getCtxDir: (ctxId: string) => string, emit: Emit) {
  return defineTool({
    name: "add_step",
    label: "Добавить шаг плана",
    description:
      "Добавить новый шаг в текущий активный план. Используйте для создания шагов после создания плана.",
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
        return { content: [{ type: "text" as const, text: "Ошибка: параметр 'task' должен быть непустой строкой с описанием задачи. Пример: add_step(task='Реализовать API авторизации')" }], details: {} };
      }

      const ctx = store.get(ctxId);
      if (!ctx) {
        return { content: [{ type: "text" as const, text: `Ошибка: контекст ${ctxId} не найден` }], details: {} };
      }

      try {
        // Если указан planId — используем его, иначе активный план
        let targetPlanId = params.planId || store.getActivePlanId(ctx);
        if (!targetPlanId) {
          return { content: [{ type: "text" as const, text: "Ошибка: для этого контекста нет активного плана и не указан planId. Создайте план через create_plan." }], details: {} };
        }

        const manager = planService.getManager(ctxId, getCtxDir(ctxId));
        const plan = await manager.loadPlan(targetPlanId);
        if (!plan) {
          return { content: [{ type: "text" as const, text: `Ошибка: активный план ${activePlanId} не найден` }], details: {} };
        }

        const step = await manager.addStep(plan, params.task, params.index);
        
        // Отправляем событие обновления плана в UI
        emit({ type: "plan_updated", ctxId, planId: targetPlanId });

        return { content: [{ type: "text" as const, text: `Шаг добавлен в план ${targetPlanId}: "${params.task}" (ID: ${step.id})` }], details: {} };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Ошибка добавления шага: ${String(err)}` }], details: {} };
      }
    },
  });
}