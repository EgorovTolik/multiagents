import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import { PlanManager } from "@multiagents/plan-manager";
import type { Emit } from "../runner.ts";

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

/**
 * Инструмент delete_step — удалить шаг плана.
 */
export function makeDeleteStepTool(ctxId: string, store: ContextStore, planService: any, getCtxDir: (ctxId: string) => string, emit: Emit) {
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
        return okText("Ошибка: параметр 'stepId' должен быть непустой строкой с ID шага для удаления. Получите ID через get_plan_status.");
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
        
        // Проверить, существует ли шаг
        const planObj: any = plan;
        const step = await planObj.findStepById(stepId);
        if (!step) {
          return okText(`Ошибка: шага с ID ${stepId} не найден в плане`);
        }

        // Удалить шаг
        await planObj.removeStep(stepId);
        emit({ type: "plan_updated", ctxId, planId: activePlanId });

        return okText(`Шаг ${stepId} ("${step.task}") удалён из плана.`);
      } catch (err) {
        return okText(`Ошибка удаления шага: ${String(err)}`);
      }
    },
  });
}