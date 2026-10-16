import fs from "node:fs";
import path from "node:path";
import type { ContextMeta, Handoff } from "./context-store";

/** ID оркестратора — хаб цепочки; его «обрыв» (ответ пользователю) не считается прерыванием. */
export const ORCHESTRATOR_ID = "orchestrator";
/** ID системного агента-маршрутизатора (режим recoveryMode="router_agent"). */
export const CHAIN_ROUTER_ID = "chain-router";

function listMd(dir: string, sub: string): string[] {
  try {
    return fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

/**
 * RecoveryEngine — логика восстановления обрыва цепочки handoff.
 * Выделено из runner.ts для разделения ответственности: runner занимается
 * запуском агентов, RecoveryEngine — обработкой обрывов и восстановлением.
 */
export class RecoveryEngine {
  private maxRecoveries: number;

  constructor(maxRecoveries: number) {
    this.maxRecoveries = maxRecoveries;
  }

  /** Изменить лимит восстановлений без пересоздания экземпляра (перечитывание config.json). */
  setMaxRecoveries(n: number) {
    this.maxRecoveries = n;
  }

  getLimit(): number {
    return this.maxRecoveries;
  }

  /**
   * Автоматическое обнаружение незавершённых задач при обрыве цепочки.
   * Проверяет, есть ли result-файл для последней task-задачи агента.
   */
  detectIncompleteTask(
    ctxDir: string,
    agentId: string,
    lastTask: Handoff | undefined,
    ctxId?: string
  ): { context: string; taskTitle?: string } | null {
    try {
      const tasksDir = path.join(ctxDir, "tasks");
      if (!fs.existsSync(tasksDir)) return null;

      const taskFiles = fs.readdirSync(tasksDir).filter(f => f.startsWith("task-") && f.endsWith(".md"));
      if (taskFiles.length === 0) return null;

      // Отсортировать по номеру (последний — самый большой)
      taskFiles.sort((a, b) => {
        const numA = parseInt(a.match(/task-(\d+)\.md/)?.[1] ?? "0");
        const numB = parseInt(b.match(/task-(\d+)\.md/)?.[1] ?? "0");
        return numB - numA;
      });

      // Проверить последний task-файл на наличие result-файла
      const lastTaskFile = taskFiles[0];
      const taskNum = parseInt(lastTaskFile.match(/task-(\d+)\.md/)?.[1] ?? "0");
      const resultFileName = `result-${String(taskNum).padStart(3, "0")}.md`;
      const resultsDir = path.join(ctxDir, "results");
      const hasResult = fs.existsSync(path.join(resultsDir, resultFileName));

      if (!hasResult) {
        const taskFilePath = path.join(tasksDir, lastTaskFile);
        let taskTitle = "";
        try {
          const taskContent = fs.readFileSync(taskFilePath, "utf8");
          const titleMatch = taskContent.match(/^# Задание: (.+)$/m);
          if (titleMatch) taskTitle = titleMatch[1];
        } catch { /* ignore */ }

        console.log(`[${ctxId ? `ctxId:${ctxId}` : "system"}] [recovery] ${agentId}: обнаружена незавершённая задача: ${lastTaskFile}`);
        return {
          context: `Продолжи выполнение задачи. Файл задания: ${taskFilePath}`,
          taskTitle: taskTitle || undefined,
        };
      }

      return null;
    } catch (e) {
      console.log(`[${ctxId ? `ctxId:${ctxId}` : "system"}] [recovery] ${agentId}: ошибка в detectIncompleteTask:`, e);
      return null;
    }
  }

  /** Промпт для оркестратора при обрыве цепочки (режим восстановления). */
  buildRecoveryPrompt(agentId: string, task: Handoff | undefined, lastMsg: string | undefined): string {
    return (
      `⚠️ ЦЕПОЧКА ПРЕРВАЛАСЬ. Агент ${agentId} завершил ход, не вызвав route_to_agent.\n\n` +
      `Ему было передано задание от ${task?.from ?? "?"}:\n` +
      `— Причина: ${task?.reason ?? "неизвестно"}\n` +
      `— Контекст: ${task?.context ?? "неизвестно"}\n\n` +
      `Последнее сообщение агента ${agentId}:\n${lastMsg ?? "(нет)"}\n\n` +
      `Ты входишь в РЕЖИМ ВОССТАНОВЛЕНИЯ. Проверь фактическое состояние (разреши себе использовать read/bash):\n` +
      `1. Если работа полностью завершена — передай дальше по цепочке через route_to_agent (если есть следующий шаг) или кратко сообщи пользователю итог, если цепочка закончена.\n` +
      `2. Если работа НЕ завершена — составь корректирующий промпт с учётом изначального задания и уже сделанного, и перезапусти агента ${agentId} через route_to_agent.`
    );
  }

  /** Промпт для агента-маршрутизатора при обрыве цепочки (recoveryMode="router_agent"). */
  buildRouterPrompt(ctx: ContextMeta, brokenAgent: string, task: Handoff | undefined, lastMsg: string | undefined, getCtxDir: (id: string) => string): string {
    const ctxDir = getCtxDir(ctx.id);
    const history = ctx.handoffs
      .map((h, i) =>
        `${i + 1}. [${new Date(h.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}] ${h.from} → ${h.to} — ${h.reason}`
      )
      .join("\n");
    const taskFiles = listMd(ctxDir, "tasks").map((f) => path.join(ctxDir, "tasks", f));
    const resultFiles = listMd(ctxDir, "results").map((f) => path.join(ctxDir, "results", f));
    const files = [
      taskFiles.length ? `Задания (tasks/):\n${taskFiles.map((p) => `- ${p}`).join("\n")}` : "",
      resultFiles.length ? `Результаты (results/):\n${resultFiles.map((p) => `- ${p}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return (
      `⚠️ ЦЕПОЧКА ПРЕРВАЛАСЬ. Агент ${brokenAgent} завершил ход, не вызвав route_to_agent.\n\n` +
      `## История маршрутизации\n${history || "(передач ещё не было)"}\n\n` +
      `## Файлы контекста\n${files || "(файлов заданий и результатов нет)"}\n\n` +
      `## Задание, которое было передано агенту ${brokenAgent}\n` +
      `— Причина: ${task?.reason ?? "неизвестно"}\n` +
      `— Контекст: ${task?.context ?? "неизвестно"}\n\n` +
      `## Последнее сообщение агента ${brokenAgent}\n${lastMsg ?? "(нет)"}\n\n` +
      `Действуй по алгоритму из системного промпта: 1) list_agents, 2) прочитай файлы, 3) route_to_agent.`
    );
  }

  /** Fallback-промпт для оркестратора: маршрутизатор не смог принять решение. */
  buildRouterFallbackPrompt(task: Handoff | undefined, lastMsg: string | undefined): string {
    return (
      `⚠️ ЦЕПОЧКА ПРЕРВАЛАСЬ, и агент-маршрутизатор (chain-router) не смог принять решение о передаче.\n\n` +
      `Задание, которое было передано предыдущему агенту:\n` +
      `— Причина: ${task?.reason ?? "неизвестно"}\n` +
      `— Контекст: ${task?.context ?? "неизвестно"}\n\n` +
      `Последнее сообщение маршрутизатора:\n${lastMsg ?? "(нет)"}\n\n` +
      `Ты входишь в РЕЖИМ ВОССТАНОВЛЕНИЯ (разреши себе использовать read/bash для проверки состояния).\n` +
      `1. Если работа полностью завершена — кратко сообщи пользователю итог.\n` +
      `2. Если работа НЕ завершена — передай дальше по цепочке через route_to_agent с корректирующим промптом.`
    );
  }

  /** Промпт для автоматического восстановления незавершённой задачи. */
  buildAutoRecoveryPrompt(
    agentId: string,
    originalTask: Handoff | undefined,
    lastMsg: string | undefined,
    incomplete: { context: string; taskTitle?: string }
  ): string {
    return (
      `⚠️ АВТОМАТИЧЕСКОЕ ВОССТАНОВЛЕНИЕ. Ты завершил предыдущий ход, не вызвав route_to_agent.\n` +
      `Анализ показал: задача НЕ завершена (отсутствует result-файл).\n\n` +
      `${incomplete.taskTitle ? `Задача: ${incomplete.taskTitle}\n\n` : ""}` +
      `Изначальное задание:\n` +
      `— От: ${originalTask?.from ?? "неизвестно"}\n` +
      `— Причина: ${originalTask?.reason ?? "неизвестно"}\n` +
      `— Контекст: ${originalTask?.context ?? "неизвестно"}\n\n` +
      `Твоё последнее сообщение:\n${lastMsg ?? "(нет)"}\n\n` +
      `## Что нужно сделать:\n` +
      `1. Прочитай файл задания (указан в контексте выше)\n` +
      `2. Продолжи выполнение задачи до конца\n` +
      `3. По завершении вызови handoff_file(type="result", ...) для записи результата\n` +
      `4. Вызови route_to_agent для передачи управления дальше по цепочке\n\n` +
      `ВАЖНО: обязательно заверши работу и передай управление, иначе цепочка прервётся снова.`
    );
  }

  /** Достигнут ли лимит восстановлений (нужно ли останавливать авто-восстановление). */
  isRecoveryLimitReached(recoveries: number): boolean {
    return recoveries >= this.maxRecoveries;
  }
}
