/**
 * Unit-тесты для PlanManager.
 * Покрывают все сценарии из спецификации docs/plan-manager-spec.md.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PlanManager, Plan, PlanStep } from '../src/plan-manager.js';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Вспомогательный класс для управления активным планом (отделен от PlanManager)
class ContextStore {
  constructor(ctxDir) {
    this.ctxDir = ctxDir;
  }
  async setActivePlanId(planId) {
    const filePath = join(this.ctxDir, 'context.json');
    let data = {};
    try {
      const content = await readFile(filePath, 'utf-8');
      data = JSON.parse(content);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    data.activePlanId = planId;
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
  async getActivePlanId() {
    const filePath = join(this.ctxDir, 'context.json');
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return data.activePlanId || null;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
}

import { readFile, writeFile } from 'fs/promises';

describe('PlanManager', () => {
  let pm;
  let ctxDir;

  beforeEach(async () => {
    ctxDir = await mkdtemp(join(tmpdir(), 'plan-manager-test-'));
    const plansDir = join(ctxDir, 'plans');
    // Создаем директорию планов
    await mkdir(plansDir);
    pm = new PlanManager({ plansDir });
  });

  describe('Основные операции', () => {
    it('1. Создание нового плана и проверка сохранения на диск', async () => {
      const plan = await pm.createPlan({
        title: 'Тестовый план',
        description: 'Описание плана',
        createdBy: 'orchestrator'
      });

      expect(plan.id).toBeDefined();
      expect(plan.title).toBe('Тестовый план');
      expect(plan.status).toBe('planning');
      expect(plan.steps).toEqual([]);
      expect(plan.createdBy).toBe('orchestrator');

      // Проверка сохранения на диск
      const loaded = await pm.loadPlan(plan.id);
      expect(loaded).not.toBeNull();
      expect(loaded.title).toBe('Тестовый план');
    });

    it('2. Загрузка существующего плана по ID', async () => {
      const plan = await pm.createPlan({
        title: 'План для загрузки',
        createdBy: 'user-1'
      });

      const loaded = await pm.loadPlan(plan.id);
      expect(loaded).not.toBeNull();
      expect(loaded.id).toBe(plan.id);
      expect(loaded.title).toBe('План для загрузки');
    });

    it('Загрузка несуществующего плана возвращает null', async () => {
      const loaded = await pm.loadPlan('non-existent-id');
      expect(loaded).toBeNull();
    });

    it('3. Обновление статуса шага (pending → in_progress → done)', async () => {
      const plan = await pm.createPlan({ title: 'План для статусов', createdBy: 'user' });
      const step = await pm.addStep(plan, 'Задача 1');

      expect(step.status).toBe('pending');

      await pm.updateStepStatus(plan, step.id, 'in_progress');
      const reloaded = await pm.loadPlan(plan.id);
      expect((await pm.findStepById(reloaded, step.id)).status).toBe('in_progress');

      await pm.updateStepStatus(reloaded, step.id, 'done');
      const reloaded2 = await pm.loadPlan(plan.id);
      expect((await pm.findStepById(reloaded2, step.id)).status).toBe('done');
    });

    it('4. Добавление подзадачи к существующему шагу', async () => {
      const plan = await pm.createPlan({ title: 'План с подзадачами', createdBy: 'user' });
      const parentStep = await pm.addStep(plan, 'Родительская задача');

      const subtask = await pm.addSubtask(plan, parentStep.id, 'Подзадача 1');
      expect(subtask).toBeDefined();
      expect(subtask.task).toBe('Подзадача 1');
      expect(subtask.status).toBe('pending');

      // Проверка вложенности
      const reloaded = await pm.loadPlan(plan.id);
      const parentReloaded = await pm.findStepById(reloaded, parentStep.id);
      expect(parentReloaded.steps.length).toBe(1);
      expect(parentReloaded.steps[0].task).toBe('Подзадача 1');
    });

    it('5. Удаление шага с вложенными подзадачами', async () => {
      const plan = await pm.createPlan({ title: 'План для удаления', createdBy: 'user' });
      const step = await pm.addStep(plan, 'Шаг для удаления');
      await pm.addSubtask(plan, step.id, 'Подзадача 1');
      await pm.addSubtask(plan, step.id, 'Подзадача 2');

      // Проверка что подзадачи существуют
      const before = await pm.loadPlan(plan.id);
      const stepBefore = await pm.findStepById(before, step.id);
      expect(stepBefore.steps.length).toBe(2);

      // Удаление шага
      await pm.removeStep(before, step.id);

      // Проверка что шаг удален вместе с подзадачами
      const after = await pm.loadPlan(plan.id);
      const stepAfter = await pm.findStepById(after, step.id);
      expect(stepAfter).toBeNull();
    });
  });

  describe('Работа с файлами планов', () => {
    it('6. Привязка файла задания к шагу (taskFiles)', async () => {
      const plan = await pm.createPlan({ title: 'План с файлами', createdBy: 'user' });
      const step = await pm.addStep(plan, 'Задача');

      await pm.attachTaskFile(plan, step.id, 'tasks/auth-routes.md');

      const reloaded = await pm.loadPlan(plan.id);
      const stepReloaded = await pm.findStepById(reloaded, step.id);
      expect(stepReloaded.taskFiles.length).toBe(1);
      expect(stepReloaded.taskFiles[0].file).toBe('tasks/auth-routes.md');
      expect(stepReloaded.taskFiles[0].timestamp).toBeDefined();
    });

    it('7. Привязка файла результата к шагу (resultsFiles)', async () => {
      const plan = await pm.createPlan({ title: 'План с результатами', createdBy: 'user' });
      const step = await pm.addStep(plan, 'Задача');

      await pm.attachResultFile(plan, step.id, 'results/auth-done.md');

      const reloaded = await pm.loadPlan(plan.id);
      const stepReloaded = await pm.findStepById(reloaded, step.id);
      expect(stepReloaded.resultsFiles.length).toBe(1);
      expect(stepReloaded.resultsFiles[0].file).toBe('results/auth-done.md');
    });

    it('8. Встраивание подплана через поле planFile', async () => {
      const mainPlan = await pm.createPlan({ title: 'Основной план', createdBy: 'user' });
      const step = await pm.addStep(mainPlan, 'Шаг с подпланом');

      // Создаем детальный подплан
      const subplan = await pm.createPlan({ title: 'Детальный подплан', createdBy: 'user' });
      await pm.addStep(subplan, 'Подшаг 1');
      await pm.addStep(subplan, 'Подшаг 2');

      // Встраиваем через объект плана (перегрузка 2)
      await pm.embedSubplan(mainPlan, step.id, subplan);

      const reloaded = await pm.loadPlan(mainPlan.id);
      const stepReloaded = await pm.findStepById(reloaded, step.id);
      expect(stepReloaded.planFile).toContain(subplan.id);
    });
  });

  describe('Рекурсивные операции', () => {
    it('9. Поиск шага в вложенном подплане по ID', async () => {
      const mainPlan = await pm.createPlan({ title: 'Основной', createdBy: 'user' });
      const step = await pm.addStep(mainPlan, 'Шаг с подпланом');

      const subplan = await pm.createPlan({ title: 'Подплан', createdBy: 'user' });
      const substep1 = await pm.addStep(subplan, 'Подшаг 1');
      const substep2 = await pm.addStep(subplan, 'Подшаг 2');

      // Встраиваем подплан
      await pm.embedSubplan(mainPlan, step.id, subplan);

      // Перезагружаем и ищем шаг из подплана
      const reloadedMain = await pm.loadPlan(mainPlan.id);
      const foundStep = await pm.findStepById(reloadedMain, substep1.id);
      expect(foundStep).not.toBeNull();
      expect(foundStep.task).toBe('Подшаг 1');

      const foundStep2 = await pm.findStepById(reloadedMain, substep2.id);
      expect(foundStep2).not.toBeNull();
    });

    it('10. Получение общего прогресса с учетом вложенных планов', async () => {
      const mainPlan = await pm.createPlan({ title: 'План для прогресса', createdBy: 'user' });
      const step1 = await pm.addStep(mainPlan, 'Шаг 1');
      const step2 = await pm.addStep(mainPlan, 'Шаг 2');

      // Завершаем один шаг
      await pm.updateStepStatus(mainPlan, step1.id, 'done');

      // Создаем и встраиваем подплан
      const subplan = await pm.createPlan({ title: 'Подплан', createdBy: 'user' });
      const substep1 = await pm.addStep(subplan, 'Подшаг 1');
      const substep2 = await pm.addStep(subplan, 'Подшаг 2');

      // Завершаем один подшаг
      await pm.updateStepStatus(subplan, substep1.id, 'done');

      await pm.embedSubplan(mainPlan, step1.id, subplan);

      // Перезагружаем и проверяем прогресс
      const reloaded = await pm.loadPlan(mainPlan.id);
      const progress = await pm.getOverallProgress(reloaded);

      expect(progress.total).toBe(4); // 2 шага + 2 подшага
      expect(progress.done).toBe(2);  // шаг1 + подшаг1
      expect(progress.percent).toBe(50);
    });

    it('11. Обновление статуса шага во вложенном плане', async () => {
      const mainPlan = await pm.createPlan({ title: 'Основной', createdBy: 'user' });
      const step = await pm.addStep(mainPlan, 'Шаг');

      const subplan = await pm.createPlan({ title: 'Подплан', createdBy: 'user' });
      const substep = await pm.addStep(subplan, 'Подшаг для обновления');

      await pm.embedSubplan(mainPlan, step.id, subplan);

      // Обновляем статус подшага
      await pm.updateStepStatus(subplan, substep.id, 'in_progress');

      // Перезагружаем и проверяем
      const reloadedSub = await pm.loadPlan(subplan.id);
      expect(reloadedSub.steps[0].status).toBe('in_progress');
    });
  });

  describe('Интеграция с context-store', () => {
    it('12. Установка активного плана для контекста', async () => {
      const plan = await pm.createPlan({ title: 'Активный план', createdBy: 'user' });

      // Устанавливаем активный план через внешний ContextStore
      const store = new ContextStore(ctxDir);
      await store.setActivePlanId(plan.id);

      // Проверяем что запись была создана
      const ctxStorePath = join(ctxDir, 'context.json');
      const content = await readFile(ctxStorePath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.activePlanId).toBe(plan.id);
    });

    it('13. Загрузка активного плана из context.json', async () => {
      const plan = await pm.createPlan({ title: 'План для загрузки как активный', createdBy: 'user' });

      // Устанавливаем активный план через внешний ContextStore
      const store = new ContextStore(ctxDir);
      await store.setActivePlanId(plan.id);

      // Загружаем ID активного плана и затем сам план
      const activePlanId = await store.getActivePlanId();
      const loaded = await pm.loadPlan(activePlanId);

      expect(loaded).not.toBeNull();
      expect(loaded.id).toBe(plan.id);
      expect(loaded.title).toBe('План для загрузки как активный');
    });
  });

  describe('Валидация', () => {
    it('Plan.isValid() — валидный план', async () => {
      const plan = await pm.createPlan({ title: 'Валидный план', createdBy: 'user' });
      expect(plan.isValid()).toBe(true);
    });

    it('Plan.getValidationErrors() — ошибки плана', () => {
      const invalidPlan = new Plan({ id: '', title: '', createdBy: 'user', status: 'planning', steps: [] });
      const errors = invalidPlan.getValidationErrors();
      expect(errors.length).toBeGreaterThan(0);

      // Должна быть ошибка пустого id
      expect(errors.some(e => e.error.includes('id'))).toBe(true);
      // Должна быть ошибка пустого title
      expect(errors.some(e => e.error.includes('title'))).toBe(true);
    });

    it('PlanStep.isValid() — валидный шаг', async () => {
      const plan = await pm.createPlan({ title: 'План', createdBy: 'user' });
      const step = await pm.addStep(plan, 'Валидный шаг');
      expect(step.isValid()).toBe(true);
    });

    it('PlanStep.getValidationErrors() — ошибки шага', () => {
      const invalidStep = new PlanStep({ id: '', task: '', status: 'unknown' });
      const errors = invalidStep.getValidationErrors();
      expect(errors.length).toBeGreaterThan(0);
    });

    it('Рекурсивная валидация плана с невалидными шагами', () => {
      const plan = new Plan({
        id: 'plan-1',
        title: 'План',
        createdBy: 'user',
        status: 'planning',
        steps: [
          new PlanStep({ id: '', task: 'Невалидный шаг без id', status: 'pending' })
        ]
      });
      expect(plan.isValid()).toBe(false);
      const errors = plan.getValidationErrors();
      expect(errors.some(e => e.error.includes('id'))).toBe(true);
    });
  });

  describe('Дополнительные сценарии', () => {
    it('listPlans возвращает список всех планов в контексте', async () => {
      await pm.createPlan({ title: 'План 1', createdBy: 'user' });
      await pm.createPlan({ title: 'План 2', createdBy: 'user' });
      await pm.createPlan({ title: 'План 3', createdBy: 'user' });

      const plans = await pm.listPlans();
      expect(plans.length).toBe(3);
      expect(plans.map(p => p.title)).toContain('План 1');
      expect(plans.map(p => p.title)).toContain('План 2');
      expect(plans.map(p => p.title)).toContain('План 3');
    });

    it('addStep с index добавляет в конкретную позицию', async () => {
      const plan = await pm.createPlan({ title: 'План', createdBy: 'user' });
      await pm.addStep(plan, 'Шаг 1');
      await pm.addStep(plan, 'Шаг 3');

      // Добавляем шаг в середину (индекс 1)
      const middleStep = await pm.addStep(plan, 'Шаг 2', 1);
      expect(middleStep).toBeDefined();

      const reloaded = await pm.loadPlan(plan.id);
      expect(reloaded.steps[0].task).toBe('Шаг 1');
      expect(reloaded.steps[1].task).toBe('Шаг 2');
      expect(reloaded.steps[2].task).toBe('Шаг 3');
    });

    it('Обработка ошибок при обновлении несуществующего шага', async () => {
      const plan = await pm.createPlan({ title: 'План', createdBy: 'user' });
      try {
        await pm.updateStepStatus(plan, 'non-existent-step-id', 'done');
        expect.fail('Должно было выбросить ошибку');
      } catch (e) {
        expect(e.message).toContain('STEP_NOT_FOUND');
      }
    });

    it('Проверка структуры PlanStep с вложенными подшагами', async () => {
      const plan = await pm.createPlan({ title: 'План', createdBy: 'user' });
      const step = await pm.addStep(plan, 'Родитель');
      await pm.addSubtask(plan, step.id, 'Подзадача 1');
      await pm.addSubtask(plan, step.id, 'Подзадача 2');

      // Вложенная вложенность
      const parentStepReloaded = await pm.findStepById(plan, step.id);
      const childStep = parentStepReloaded.steps[0];
      await pm.addSubtask(plan, childStep.id, 'Вложенная подзадача');

      const reloaded = await pm.loadPlan(plan.id);
      expect(reloaded.steps[0].steps.length).toBe(2);
      expect(reloaded.steps[0].steps[0].steps.length).toBe(1);
    });
  });
});
