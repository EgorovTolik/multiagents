import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import { PlanManager } from "@multiagents/plan-manager";
import type { Emit } from "../runner.ts";

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

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
        return okText("Ошибка: параметр 'stepId' должен быть непустой строкой с ID шага плана. Получите ID через get_plan_status.");
      }

      if (!params.task || typeof params.task !== 'string' || params.task.trim() === '') {
        return okText("Ошибка: параметр 'task' должен быть непустой строкой с новым описанием задачи.");
      }

      const ctx = store.get(ctxId);
      if (!ctx) {
        return okText(`Ошибка: контекст ${ctxId} не найден`);
      }

      try {
        const activePlanId = store.getActivePlanId(ctx);
        if (!activePlanId) {
          return okText("Ошибка: для этого контекста нет активного плана. Создайте план через create_plan.");
        }

        const manager = PlanManager.getInstance();
        const plan = await manager.loadPlan(ctxId, activePlanId);
        if (!plan) {
          return okText(`Ошибка: активный план ${activePlanId} не найден`);
        }

        const stepId = params.stepId as string;
        const task = params.task as string;

        const planObj: any = plan;
        await planObj.setStepTask(stepId, task);
        emit({ type: "plan_updated", ctxId, planId: activePlanId });
        return okText(`Задача шага ${stepId} обновлена на "${task}".`);
      } catch (err) {
        return okText(`Ошибка обновления задачи шага плана: ${String(err)}`);
      }
    },
  });
}