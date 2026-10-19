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
    }),
    execute: async (_id, params: { task: string; index?: number }) => {
      // Валидация параметров
      if (!params.task || typeof params.task !== 'string' || params.task.trim() === '') {
        return { content: [{ type: "text" as const, text: "Ошибка: параметр 'task' должен быть непустой строкой с описанием задачи. Пример: add_step(task='Реализовать API авторизации')" }], details: {} };
      }

      const ctx = store.get(ctxId);
      if (!ctx) {
        return { content: [{ type: "text" as const, text: `Ошибка: контекст ${ctxId} не найден` }], details: {} };
      }

      try {
        const activePlanId = store.getActivePlanId(ctx);
        if (!activePlanId) {
          return { content: [{ type: "text" as const, text: "Ошибка: для этого контекста нет активного плана. Создайте план через create_plan." }], details: {} };
        }

        const manager = planService.getManager(ctxId, getCtxDir(ctxId));
        const plan = await manager.loadPlan(activePlanId);
        if (!plan) {
          return { content: [{ type: "text" as const, text: `Ошибка: активный план ${activePlanId} не найден` }], details: {} };
        }

        const step = await manager.addStep(plan, params.task, params.index);
        
        // Отправляем событие обновления плана в UI
        emit({ type: "plan_updated", ctxId, planId: activePlanId });

        return { content: [{ type: "text" as const, text: `Шаг добавлен: "${params.task}" (ID: ${step.id})` }], details: {} };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Ошибка добавления шага: ${String(err)}` }], details: {} };
      }
    },
  });
}