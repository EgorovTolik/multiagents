import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextStore } from "../context-store";
import { PlanManager } from "@multiagents/plan-manager";

import type { Emit } from "../runner.ts";

export function makeCreatePlanTool(ctxId: string, store: ContextStore, planService: any, getCtxDir: (ctxId: string) => string, emit: Emit) {
  return defineTool({
    name: "create_plan",
    label: "Создать план",
    description:
      "Создать новый план задач для текущего контекста. Используйте для планирования сложных задач с множеством шагов.",
    parameters: Type.Object({
      title: Type.String({ description: "Название плана" }),
      description: Type.Optional(
        Type.String({ description: "Описание цели и контекста плана (опционально)" })
      ),
    }),
    execute: async (_id, params: { title: string; description?: string }) => {
      const ctx = store.get(ctxId);
      if (!ctx) {
        return { content: [{ type: "text" as const, text: `Ошибка: контекст ${ctxId} не найден` }], details: {} };
      }

      try {
        const manager = PlanManager.getInstance();
        const plan = await manager.createPlan(ctxId, {
          title: params.title as string,
          description: (params.description as string) || undefined,
          createdBy: ctx.activeAgentId,
        });

        // Устанавливаем новый план как активный для контекста
        store.setActivePlanId(ctx, plan.id);
        store.save(ctx);
        
        // Отправляем событие создания плана в UI
        emit({ type: "plan_created", ctxId, planId: plan.id });

        return {
          content: [{ type: "text" as const, text: `План создан: "${plan.title}" (ID: ${plan.id}). План установлен как активный для этого контекста.` }],
          details: {}
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Ошибка создания плана: ${String(err)}` }], details: {} };
      }
    },
  });
}