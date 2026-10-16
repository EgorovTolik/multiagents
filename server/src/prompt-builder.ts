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
      "При получении новой задачи от предыдущего агента вызови get_task_file_name — это создаст файл задания с уникальным номером. Запиши в него задачу через write/edit.\n" +
      "После завершения работы вызови get_result_file_name — это вернёт путь к файлу результата для этой задачи. Запиши результат и передай управление следующему агенту или заверши ход.";
    return p;
  }

  /** Промпт передачи диалога (обычный handoff). */
  buildHandoffPrompt(pending: Handoff): string {
    return (
      `Диалог передан агентом ${pending.from}.\n` +
      `Причина: ${pending.reason}\n\n` +
      `Контекст задачи:\n${pending.context}\n\n` +
      `ВАЖНО: если в контексте указан путь к файлу ТЗ (tasks/task-<timestamp>.md) — сначала прочитай его, потом приступай к работе.\n` +
      `По завершении вызови handoff_file(type="result", title="...", body="...") — инструмент создаст файл и вернёт путь. Упомяни путь в сообщении пользователю.\n` +
      `Если следующий шаг требует другой экспертизы — вызови handoff_file(type="task", ...) и передай диалог через route_to_agent.`
    );
  }

  /** Обновить глобальные правила окружения. */
  setGlobalRules(rules: string[]) {
    this.globalRules = rules;
  }
}