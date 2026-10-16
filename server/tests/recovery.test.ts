import { describe, test, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RecoveryEngine, ORCHESTRATOR_ID, CHAIN_ROUTER_ID } from "../src/recovery";
import type { Handoff } from "../src/context-store";

describe("RecoveryEngine", () => {
  let engine: RecoveryEngine;

  beforeEach(() => {
    engine = new RecoveryEngine(3);
  });

  describe("detectIncompleteTask", () => {
    test("возвращает контекст, если task-файл есть, а result — нет", () => {
      const ctxDir = "/tmp/test-recovery";
      const tasksDir = path.join(ctxDir, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });

      // Записать task-файл
      fs.writeFileSync(path.join(tasksDir, "task-001.md"), "# Задание: написать код\n\nОписание задачи...");

      // Результата нет — задача незавершена
      const result = engine.detectIncompleteTask(ctxDir, "coder", undefined);
      expect(result).not.toBeNull();
      expect(result?.context).toContain("task-001.md");
      expect(result?.taskTitle).toBe("написать код");

      // Очистка
      fs.rmSync(ctxDir, { recursive: true });
    });

    test("возвращает null, если result-файл уже существует", () => {
      const ctxDir = "/tmp/test-recovery2";
      const tasksDir = path.join(ctxDir, "tasks");
      const resultsDir = path.join(ctxDir, "results");
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.mkdirSync(resultsDir, { recursive: true });

      // Записать task-файл и result-файл
      fs.writeFileSync(path.join(tasksDir, "task-001.md"), "# Задание: написать код\n\nОписание");
      fs.writeFileSync(path.join(resultsDir, "result-001.md"), "# Результат\nКод написан.");

      // Результат есть — задача завершена
      const result = engine.detectIncompleteTask(ctxDir, "coder", undefined);
      expect(result).toBeNull();

      // Очистка
      fs.rmSync(ctxDir, { recursive: true });
    });

    test("возвращает null, если задач нет", () => {
      const ctxDir = "/tmp/test-recovery3";
      fs.mkdirSync(path.join(ctxDir, "tasks"), { recursive: true });

      const result = engine.detectIncompleteTask(ctxDir, "coder", undefined);
      expect(result).toBeNull();

      // Очистка
      fs.rmSync(ctxDir, { recursive: true });
    });

    test("проверяет последний task-файл (самый большой номер)", () => {
      const ctxDir = "/tmp/test-recovery4";
      const tasksDir = path.join(ctxDir, "tasks");
      const resultsDir = path.join(ctxDir, "results");
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.mkdirSync(resultsDir, { recursive: true });

      // task-001 завершена (есть result)
      fs.writeFileSync(path.join(tasksDir, "task-001.md"), "# Задание: шаг 1\n...");
      fs.writeFileSync(path.join(resultsDir, "result-001.md"), "# Результат шага 1");

      // task-002 не завершена (нет result)
      fs.writeFileSync(path.join(tasksDir, "task-002.md"), "# Задание: шаг 2\n...");

      const result = engine.detectIncompleteTask(ctxDir, "coder", undefined);
      expect(result).not.toBeNull();
      expect(result?.context).toContain("task-002.md");
      expect(result?.taskTitle).toBe("шаг 2");

      // Очистка
      fs.rmSync(ctxDir, { recursive: true });
    });
  });

  describe("buildRecoveryPrompt", () => {
    test("генерирует промпт для режима восстановления оркестратора", () => {
      const task: Handoff = {
        from: "lead-dev",
        to: "coder",
        reason: "Нужен код",
        context: "Реализовать фичу X",
        ts: Date.now(),
      };

      const prompt = engine.buildRecoveryPrompt("coder", task, "Я закончил");
      expect(prompt).toContain("ЦЕПОЧКА ПРЕРВАЛАСЬ");
      expect(prompt).toContain("Агент coder завершил ход");
      expect(prompt).toContain("РЕЖИМ ВОССТАНОВЛЕНИЯ");
      expect(prompt).toContain("Реализовать фичу X");
      expect(prompt).toContain("Я закончил");
    });

    test("работает с undefined task и lastMsg", () => {
      const prompt = engine.buildRecoveryPrompt("coder", undefined, undefined);
      expect(prompt).toContain("ЦЕПОЧКА ПРЕРВАЛАСЬ");
      expect(prompt).toContain("(нет)");
    });
  });

  describe("buildRouterPrompt", () => {
    test("генерирует промпт для chain-router с историей и файлами", () => {
      const ctx = {
        id: "ctx-1",
        createdAt: Date.now(),
        handoffs: [
          { from: "user", to: "lead-dev", reason: "Фича X", context: "...", ts: 1 },
          { from: "lead-dev", to: "coder", reason: "Код", context: "...", ts: 2 },
        ],
        lastTaskFile: "task-002.md",
      };

      const getCtxDir = () => "/tmp/test-router";
      fs.mkdirSync(path.join("/tmp/test-router", "tasks"), { recursive: true });
      fs.writeFileSync(path.join("/tmp/test-router", "tasks", "task-001.md"), "# Задание 1");
      fs.writeFileSync(path.join("/tmp/test-router", "tasks", "task-002.md"), "# Задание 2");

      const task: Handoff = {
        from: "lead-dev",
        to: "coder",
        reason: "Код фичи X",
        context: "Реализовать API",
        ts: Date.now(),
      };

      const prompt = engine.buildRouterPrompt(ctx, "coder", task, "Закончил частично", getCtxDir);
      expect(prompt).toContain("ЦЕПОЧКА ПРЕРВАЛАСЬ");
      expect(prompt).toContain("История маршрутизации");
      expect(prompt).toContain("user → lead-dev");
      expect(prompt).toContain("lead-dev → coder");
      expect(prompt).toContain("Файлы контекста");
      expect(prompt).toContain("task-001.md");
      expect(prompt).toContain("Код фичи X");

      // Очистка
      fs.rmSync("/tmp/test-router", { recursive: true });
    });
  });

  describe("buildRouterFallbackPrompt", () => {
    test("генерирует fallback-промпт, если chain-router не принял решение", () => {
      const task: Handoff = {
        from: "lead-dev",
        to: "coder",
        reason: "Код",
        context: "...",
        ts: Date.now(),
      };

      const prompt = engine.buildRouterFallbackPrompt(task, "Не могу решить");
      expect(prompt).toContain("ЦЕПОЧКА ПРЕРВАЛАСЬ");
      expect(prompt).toContain("chain-router");
      expect(prompt).toContain("РЕЖИМ ВОССТАНОВЛЕНИЯ");
    });
  });

  describe("buildAutoRecoveryPrompt", () => {
    test("генерирует промпт для автоматического восстановления задачи", () => {
      const task: Handoff = {
        from: "lead-dev",
        to: "coder",
        reason: "Написать код",
        context: "Функция foo()",
        ts: Date.now(),
      };

      const incomplete = {
        context: "/path/to/task-001.md",
        taskTitle: "Реализовать функцию foo()",
      };

      const prompt = engine.buildAutoRecoveryPrompt("coder", task, "Начал писать...", incomplete);
      expect(prompt).toContain("АВТОМАТИЧЕСКОЕ ВОССТАНОВЛЕНИЕ");
      expect(prompt).toContain("задача НЕ завершена");
      expect(prompt).toContain("Реализовать функцию foo()");
      expect(prompt).toContain("handoff_file");
      expect(prompt).toContain("route_to_agent");
    });
  });

  describe("isRecoveryLimitReached", () => {
    test("возвращает false, если лимит не достигнут", () => {
      expect(engine.isRecoveryLimitReached(0)).toBe(false);
      expect(engine.isRecoveryLimitReached(1)).toBe(false);
      expect(engine.isRecoveryLimitReached(2)).toBe(false);
    });

    test("возвращает true, когда лимит достигнут", () => {
      expect(engine.isRecoveryLimitReached(3)).toBe(true);
      expect(engine.isRecoveryLimitReached(5)).toBe(true);
    });
  });

  describe("setMaxRecoveries / getLimit", () => {
    test("позволяет изменить лимит восстановлений", () => {
      expect(engine.getLimit()).toBe(3);
      engine.setMaxRecoveries(5);
      expect(engine.getLimit()).toBe(5);
      expect(engine.isRecoveryLimitReached(4)).toBe(false);
      expect(engine.isRecoveryLimitReached(5)).toBe(true);
    });
  });

  describe("constants", () => {
    test("ORCHESTRATOR_ID и CHAIN_ROUTER_ID определены", () => {
      expect(ORCHESTRATOR_ID).toBe("orchestrator");
      expect(CHAIN_ROUTER_ID).toBe("chain-router");
    });
  });
});
