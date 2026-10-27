import type { AgentDef } from "./registry";
import type { Handoff } from "./context-store";

/** Сборщик промптов для агентов — вынесен из runner.ts. */
export class PromptBuilder {
  constructor(private globalRules: string[]) {}

  /** Системный промпт агента с правилами окружения и навыками. */
  buildSystemPrompt(def: AgentDef, workdir: string): string {
    let p = `# Рабочая директория\n\n${workdir}\n`;
    p += `\n${def.systemPrompt}`;
    if (def.rules.length > 0) {
      p += "\n\n## Дополнительные правила\n\n" + def.rules.join("\n\n");
    }
    if (this.globalRules.length > 0 && def.id !== "chain-router") {
      p += "\n\n## Правила окружения\n\n" + this.globalRules.join("\n\n");
    }
    if (def.skills.length > 0) {
      p +=
        "\n\n## Навыки\n\n" +
        def.skills.map((s) => `- ${s.name}: ${s.description} (файл: ${s.path})`).join("\n") +
        "\n\nПеред выполнением задачи, подходящей под навык, прочитай его файл.";
    }
    p +=
      "\n\n## Передача работы\n\n" +
      "Если следующий шаг задачи требует другой экспертизы, вызови инструмент route_to_agent — " +
      "диалог будет передан нужному агенту, а ты увидишь подтверждение. " +
      "Пользователь видит все передачи в интерфейсе и может их прерывать.";
    p +=
      "\n\n## Управление задачами\n\n" +
      "При передаче задачи используй route_to_agent с type='task', title и body — инструмент автоматически создаст файл задания.\n" +
      "После завершения работы вызови route_to_agent с type='result', title и body — инструмент создаст файл результата и передаст управление дальше по цепочке.";
    return p;
  }

  /** Промпт передачи диалога (обычный handoff). */
  buildHandoffPrompt(pending: Handoff): string {
    let prompt = `Диалог передан агентом ${pending.from}.\nПричина: ${pending.reason}\n\n`;

    if (pending.fileRef) {
      const { path, type, title } = pending.fileRef;
      if (type === "task") {
        prompt += `📄 **Файл задания:** ${path}\n   Название: «${title}»\n\n`;
        prompt += `**Прочитай файл задания перед началом работы.**\n\n`;
      } else {
        prompt += `📄 **Файл результата (от предыдущего агента):** ${path}\n   Название: «${title}»\n\n`;
      }
    } else if (pending.context) {
      // Legacy format — context string without fileRef
      prompt += `Контекст задачи:\n${pending.context}\n\n`;
    }

    prompt += `✅ **Как закончить работу:**\n`;
    prompt += `Когда задача будет выполнена, вызови route_to_agent с type="result":\n\n`;
    prompt += `route_to_agent({\n`;
    prompt += `  agentId: "<id следующего агента>",\n`;
    prompt += `  reason: "Краткая причина",\n`;
    prompt += `  type: "result",\n`;
    prompt += `  title: "Название результата",\n`;
    prompt += `  body: "Подробное описание результата"\n`;
    prompt += `})\n\n`;

    if (pending.fileRef && pending.fileRef.type === "task") {
      prompt += `Если следующий шаг требует другой экспертизы, передай задачу дальше через route_to_agent с type="task".`;
    }

    return prompt;
  }

  /** Обновить глобальные правила окружения. */
  setGlobalRules(rules: string[]) {
    this.globalRules = rules;
  }
}