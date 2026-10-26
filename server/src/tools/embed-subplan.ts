import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import { PlanManager } from "@multiagents/plan-manager";
import type { Emit } from "../runner.ts";

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

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
        return okText("Ошибка: параметр 'stepId' должен быть непустой строкой с ID шага, в который встраивается подплан. Получите ID через get_plan_status.");
      }
      if (!params.subplanTitle || typeof params.subplanTitle !== 'string' || params.subplanTitle.trim() === '') {
        return okText("Ошибка: параметр 'subplanTitle' должен быть непустой строкой с названием подплана.");
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
        const subplanTitle = params.subplanTitle as string;
        const subplanDescription = params.subplanDescription as string | undefined;

        // Проверить, существует ли шаг
        const planObj: any = plan;
        const step = await planObj.findStepById(stepId);
        if (!step) {
          return okText(`Ошибка: шага с ID ${stepId} не найден в плане`);
        }

        // Создать детальный подплан
        const subplan = await manager.createPlan(ctxId, {
          title: subplanTitle,
          description: subplanDescription || undefined,
          createdBy: ctx.activeAgentId,
        });

        // Встроить подплан в шаг через setPlan
        await planObj.setPlan(stepId, subplan);
        emit({ type: "plan_updated", ctxId, planId: activePlanId });

        return okText(
          `Подплан "${subplanTitle}" (ID: ${subplan.id}) создан и встроен в шаг ${stepId}`
        );
      } catch (err) {
        return okText(`Ошибка создания подплана: ${String(err)}`);
      }
    },
  });
}