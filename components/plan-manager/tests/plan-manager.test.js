/**
 * Unit-тесты для PlanManager.
 * Покрывают все сценарии из спецификации docs/plan-manager-spec.md.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import pm from '../src/planmanager.js';
import { Plan } from '../src/plan.js';
import { PlanStep } from '../src/planstep.js';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import fs from 'fs';
import { existsSync } from 'fs';
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

let testCtxId = null;
let planManager = null;

describe('Фикс багов рефактора', () => {
  let planManager = null;

  beforeEach(async () => {
    // Use the singleton like other tests do
    planManager = pm;
  });

  it('Баг #2: шаги встроенного подплана должны учитываться в прогрессе верхнего плана', async () => {
    const ctxId = `fix-test-${Date.now()}`;
    // Создаём родительский план с одним шагом
    const parentPlan = await planManager.createPlan(ctxId, { title: 'Parent', createdBy: 'test' });
    const step1 = await parentPlan.addStep('Основной шаг');

    // Создаём и встраиваем подплан в этот шаг
    const subplan = await planManager.createPlan(ctxId, { title: 'Sub', createdBy: 'test' });
    await parentPlan.setPlan(step1.id, subplan);

    // Добавляем шаги во встроенный подплан
    const subStep1 = await subplan.addStep('Подшаг 1');
    const subStep2 = await subplan.addStep('Подшаг 2');

    // Прогресс должен учитывать все шаги: 1 основной + 2 подшага = 3 всего
    const reloadedParent = await planManager.loadPlan(ctxId, parentPlan.id);
    const progress = await reloadedParent.getOverallProgress();
    expect(progress.total).toBe(3); // Основной шаг + 2 шага подплана
    expect(progress.done).toBe(0);
  });

  it('Баг #3: update_plan_step должен работать на шагах внутри встроенного подплана', async () => {
    const ctxId = `fix-test-${Date.now()}`;
    // Создаём родительский план с одним шагом
    const parentPlan = await planManager.createPlan(ctxId, { title: 'Parent', createdBy: 'test' });
    const step1 = await parentPlan.addStep('Основной шаг');

    // Создаём и встраиваем подплан
    const subplan = await planManager.createPlan(ctxId, { title: 'Sub', createdBy: 'test' });
    await parentPlan.setPlan(step1.id, subplan);

    // Добавляем шаг во встроенный подплан
    const subStep = await subplan.addStep('Подшаг для обновления');
    console.log('Created substep:', subStep.id, 'status:', subStep.status);

    // Обновляем статус шага через родительский план (findStepById должен найти его во вложенном плане)
    let found = await parentPlan.findStepById(subStep.id);
    expect(found).not.toBeNull();
    console.log('Found step in parent plan?', !!found, 'status:', found.status);

    // Обновляем статус через родительский план
    await parentPlan.setStepStatus(subStep.id, 'done');
    console.log('After update via parent, found step status:', found.status);
    expect(found.status).toBe('done');
  });
});

describe('PlanManager', () => {
  let ctxDir;

  beforeEach(async () => {
    ctxDir = await mkdtemp(join(tmpdir(), 'plan-manager-test-'));
    testCtxId = `test-${Date.now()}`;
    // Создаём директорию для планов с нужной структурой
    const plansDir = join('contexts', testCtxId, 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    planManager = pm;
  });

  describe('Основные операции', () => {
    it('1. Создание нового плана и проверка сохранения на диск', async () => {
      const plan = await planManager.createPlan(testCtxId, {
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
      const loaded = await planManager.loadPlan(testCtxId, plan.id);
      expect(loaded).not.toBeNull();
      expect(loaded.title).toBe('Тестовый план');
    });

    it('2. Загрузка существующего плана по ID', async () => {
      const plan = await planManager.createPlan(testCtxId, {
        title: 'План для загрузки',
        createdBy: 'user-1'
      });

      const loaded = await planManager.loadPlan(testCtxId, plan.id);
      expect(loaded).not.toBeNull();
      expect(loaded.id).toBe(plan.id);
      expect(loaded.title).toBe('План для загрузки');
    });

    it('Загрузка несуществующего плана возвращает null', async () => {
      const loaded = await planManager.loadPlan(testCtxId, 'non-existent-id');
      expect(loaded).toBeNull();
    });

    it('3. Обновление статуса шага (pending → in_progress → done)', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'План для статусов', createdBy: 'user' });
      const step = await plan.addStep('Задача 1');

      expect(step.status).toBe('pending');

      await plan.setStepStatus(step.id, 'in_progress');
      const reloaded = await planManager.loadPlan(testCtxId, plan.id);
      expect((await reloaded.findStepById(step.id)).status).toBe('in_progress');

      await reloaded.setStepStatus(step.id, 'done');
      const reloaded2 = await planManager.loadPlan(testCtxId, plan.id);
      expect((await reloaded2.findStepById(step.id)).status).toBe('done');
    });

    it('4. Добавление подзадачи к существующему шагу', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'План с подзадачами', createdBy: 'user' });
      const parentStep = await plan.addStep('Родительская задача');

      const subtask = await plan.addSubStep(parentStep.id, 'Подзадача 1');
      expect(subtask).toBeDefined();
      expect(subtask.task).toBe('Подзадача 1');
      expect(subtask.status).toBe('pending');

      // Проверка вложенности
      const reloaded = await planManager.loadPlan(testCtxId, plan.id);
      const parentReloaded = await reloaded.findStepById(parentStep.id);
      const steps = await parentReloaded.steps();
      expect(steps.length).toBe(1);
      expect(steps[0].task).toBe('Подзадача 1');
    });

    it('5. Удаление шага с вложенными подзадачами', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'План для удаления', createdBy: 'user' });
      const step = await plan.addStep('Шаг для удаления');
      await plan.addSubStep(step.id, 'Подзадача 1');
      await plan.addSubStep(step.id, 'Подзадача 2');

      // Проверка что подзадачи существуют
      const before = await planManager.loadPlan(testCtxId, plan.id);
      const stepBefore = await before.findStepById(step.id);
      const subSteps = await stepBefore.steps();
      expect(subSteps.length).toBe(2);

      // Удаление шага
      await before.removeStep(step.id);

      // Проверка что шаг удален вместе с подзадачами
      const after = await planManager.loadPlan(testCtxId, plan.id);
      const stepAfter = await after.findStepById(step.id);
      expect(stepAfter).toBeNull();
    });
  });

  describe('Работа с файлами планов', () => {
    it('6. Привязка файла задания к шагу (taskFiles)', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'План с файлами', createdBy: 'user' });
      const step = await plan.addStep('Задача');

      await plan.attachTaskFile(step.id, 'tasks/auth-routes.md');

      const reloaded = await planManager.loadPlan(testCtxId, plan.id);
      const stepReloaded = await reloaded.findStepById(step.id);
      expect(stepReloaded.taskFiles.length).toBe(1);
      expect(stepReloaded.taskFiles[0].file).toBe('tasks/auth-routes.md');
      expect(stepReloaded.taskFiles[0].timestamp).toBeDefined();
    });

    it('7. Привязка файла результата к шагу (resultsFiles)', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'План с результатами', createdBy: 'user' });
      const step = await plan.addStep('Задача');

      await plan.attachResultFile(step.id, 'results/auth-done.md');

      const reloaded = await planManager.loadPlan(testCtxId, plan.id);
      const stepReloaded = await reloaded.findStepById(step.id);
      expect(stepReloaded.resultsFiles.length).toBe(1);
      expect(stepReloaded.resultsFiles[0].file).toBe('results/auth-done.md');
    });

    it('8. Встраивание подплана через поле planFile', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной план', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг с подпланом');

      // Создаем детальный подплан
      const subplan = await planManager.createPlan(testCtxId, { title: 'Детальный подплан', createdBy: 'user' });
      await subplan.addStep('Подшаг 1');
      await subplan.addStep('Подшаг 2');

      // Встраиваем через объект плана (перегрузка 2)
      await mainPlan.setPlan(step.id, subplan);

      const reloaded = await planManager.loadPlan(testCtxId, mainPlan.id);
      const stepReloaded = await reloaded.findStepById(step.id);
      expect(stepReloaded.planFile).toContain(subplan.id);
    });
  });

  describe('Рекурсивные операции', () => {
    it('9. Поиск шага в вложенном подплане по ID', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг с подпланом');

      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const substep1 = await subplan.addStep('Подшаг 1');
      const substep2 = await subplan.addStep('Подшаг 2');

      // Встраиваем подплан
      await mainPlan.setPlan(step.id, subplan);

      // Перезагружаем и ищем шаг из подплана
      const reloadedMain = await planManager.loadPlan(testCtxId, mainPlan.id);
      const foundStep = await reloadedMain.findStepById(substep1.id);
      expect(foundStep).not.toBeNull();
      expect(foundStep.task).toBe('Подшаг 1');

      const foundStep2 = await reloadedMain.findStepById(substep2.id);
      expect(foundStep2).not.toBeNull();
    });

    it('10. Получение общего прогресса с учетом вложенных планов', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'План для прогресса', createdBy: 'user' });
      const step1 = await mainPlan.addStep('Шаг 1');
      const step2 = await mainPlan.addStep('Шаг 2');

      // Завершаем один шаг
      await mainPlan.setStepStatus(step1.id, 'done');

      // Создаем и встраиваем подплан
      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const substep1 = await subplan.addStep('Подшаг 1');
      const substep2 = await subplan.addStep('Подшаг 2');

      // Завершаем один подшаг
      await subplan.setStepStatus(substep1.id, 'done');

      await mainPlan.setPlan(step1.id, subplan);

      // Перезагружаем и проверяем прогресс
      const reloaded = await planManager.loadPlan(testCtxId, mainPlan.id);
      const progress = await reloaded.getOverallProgress();

      expect(progress.total).toBe(4); // 2 шага + 2 подшага
      expect(progress.done).toBe(2);  // шаг1 + подшаг1
      expect(progress.percent).toBe(50);
    });

    it('11. Обновление статуса шага во вложенном плане', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг');

      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const substep = await subplan.addStep('Подшаг для обновления');

      await mainPlan.setPlan(step.id, subplan);

      // Обновляем статус подшага
      await subplan.setStepStatus(substep.id, 'in_progress');

      // Перезагружаем и проверяем
      const reloadedSub = await planManager.loadPlan(testCtxId, subplan.id);
      expect(reloadedSub.steps[0].status).toBe('in_progress');
    });

    it('12. Обновление описания задачи шага', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'План для обновления task', createdBy: 'user' });
      const step = await plan.addStep('Исходное описание');

      expect(step.task).toBe('Исходное описание');

      // Обновляем описание задачи
      await plan.setStepTask(step.id, 'Новое описание');

      // Перезагружаем и проверяем что изменение сохранилось
      const reloaded = await planManager.loadPlan(testCtxId, plan.id);
      const loadedStep = await reloaded.findStepById(step.id);
      expect(loadedStep.task).toBe('Новое описание');
    });

    it('13. Обновление описания задачи шага во встроенном подплане', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг с подпланом');

      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const substep = await subplan.addStep('Исходное описание подшага');

      await mainPlan.setPlan(step.id, subplan);

      // Обновляем описание задачи шага во встроенном подплане через родительский план
      await mainPlan.setStepTask(substep.id, 'Обновлённое описание подшага');

      // Перезагружаем и проверяем
      const reloadedMain = await planManager.loadPlan(testCtxId, mainPlan.id);
      const loadedSubstep = await reloadedMain.findStepById(substep.id);
      expect(loadedSubstep.task).toBe('Обновлённое описание подшага');
    });
  });

  describe('Интеграция с context-store', () => {
    it('12. Установка активного плана для контекста', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'Активный план', createdBy: 'user' });

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
      const plan = await planManager.createPlan(testCtxId, { title: 'План для загрузки как активный', createdBy: 'user' });

      // Устанавливаем активный план через внешний ContextStore
      const store = new ContextStore(ctxDir);
      await store.setActivePlanId(plan.id);

      // Загружаем ID активного плана и затем сам план
      const activePlanId = await store.getActivePlanId();
      const loaded = await planManager.loadPlan(testCtxId, activePlanId);

      expect(loaded).not.toBeNull();
      expect(loaded.id).toBe(plan.id);
      expect(loaded.title).toBe('План для загрузки как активный');
    });
  });

  describe('Валидация', () => {
    it('Plan.isValid() — валидный план', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'Валидный план', createdBy: 'user' });
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
      const plan = await planManager.createPlan(testCtxId, { title: 'План', createdBy: 'user' });
      const step = await plan.addStep('Валидный шаг');
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
    it('addStep с index добавляет в конкретную позицию', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'План', createdBy: 'user' });
      await plan.addStep('Шаг 1');
      await plan.addStep('Шаг 3');

      // Добавляем шаг в середину (индекс 1)
      const middleStep = await plan.addStep('Шаг 2', 1);
      expect(middleStep).toBeDefined();

      const reloaded = await planManager.loadPlan(testCtxId, plan.id);
      expect(reloaded.steps[0].task).toBe('Шаг 1');
      expect(reloaded.steps[1].task).toBe('Шаг 2');
      expect(reloaded.steps[2].task).toBe('Шаг 3');
    });

    it('Обработка ошибок при обновлении несуществующего шага', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'План', createdBy: 'user' });
      try {
        await plan.setStepStatus('non-existent-step-id', 'done');
        expect.fail('Должно было выбросить ошибку');
      } catch (e) {
        expect(e.message).toContain('STEP_NOT_FOUND');
      }
    });

    it('Проверка структуры PlanStep с вложенными подшагами', async () => {
      const plan = await planManager.createPlan(testCtxId, { title: 'План', createdBy: 'user' });
      const step = await plan.addStep('Родитель');
      await plan.addSubStep(step.id, 'Подзадача 1');
      await plan.addSubStep(step.id, 'Подзадача 2');

      // Вложенная вложенность
      const parentStepReloaded = await plan.findStepById(step.id);
      const childSteps = await parentStepReloaded.steps();
      const childStep = childSteps[0];
      await plan.addSubStep(childStep.id, 'Вложенная подзадача');

      const reloaded = await planManager.loadPlan(testCtxId, plan.id);
      const topSteps = reloaded.steps;
      const step0Steps = await topSteps[0].steps();
      expect(step0Steps.length).toBe(2);
      const step0step0Steps = await step0Steps[0].steps();
      expect(step0step0Steps.length).toBe(1);
    });

    it('Кэширование подпланов в PlanStep.plan', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг с подпланом');

      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const substep = await subplan.addStep('Подшаг');

      // Встраиваем подплан
      await mainPlan.setPlan(step.id, subplan);

      // Перезагружаем основной план — должен кэшировать подплан в step.plan
      const reloadedMain = await planManager.loadPlan(testCtxId, mainPlan.id);
      const cachedStep = reloadedMain.steps[0];
      expect(cachedStep.plan).not.toBeNull();
      const cachedPlan = await cachedStep.plan();
      expect(cachedPlan.title).toBe('Подплан');

      // findStepById должен использовать кэш, не читая с диска
      const found = await reloadedMain.findStepById(substep.id);
      expect(found).not.toBeNull();
      expect(found.task).toBe('Подшаг');
    });

    it('Встроенный подплан НЕ сериализуется в файл основного плана', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг с подпланом');

      // Создаем и заполняем подплан
      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const substep1 = await subplan.addStep('Подшаг 1');
      const substep2 = await subplan.addStep('Подшаг 2');

      // Встраиваем подплан
      await mainPlan.setPlan(step.id, subplan);

      // Читаем файл основного плана напрямую и проверяем, что нет сериализованного объекта plan
      const mainPlanPath = join('contexts', testCtxId, 'plans', `${mainPlan.id}.json`);
      const fileContent = await readFile(mainPlanPath, 'utf-8');
      const rawJson = JSON.parse(fileContent);

      // В файле должно быть только поле planFile (ссылка), а не весь объект подплана
      expect(rawJson.steps[0].planFile).toContain(subplan.id);
      expect(rawJson.steps[0].plan).toBeUndefined();
    });

    it('При загрузке плана встроенный подплан загружается в память (step.plan)', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг с подпланом');

      // Создаем и заполняем подплан
      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const substep1 = await subplan.addStep('Подшаг 1');
      const substep2 = await subplan.addStep('Подшаг 2');

      // Встраиваем подплан
      await mainPlan.setPlan(step.id, subplan);

      // Загружаем план обратно — в памяти должен быть объект подплана
      const loadedMain = await planManager.loadPlan(testCtxId, mainPlan.id);
      expect(loadedMain.steps[0].plan).not.toBeNull();
      const loadedMainSteps = loadedMain.steps;
      const loadedSubPlan = await loadedMainSteps[0].plan();
      expect(loadedSubPlan.title).toBe('Подплан');
      const mainSteps = loadedMain.steps;
      const stepPlan = await mainSteps[0].plan();
      expect(stepPlan.steps.length).toBe(2);

      // Шаги подплана доступны через API
      const foundSubstep = await loadedMain.findStepById(substep1.id);
      expect(foundSubstep).not.toBeNull();
      expect(foundSubstep.task).toBe('Подшаг 1');
    });

    it('add_step с planId добавляет шаг в дочерний план', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг с подпланом');

      // Создаем и заполняем подплан
      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const existingSubstep = await subplan.addStep('Существующий подшаг');

      // Встраиваем подплан
      await mainPlan.setPlan(step.id, subplan);

      // Добавляем новый шаг в дочерний план через add_step с planId
      const newStep = await subplan.addStep('Новый подшаг через planId');
      expect(newStep).toBeDefined();
      expect(newStep.task).toBe('Новый подшаг через planId');

      // Проверяем что шаг добавлен в дочерний план
      const reloadedSub = await planManager.loadPlan(testCtxId, subplan.id);
      expect(reloadedSub.steps.length).toBe(2);
      expect(reloadedSub.steps[1].task).toBe('Новый подшаг через planId');
    });

    it('Загрузка плана с изменениями не сериализует объекты подпланов обратно в файл', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг с подпланом');

      // Создаем и заполняем подплан
      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const substep1 = await subplan.addStep('Подшаг 1');

      // Встраиваем подплан
      await mainPlan.setPlan(step.id, subplan);

      // Загружаем план (подпланы кэшируются в памяти)
      const loadedMain = await planManager.loadPlan(testCtxId, mainPlan.id);
      expect(loadedMain.steps[0].plan).not.toBeNull();

      // Обновляем статус шага и сохраняем план
      await loadedMain.setStepStatus(step.id, 'in_progress');

      // Читаем файл основного плана — не должно быть сериализованного объекта подплана
      const mainPlanPath = join('contexts', testCtxId, 'plans', `${mainPlan.id}.json`);
      const fileContent = await readFile(mainPlanPath, 'utf-8');
      const rawJson = JSON.parse(fileContent);

      expect(rawJson.steps[0].planFile).toContain(subplan.id);
      expect(rawJson.steps[0].plan).toBeUndefined();
    });

    it('После add_step в дочерний план, основной план не содержит сериализованный объект подплана', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг с подпланом');

      // Создаем и заполняем подплан
      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const existingSubstep = await subplan.addStep('Существующий подшаг');

      // Встраиваем подплан
      await mainPlan.setPlan(step.id, subplan);

      // Добавляем шаг в дочерний план
      const newStep = await subplan.addStep('Новый подшаг через planId');

      // Читаем файл основного плана и проверяем что нет сериализованного объекта подплана
      const mainPlanPath = join('contexts', testCtxId, 'plans', `${mainPlan.id}.json`);
      const fileContent = await readFile(mainPlanPath, 'utf-8');
      const rawJson = JSON.parse(fileContent);

      // В файле должно быть только поле planFile (ссылка), а не весь объект подплана
      expect(rawJson.steps[0].planFile).toContain(subplan.id);
      expect(rawJson.steps[0].plan).toBeUndefined();
    });

    it('Удаление шага с встроенным подпланом сохраняет файл для истории', async () => {
      // Создаём основной план
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Main Plan', createdBy: 'user' });
      const stepWithSubplan = await mainPlan.addStep('Шаг с подпланом');

      // Создаём и встраиваем подплан
      const subplan = await planManager.createPlan(testCtxId, { title: 'Subplan', createdBy: 'user' });
      await subplan.addStep('Подшаг 1');
      await mainPlan.setPlan(stepWithSubplan.id, subplan);
      // Даем время на завершение асинхронных операций с файлами
      await new Promise(r => setTimeout(r, 50));

      // Проверяем что файл подплана существует
      const subplanFilePath = join('contexts', testCtxId, 'plans', `${subplan.id}.json`);
      expect(existsSync(subplanFilePath)).toBe(true);

      // Удаляем шаг с встроенным подпланом
      await mainPlan.removeStep(stepWithSubplan.id);

      // Файл подплана должен остаться для истории (orphan-файл)
      expect(existsSync(subplanFilePath)).toBe(true);
    });

    it('add_subtask к шагу с подпланом не создаёт split-brain (прогресс корректный)', async () => {
      // Создаём основной план
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Main Plan', createdBy: 'user' });
      const step1 = await mainPlan.addStep('Шаг без подплана');
      const stepWithSubplan = await mainPlan.addStep('Шаг с подпланом');

      // Создаём и встраиваем подплан
      const subplan = await planManager.createPlan(testCtxId, { title: 'Subplan', createdBy: 'user' });
      const substep1 = await subplan.addStep('Подшаг 1');
      await mainPlan.setPlan(stepWithSubplan.id, subplan);

      // Добавляем subtask к шагу С подпланом (должен попасть в дочерний план)
      const addedToSubplan = await mainPlan.addSubStep(stepWithSubplan.id, 'Новый подшаг через add_substep');
      expect(addedToSubplan).toBeDefined();

      // Добавляем subtask к шагу БЕЗ подплана (должен быть inline)
      const addedInline = await mainPlan.addSubStep(step1.id, 'Inline подзадача');
      expect(addedInline).toBeDefined();

      // Проверяем что оба subtask корректно добавлены и видимы через get_plan_status
      const status = await mainPlan.getOverallProgress();

      // Ожидаемый итог: 2 шага основного плана + 1 inline подзадача + 2 подшага в подплане (исходный + добавленный через add_subtask) = 5 всего
      expect(status.total).toBe(5);
      expect(status.done).toBe(0); // Ничего не завершено
    });

    it('Кеширование: два процесса получают один и тот же объект плана', async () => {
      // Создаём план
      const plan = await planManager.createPlan(testCtxId, { title: 'Test Caching', createdBy: 'user' });
      const step1 = await plan.addStep('Step 1');

      // Процесс A загружает план из кэша
      const planA = await planManager.loadPlan(testCtxId, plan.id);

      // Процесс B тоже получает тот же объект из кэша
      const planB = await planManager.loadPlan(testCtxId, plan.id);

      // Оба процесса получили один и тот же объект
      expect(planA).toBe(planB);

      // Изменения в одном видны в другом (через кэш)
      planA.title = 'Modified by A';
      expect(planB.title).toBe('Modified by A');
    });

    it('resetCache сбрасывает кэш вложенных планов', async () => {
      const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
      const step = await mainPlan.addStep('Шаг с подпланом');

      const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
      const substep = await subplan.addStep('Подшаг');

      // Встраиваем подплан
      await mainPlan.setPlan(step.id, subplan);
      // Даем время на завершение асинхронных операций с файлами
      await new Promise(r => setTimeout(r, 50));

      // Перезагружаем основной план — кэшируется
      const reloadedMain = await planManager.loadPlan(testCtxId, mainPlan.id);
      const cachedPlan = await reloadedMain.steps[0].plan();
      expect(cachedPlan).not.toBeNull();

      // Сбрасываем кэш
      reloadedMain.resetCache();
      expect(reloadedMain.steps[0]._plan).toBeNull();

      // findStepById должен перечитать с диска (ленивая загрузка)
      const found = await reloadedMain.findStepById(substep.id);
      expect(found).not.toBeNull();
      expect(found.task).toBe('Подшаг');
    });

    describe('addPlan', () => {
      it('Добавление плана без индекса (в конец)', async () => {
        const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
        await mainPlan.addStep('Шаг 1');

        const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
        await subplan.addStep('Подшаг 1');

        const step = await mainPlan.addPlan(subplan);

        expect(step).toBeDefined();
        expect(step.task).toBe('Подплан');
        expect(step.planFile).toContain(`${subplan.id}.json`);
        expect(mainPlan.steps.length).toBe(2);
        expect(mainPlan.steps[1].id).toBe(step.id);
      });

      it('Добавление плана с индексом', async () => {
        const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });
        await mainPlan.addStep('Шаг 1');
        await mainPlan.addStep('Шаг 3');

        const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
        const step = await mainPlan.addPlan(subplan, 1);

        expect(mainPlan.steps.length).toBe(3);
        expect(mainPlan.steps[0].task).toBe('Шаг 1');
        expect(mainPlan.steps[1].id).toBe(step.id);
        expect(mainPlan.steps[2].task).toBe('Шаг 3');
      });

      it('Подплан сохраняется в файл и присваивается step._plan', async () => {
        const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });

        const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
        await subplan.addStep('Подшаг');

        const step = await mainPlan.addPlan(subplan);

        // Проверка что файл подплана существует
        expect(fs.existsSync(step.planFile)).toBe(true);

        // Проверка что step._plan присвоен (объект плана в памяти)
        expect(step._plan).toBeDefined();
        expect(step._plan.title).toBe('Подплан');
      });

      it('Сериализация после addPlan', async () => {
        const mainPlan = await planManager.createPlan(testCtxId, { title: 'Основной', createdBy: 'user' });

        const subplan = await planManager.createPlan(testCtxId, { title: 'Подплан', createdBy: 'user' });
        await subplan.addStep('Подшаг');

        await mainPlan.addPlan(subplan);

        // Перезагружаем план из файла
        const reloaded = await planManager.loadPlan(testCtxId, mainPlan.id);
        expect(reloaded.steps.length).toBe(1);

        // Проверка что planFile сохранён в сериализованном виде
        expect(reloaded.steps[0].planFile).toContain(`${subplan.id}.json`);

        // Ленивая загрузка подплана через step.plan()
        const loadedSubPlan = await reloaded.steps[0].plan();
        expect(loadedSubPlan.title).toBe('Подплан');
      });
    });
  });
});
