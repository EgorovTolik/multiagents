import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import { PlanManager } from "@multiagents/plan-manager";
import type { Emit } from "../runner.ts";
import { getTargetPlan, toolError, toolOk } from "./plan-utils";

/**
 * Инструмент embed_subplan — создать и встроить детальный подплан в шаг.
 */
export function makeEmbedSubplanTool(ctxId: string, store: ContextStore, emit: Emit) {
  return defineTool({
    name: "embed_subplan",
    label: "Встроить подплан",
    description:
      "Создать детальный подплан и встроить его в указанный шаг текущего плана. ПРИМЕЧАНИЕ: при встраивании существующие inline подзадачи шага (если были) будут очищены — встроенный подплан заменяет их структуру.",
    parameters: Type.Object({
      stepId: Type.String({ description: "ID шага, в который встраивается подплан" }),
      subplanTitle: Type.String({ description: "Название подплана" }),
      subplanDescription: Type.Optional(
        Type.String({ description: "Описание подплана (опционально)" })
      ),
    }),
    execute: async (_id, params) => {
      // Валидация параметров
      if (!params.stepId || typeof params.stepId !== 'string' || params.stepId.trim() === '') {
        return toolError("Ошибка: параметр 'stepId' должен быть непустой строкой с ID шага, в который встраивается подплан. Получите ID через get_plan_status.");
      }
      if (!params.subplanTitle || typeof params.subplanTitle !== 'string' || params.subplanTitle.trim() === '') {
        return toolError("Ошибка: параметр 'subplanTitle' должен быть непустой строкой с названием подплана.");
      }

      // Получение целевого плана через утилиту
      const target = await getTargetPlan(ctxId, store);
      if ('error' in target) {
        return toolError(`Ошибка: ${target.error}`);
      }

      try {
        const ctx = store.get(ctxId)!;
        const stepId = params.stepId as string;
        const subplanTitle = params.subplanTitle as string;
        const subplanDescription = params.subplanDescription as string | undefined;

        // Проверить, существует ли шаг
        const step = await target.plan.findStepById(stepId);
        if (!step) {
          return toolError(`Ошибка: шага с ID ${stepId} не найден в плане`);
        }

        // Создать детальный подплан
        const manager = PlanManager.getInstance();
        const subplan = await manager.createPlan(ctxId, {
          title: subplanTitle,
          description: subplanDescription || undefined,
          createdBy: ctx.activeAgentId,
        });

        // Встроить подплан в шаг через setPlan
        await target.plan.setPlan(stepId, subplan);
        emit({ type: "plan_updated", ctxId, planId: target.planId });

        return toolOk(`Подплан "${subplanTitle}" (ID: ${subplan.id}) создан и встроен в шаг ${stepId}`);
      } catch (err) {
        return toolError(`Ошибка создания подплана: ${String(err)}`);
      }
    },
  });
}
