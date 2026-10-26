import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { SkillRegistry, type SkillDef } from "./skill-registry";
import { ContextStore, type ContextMeta, type Handoff, type Message } from "./context-store";
import { AgentRegistry } from "./registry";

import type { ServerToClientMessage } from "./ws-types";

export type Emit = (msg: ServerToClientMessage) => void;

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function errText(text: string) {
  return { content: [{ type: "text" as const, text: `Ошибка: ${text}` }], details: { isError: true } };
}

/**
 * SkillInjector — модуль для инъекции навыков агентам и предоставления
 * инструментов list_skills / use_skill.
 */
export class SkillInjector {
  constructor(
    private skillRegistry: SkillRegistry,
    private store: ContextStore,
    private registry: AgentRegistry,
    private emit: Emit,
  ) {}

  /**
   * Инжектирует навыки, применённые к контексту, но ещё не переданные агенту.
   * Возвращает изменённый текст промпта с добавленными навыками.
   */
  inject(ctx: ContextMeta, agentId: string, text: string): { text: string; changed: boolean } {
    const delivered = ctx.deliveredSkills?.[agentId] ?? [];
    const pendingSkills = (ctx.skills ?? []).filter(
      (id) => !delivered.includes(id) && this.skillRegistry.get(id),
    );

    if (pendingSkills.length === 0) {
      return { text, changed: false };
    }

    const blocks = pendingSkills
      .map((id) => {
        const sk = this.skillRegistry.get(id)!;
        return `### ${sk.name}\n\n${sk.body.trim()}`;
      })
      .join("\n\n---\n\n");

    text = `⚡ Новые навыки. Запомни их и применяй в работе:\n\n${blocks}\n\n---\n\n${text}`;

    ctx.deliveredSkills = {
      ...(ctx.deliveredSkills ?? {}),
      [agentId]: [...delivered, ...pendingSkills],
    };
    this.store.save(ctx);

    return { text, changed: true };
  }

  /** Сбросить отметку о доставке навыка для агента (чтобы переинжектить). */
  resetDeliveredForAgent(ctx: ContextMeta, agentId: string) {
    if (!ctx.deliveredSkills?.[agentId]) return;
    const rest = { ...ctx.deliveredSkills };
    delete rest[agentId];
    ctx.deliveredSkills = Object.keys(rest).length > 0 ? rest : undefined;
    this.store.save(ctx);
  }

  /** Создать инструмент list_skills. */
  createListSkillsTool() {
    return defineTool({
      name: "list_skills",
      label: "Список навыков",
      description:
        "Показывает все навыки, созданные в системе, с описаниями и флагом автоприменения (autoApply). " +
        "Применить навык к себе можно инструментом use_skill — только если у него autoApply разрешено.",
      parameters: Type.Object({}),
      execute: async () => {
        const skills = this.skillRegistry.list();
        if (skills.length === 0) return okText("В системе пока нет навыков.");
        const lines = skills.map(
          (s) => `- ${s.id}: «${s.name}» — ${s.description || "без описания"} [автоприменение: ${s.autoApply ? "разрешено" : "запрещено"}]`,
        );
        return okText("Навыки системы:\n" + lines.join("\n"));
      },
    });
  }

  /** Создать инструмент use_skill. */
  createUseSkillTool(ctxId: string, agentId: string) {
    return defineTool({
      name: "use_skill",
      label: "Применить навык",
      description:
        "Применяет навык к текущему контексту и к твоей работе в рамках сессии. Доступны только навыки, у которых разрешено автоприменение (autoApply). " +
        "В результате вернётся полный текст навыка — применяй его правила дальше.",
      parameters: Type.Object({
        skillId: Type.String({ description: "ID навыка из list_skills" }),
      }),
      execute: async (_id, params: { skillId: string }) => {
        const sk = this.skillRegistry.get(params.skillId);
        if (!sk) return errText(`Навык не найден: ${params.skillId}. Посмотри доступные через list_skills.`);
        if (!sk.autoApply) {
          return errText(
            `Навык «${sk.name}» не разрешает самоприменение агентом (автоприменение выключено). Попроси пользователя подключить его к чату вручную.`,
          );
        }
        const ctx = this.store.get(ctxId);
        if (!ctx) return errText("Контекст задачи недоступен.");
        // Подключаем навык к контексту, если он ещё не подключён
        if (!(ctx.skills ?? []).includes(sk.id)) {
          ctx.skills = [...(ctx.skills ?? []), sk.id];
        }
        // Сбрасываем доставку для этого агента: при следующем запуске (новая сессия)
        // тело навыка инжектится автоматически — как навыки, подключённые пользователем.
        const delivered = ctx.deliveredSkills?.[agentId] ?? [];
        if (delivered.includes(sk.id)) {
          ctx.deliveredSkills = { ...(ctx.deliveredSkills ?? {}), [agentId]: delivered.filter((x) => x !== sk.id) };
        }
        this.store.save(ctx);
        const def = this.registry.get(agentId);
        const sysMsg: Message = {
          role: "system",
          text: `⚡ Агент «${def?.name ?? agentId}» применил навык «${sk.name}»`,
          ts: Date.now(),
        };
        this.store.appendMessage(ctxId, sysMsg);
        this.emit({ type: "message", ctxId, message: sysMsg });
        return okText(`Навык «${sk.name}» применён к контексту и к твоей работе в этой сессии. Правила навыка:\n\n${sk.body.trim()}`);
      },
    });
  }
}
