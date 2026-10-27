/** Общие утилиты для инструментов планирования. */

import { PlanManager } from "@multiagents/plan-manager";
import type { ContextStore } from "../context-store";

export interface GetTargetPlanResult {
  plan: any;
  planId: string;
}

export interface GetTargetPlanError {
  error: string;
}

/**
 * Получить целевой план для операции. Если указан planId — использовать его,
 * иначе активный план контекста. Проверяет существование контекста и плана.
 * @returns объект с plan и planId, или объект с error
 */
export async function getTargetPlan(
  ctxId: string,
  store: ContextStore,
  params?: { planId?: string }
): Promise<GetTargetPlanResult | GetTargetPlanError> {
  const ctx = store.get(ctxId);
  if (!ctx) {
    return { error: `Контекст ${ctxId} не найден` };
  }

  const targetPlanId = params?.planId || store.getActivePlanId(ctx);
  if (!targetPlanId) {
    return { error: "Нет активного плана и не указан planId" };
  }

  try {
    const manager = PlanManager.getInstance();
    const plan = await manager.loadPlan(ctxId, targetPlanId);
    if (!plan) {
      return { error: `План ${targetPlanId} не найден` };
    }
    return { plan, planId: targetPlanId };
  } catch (err) {
    return { error: `Ошибка загрузки плана ${targetPlanId}: ${String(err)}` };
  }
}

/**
 * Отформатировать текст ошибки для ответа инструмента.
 */
export function toolError(text: string): { content: [{ type: "text"; text: string }]; details: object } {
  return { content: [{ type: "text" as const, text }], details: {} };
}

/**
 * Отформатировать успешный ответ инструмента.
 */
export function toolOk(text: string): { content: [{ type: "text"; text: string }]; details: object } {
  return { content: [{ type: "text" as const, text }], details: {} };
}
