import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentRegistry, AgentDef } from "./registry";
import type { ContextStore, Handoff, Message } from "./context-store";
import type { SkillInjector } from "./skills-injector.js";
import type { Emit } from "./runner.ts";
import { PlanManager } from "@multiagents/plan-manager";
import { makeCreatePlanTool } from "./tools/create-plan";
import { makeUpdatePlanStepTool } from "./tools/update-plan-step";
import { makeAddSubtaskTool } from "./tools/add-subtask";
import { makeEmbedSubplanTool } from "./tools/embed-subplan";
import { makeGetPlanStatusTool } from "./tools/get-plan-status";
import { makeAddStepTool } from "./tools/add-step";
import { makeDeleteStepTool } from "./tools/delete-step";
import { makeDeletePlanTool } from "./tools/delete-plan";
import { makeUpdatePlanStepTaskTool } from "./tools/update-plan-step-task";
import { makeListPlansTool } from "./tools/list-plans";
import { makeSetActivePlanTool } from "./tools/set-active-plan";

interface ToolContext {
  ctxId: string;
  agentId: string;
  store: ContextStore;
  registry: AgentRegistry;
  emit: Emit;
  sharedDir: string;
  agentsDir: string;
  maxHandoffs: number;
  defaultDisabledToolNames: () => Promise<string[]>;
}

function okText(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function errText(text: string) {
  return { content: [{ type: "text" as const, text: `Ошибка: ${text}` }], details: { isError: true } };
}

export function makeListAgentsTool(registry: AgentRegistry) {
  return defineTool({
    name: "list_agents",
    label: "Список агентов",
    description:
      "Показывает всех агентов системы с их описаниями. Вызывай перед route_to_agent, чтобы выбрать, кому передать диалог.",
    parameters: Type.Object({}),
    execute: async () => {
      const lines = registry.list().map((a) => `- ${a.id}: ${a.description}`);
      return okText("Агенты системы:\n" + lines.join("\n"));
    },
  });
}

export function makeRouteTool(ctxId: string, agentId: string, store: ContextStore, registry: AgentRegistry, emit: Emit, maxHandoffs: number) {
  return defineTool({
    name: "route_to_agent",
    label: "Передача диалога",
    description:
      "Передаёт диалог другому агенту с более подходящей экспертизой. Вызывай, когда следующий шаг задачи требует другой компетенции. " +
      "Текущий ход завершится, и целевой агент продолжит работу с переданным контекстом.",
    parameters: Type.Object({
      agentId: Type.String({ description: "ID целевого агента (см. list_agents)" }),
      reason: Type.String({ description: "Одно короткое предложение — причина передачи (покажется пользователю в интерфейсе)" }),
      context: Type.String({
        description:
          "Короткое описание задачи (1-3 предложения) + абсолютный путь к файлу ТЗ (вернёт handoff_file). НЕ пересказывай всё задание — агент сам прочитает файл. Укажи инструкции: прочитай ТЗ, результат запиши через handoff_file(type='result').",
      }),
    }),
    execute: async (_id, params: { agentId: string; reason: string; context: string }) => {
      const ctx = store.get(ctxId);
      if (ctx?.trainingAgentId) {
        return errText("Во время обучающей сессии передача задач другим агентам запрещена. Объясни пользователю, что ты сам продолжишь работу.");
      }
      const target = registry.get(params.agentId);
      if (!target) {
        return errText(`Агент "${params.agentId}" не найден. Доступны: ${registry.list().map((a) => a.id).join(", ")}`);
      }
      if (params.agentId === agentId) {
        return errText("Этот диалог уже обрабатывает данный агент");
      }
      if (!ctx || ctx.handoffs.length >= maxHandoffs) {
        return errText(`Достигнут лимит передач в цепочке (${maxHandoffs}). Продолжи работу сам.`);
      }
      const handoff: Handoff = { from: agentId, to: params.agentId, reason: params.reason, context: params.context, ts: Date.now() };
      ctx.pendingHandoff = handoff;
      store.save(ctx);
      emit({ type: "handoff_pending", ctxId, handoff });
      return okText(
        `Передача запланирована: после завершения текущего шага диалог будет передан агенту "${params.agentId}" (${target.description}). ` +
          `Пользователь видит передачу в интерфейсе и может её отменить. Заверши текущий ход.`,
      );
    },
  });
}

export function makeAskUserTool(ctxId: string, agentId: string, store: ContextStore, emit: Emit, sessionsKey: () => string) {
  return defineTool({
    name: "ask_user",
    label: "Спросить пользователя",
    description:
      "Задаёт вопрос пользователю и ждёт его ответа. Вызывай, когда не хватает информации для продолжения (уточнение требований, выбор варианта, подтверждение). " +
      "Текущий ход завершится, пользователь увидит вопрос и ответит. Ответ придёт тебе в следующем сообщении — продолжи работу с ним.",
    parameters: Type.Object({
      question: Type.String({ description: "Вопрос к пользователю (чёткий, конкретный, с вариантами если есть)" }),
    }),
    execute: async (_id, params: { question: string }) => {
      const ctx = store.get(ctxId)!;
      ctx.awaitingUser = { agentId, question: params.question };
      store.save(ctx);
      emit({ type: "ask_user", ctxId, agentId, question: params.question });
      const sysMsg: Message = {
        role: "system",
        text: `❓ ${agentId} задал вопрос пользователю: «${params.question}» — ждёт ответа. Это НЕ прерывание цепочки.`,
        ts: Date.now(),
      };
      store.appendMessage(ctxId, sysMsg);
      emit({ type: "message", ctxId, message: sysMsg });
      return okText(`Вопрос отправлен пользователю: «${params.question}». ХОД ЗАВЕРШЁН — ответ пользователя придёт в следующем сообщении.`);
    },
  });
}

export function makeHandoffFileTool(ctxId: string, getCtxDir: (ctxId: string) => string, store: ContextStore) {
  return defineTool({
    name: "handoff_file",
    label: "Файл задания/результата",
    description:
      "Создаёт файл задания (task) или результата (result) в рабочей директории контекста. " +
      "Имя файла генерируется автоматически с timestamp (task-<ms>.md / result-<ms>.md). " +
      "Возвращает абсолютный путь к созданному файлу — используй его в route_to_agent (context) и в сообщениях.",
    parameters: Type.Object({
      type: Type.Union([Type.Literal("task"), Type.Literal("result")], { description: "task = файл задания, result = файл с результатом" }),
      title: Type.String({ description: "Краткое название (1-5 слов), станет заголовком файла" }),
      body: Type.String({ description: "Полное содержимое файла в markdown" }),
    }),
    execute: async (_id, params: { type: "task" | "result"; title: string; body: string }) => {
      const ctxDir = getCtxDir(ctxId);
      let meta = store.get(ctxId);
      if (!meta) return errText(`Контекст ${ctxId} не найден`);

      let fileNum: number;
      if (params.type === "task") {
        meta.taskCounter = (meta.taskCounter ?? 0) + 1;
        fileNum = meta.taskCounter;
        store.save(meta);
      } else {
        fileNum = meta.taskCounter ?? 0;
        if (fileNum === 0) return errText("Сначала создайте задачу через handoff_file(type='task')");
      }

      const dirName = params.type === "task" ? "tasks" : "results";
      const dirPath = path.join(ctxDir, dirName);
      fs.mkdirSync(dirPath, { recursive: true });

      const filename = `${params.type}-${String(fileNum).padStart(3, "0")}.md`;
      const filePath = path.join(dirPath, filename);
      const header = params.type === "task" ? `# Задание: ${params.title}\n\n` : `# Результат: ${params.title}\n\n`;
      fs.writeFileSync(filePath, header + params.body, "utf8");

      return { content: [{ type: "text" as const, text: `Файл создан: ${filePath}` }], details: {} };
    },
  });
}

export function makeSharedStoreTool(sharedDir: string) {
  return defineTool({
    name: "artifact_store",
    label: "Общее хранилище артефактов",
    description:
      "Возвращает путь к общему хранилищу артефактов — «долговременной памяти», доступной всем агентам во всех чатах.",
    parameters: Type.Object({}),
    execute: async () => {
      fs.mkdirSync(sharedDir, { recursive: true });
      const indexPath = path.join(sharedDir, "INDEX.md");
      if (!fs.existsSync(indexPath)) {
        fs.writeFileSync(
          indexPath,
          "# Индекс хранилища артефактов\n\nКороткие пояснения к разделам. Начинай с этого файла.\n\nФормат записи: `- <каталог>` — что внутри (контекст/задача, дата)\n\n---\n",
          "utf8",
        );
      }
      return okText(
        `Общее хранилище артефактов: ${sharedDir}\nИндекс: ${indexPath}\n\nПротокол работы:\n` +
          `1. Сначала прочитай INDEX.md — возможно, нужное уже лежит в хранилище.\n` +
          `2. Свои артефакты клади в отдельный подкаталог: строчные буквы, дефисы.\n` +
          `3. После записи добавь в INDEX.md запись о своём каталоге.`,
      );
    },
  });
}

export function makeCreateAgentTool(registry: AgentRegistry, agentsDir: string, emit: Emit, defaultDisabledToolNames: () => Promise<string[]>) {
  return defineTool({
    name: "create_agent",
    label: "Создать агента",
    description:
      "Создаёт нового агента в системе: записывает его системный промпт, правила и навыки в agents/<name>/ и регистрирует.",
    parameters: Type.Object({
      name: Type.String({ description: "ID агента: нижний регистр, дефисы (например code-reviewer)" }),
      description: Type.String({ description: "Короткое описание (1-2 предложения)" }),
      systemPrompt: Type.String({ description: "Системный промпт: роль, возможности, правила работы" }),
      rules: Type.Optional(Type.Array(
        Type.Object({ name: Type.String(), content: Type.String() })
      )),
      skills: Type.Optional(Type.Array(
        Type.Object({ name: Type.String(), description: Type.String(), content: Type.String() })
      )),
    }),
    execute: async (_id, params) => {
      try {
        const agentParams: any = { ...params };
        if (agentParams.rules && Array.isArray(agentParams.rules)) {
          agentParams.rules = agentParams.rules.map((r: any) => r.content);
        }
        if (agentParams.skills && Array.isArray(agentParams.skills)) {
          agentParams.skills = agentParams.skills.map((s: any) => ({ name: s.name, description: s.description, content: s.content }));
        }
        const def = registry.create(agentParams);
        try {
          const disabled = await defaultDisabledToolNames();
          if (disabled.length > 0) {
            const cfgPath = path.join(agentsDir, def.id, "config.json");
            const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
            cfg.disabledTools = disabled;
            fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
          }
        } catch (e) {
          console.error("[runner] не удалось записать denylist нового агента:", e);
        }
        registry.reload();
        emit({ type: "agents", agents: registry.list() });
        return okText(`Агент "${def.id}" создан и зарегистрирован. Директория: ${path.join(agentsDir, def.id)}`);
      } catch (e: any) {
        return errText(String(e?.message ?? e));
      }
    },
  });
}

export function makeDeleteAgentTool(registry: AgentRegistry, emit: Emit) {
  return defineTool({
    name: "delete_agent",
    label: "Удалить агента",
    description:
      "Удаляет агента из системы. Системные агенты (orchestrator, agent-creator) удалить нельзя.",
    parameters: Type.Object({
      name: Type.String({ description: "ID агента для удаления" }),
    }),
    execute: async (_id, params: { name: string }) => {
      try {
        registry.delete(params.name);
        emit({ type: "agents", agents: registry.list() });
        return okText(`Агент "${params.name}" удалён.`);
      } catch (e: any) {
        return errText(String(e?.message ?? e));
      }
    },
  });
}

export function makeNotifyTool(emit: Emit, ctxId: string) {
  return defineTool({
    name: "notify",
    label: "Уведомление пользователю",
    description:
      "Отправляет короткое уведомление пользователю в чат (toast). Используйте для информирования о прогрессе, важных событиях или ошибках.",
    parameters: Type.Object({
      message: Type.String({ description: "Текст уведомления (кратко, до 100 символов)" }),
      sticky: Type.Optional(
        Type.Boolean({ description: "true — уведомление не закрывается автоматически (по умолчанию false)" })
      ),
    }),
    execute: async (_id, params) => {
      const msg = params.message as string;
      const sticky = params.sticky as boolean | undefined;
      emit({ type: "agent_notification", ctxId, message: msg, sticky });
      return okText(`Уведомление отправлено: "${msg}"`);
    },
  });
}

/** Фабрика всех инструментов агента. */
export function buildAgentTools(ctxId: string, agentId: string, def: AgentDef, store: ContextStore, registry: AgentRegistry, emit: Emit, getCtxDir: (ctxId: string) => string, sharedDir: string, agentsDir: string, maxHandoffs: number, defaultDisabledToolNames: () => Promise<string[]>, skillInjector: SkillInjector, sessionsKey: () => string) {
  const manager = PlanManager.getInstance();
  const tools = [
    makeListAgentsTool(registry),
    makeRouteTool(ctxId, agentId, store, registry, emit, maxHandoffs),
    makeAskUserTool(ctxId, agentId, store, emit, sessionsKey),
    makeHandoffFileTool(ctxId, getCtxDir, store),
    skillInjector.createListSkillsTool(),
    skillInjector.createUseSkillTool(ctxId, agentId),
    makeSharedStoreTool(sharedDir),
    makeNotifyTool(emit, ctxId),
    makeCreatePlanTool(ctxId, store, manager, getCtxDir, emit),
    makeUpdatePlanStepTool(ctxId, store, manager, getCtxDir, emit),
    makeAddSubtaskTool(ctxId, store, manager, getCtxDir),
    makeEmbedSubplanTool(ctxId, store, manager, getCtxDir, emit),
    makeGetPlanStatusTool(ctxId, store, manager, getCtxDir),
    makeListPlansTool(ctxId, store, manager),
    makeSetActivePlanTool(ctxId, store, manager, emit),
    makeAddStepTool(ctxId, store, manager, getCtxDir, emit),
    makeDeleteStepTool(ctxId, store, manager, getCtxDir, emit),
    makeDeletePlanTool(ctxId, store, manager, getCtxDir, emit),
    makeUpdatePlanStepTaskTool(ctxId, store, manager, getCtxDir, emit),
  ];
  if (agentId === "agent-creator") {
    tools.push(makeCreateAgentTool(registry, agentsDir, emit, defaultDisabledToolNames));
    tools.push(makeDeleteAgentTool(registry, emit));
  }
  const deniedNames = new Set(def.disabledTools ?? []);
  return tools.filter((t) => !deniedNames.has(t.name));
}