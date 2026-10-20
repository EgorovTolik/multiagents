import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import { PlanManager } from "@multiagents/plan-manager";

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

/**
 * Инструмент add_subtask — добавить подзадачу к шагу плана.
 */
export function makeAddSubtaskTool(ctxId: string, store: ContextStore, planService: any, getCtxDir: (ctxId: string) => string) {
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
        return okText("Ошибка: параметр 'parentStepId' должен быть непустой строкой с ID родительского шага. Получите ID через get_plan_status.");
      }
      if (!params.task || typeof params.task !== 'string' || params.task.trim() === '') {
        return okText("Ошибка: параметр 'task' должен быть непустой строкой с описанием подзадачи.");
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

        const parentStepId = params.parentStepId as string;
        const task = params.task as string;

        // Проверить, существует ли родительский шаг
        const planObj: any = plan;
        const parentStep = await planObj.findStepById(parentStepId);
        if (!parentStep) {
          return okText(`Ошибка: шага с ID ${parentStepId} не найден в плане`);
        }

        const subtask = await planObj.addSubtask(parentStepId, task);
        return okText(
          `Подзадача добавлена к шагу ${parentStepId}: "${task}" (ID: ${subtask.id})`
        );
      } catch (err) {
        return okText(`Ошибка добавления подзадачи: ${String(err)}`);
      }
    },
  });
}