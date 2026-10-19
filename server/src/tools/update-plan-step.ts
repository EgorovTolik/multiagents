import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import type { Emit } from "../runner.ts";

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

/**
 * Инструмент update_plan_step — обновить статус шага плана.
 */
export function makeUpdatePlanStepTool(ctxId: string, store: ContextStore, planService: any, getCtxDir: (ctxId: string) => string, emit: Emit) {
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
        return okText("Ошибка: параметр 'stepId' должен быть непустой строкой с ID шага плана. Получите ID через get_plan_status.");
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

        const manager = planService.getManager(ctxId, getCtxDir(ctxId));
        const plan = await manager.loadPlan(activePlanId);
        if (!plan) {
          return okText(`Ошибка: активный план ${activePlanId} не найден`);
        }

        const stepId = params.stepId as string;
        const status = params.status as 'pending' | 'in_progress' | 'done' | 'blocked' | undefined;

        if (status) {
          await manager.updateStepStatus(plan, stepId, status);
          emit({ type: "plan_updated", ctxId, planId: activePlanId });
          return okText(`Статус шага ${stepId} обновлен на "${status}".`);
        } else {
          return okText("Ошибка: параметр status не указан.");
        }
      } catch (err) {
        return okText(`Ошибка обновления шага плана: ${String(err)}`);
      }
    },
  });
}