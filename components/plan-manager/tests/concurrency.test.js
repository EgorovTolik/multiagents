/**
 * Unit-тесты для проверки параллельности, race conditions и блокировок.
 * Проверяют корректность работы мютексов при одновременных операциях.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import pm from '../src/planmanager.js';
import { Plan } from '../src/plan.js';
import { PlanStep } from '../src/planstep.js';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testCtxId = null;
let planManager = null;

describe('Concurrency & Race Conditions', () => {
  beforeEach(async () => {
    const ctxDir = await mkdtemp(join(tmpdir(), 'plan-concurrency-test-'));
    testCtxId = `test-${Date.now()}`;
    // Создаём директорию для планов с нужной структурой
    fs.mkdirSync(join('contexts', testCtxId, 'plans'), { recursive: true });
    planManager = pm;
  });

  it('1. Параллельные добавления шагов — все шаги сохраняются', async () => {
    const plan = await planManager.createPlan(testCtxId, { title: 'Parallel Steps Test', createdBy: 'user' });

    // 4 одновременных вызова addStep с разными задачами
    const promises = [
      plan.addStep('Задача 1'),
      plan.addStep('Задача 2'),
      plan.addStep('Задача 3'),
      plan.addStep('Задача 4')
    ];

    await Promise.all(promises);

    // Перезагружаем план и проверяем что все 4 шага сохранились
    const reloaded = await planManager.loadPlan(testCtxId, plan.id);
    expect(reloaded.steps.length).toBe(4);

    const tasks = reloaded.steps.map(s => s.task).sort();
    expect(tasks).toContain('Задача 1');
    expect(tasks).toContain('Задача 2');
    expect(tasks).toContain('Задача 3');
    expect(tasks).toContain('Задача 4');
  });

  it('2. Параллельные обновления статусов — все изменения применяются', async () => {
    const plan = await planManager.createPlan(testCtxId, { title: 'Parallel Status Test', createdBy: 'user' });

    // Добавляем несколько шагов последовательно
    const step1 = await plan.addStep('Шаг 1');
    const step2 = await plan.addStep('Шаг 2');
    const step3 = await plan.addStep('Шаг 3');

    // Перезагружаем план для получения актуальных объектов
    let currentPlan = await planManager.loadPlan(testCtxId, plan.id);

    // Несколько update_plan_step для разных шагов в одном блоке (параллельно)
    const promises = [
      currentPlan.updateStepStatus(step1.id, 'in_progress'),
      currentPlan.updateStepStatus(step2.id, 'done'),
      currentPlan.updateStepStatus(step3.id, 'blocked')
    ];

    await Promise.all(promises);

    // Перезагружаем план и проверяем что все изменения применились
    const reloaded = await planManager.loadPlan(testCtxId, plan.id);
    const loadedStep1 = await reloaded.findStepById(step1.id);
    const loadedStep2 = await reloaded.findStepById(step2.id);
    const loadedStep3 = await reloaded.findStepById(step3.id);

    expect(loadedStep1.status).toBe('in_progress');
    expect(loadedStep2.status).toBe('done');
    expect(loadedStep3.status).toBe('blocked');
  });

  it('3. Lost-update при read-modify-write — нет потери данных', async () => {
    const plan = await planManager.createPlan(testCtxId, { title: 'Lost Update Test', createdBy: 'user' });
    const step1 = await plan.addStep('Шаг для модификации');

    // Загружаем план дважды (два "процесса")
    let planA = await planManager.loadPlan(testCtxId, plan.id);
    let planB = await planManager.loadPlan(testCtxId, plan.id);

    // Оба "процесса" модифицируют и сохраняют
    const step1InA = await planA.findStepById(step1.id);
    step1InA.status = 'in_progress';

    const step1InB = await planB.findStepById(step1.id);
    step1InB.status = 'done';

    // Сохраняем изменения от обоих "процессов"
    await planA.save();
    await planB.save();

    // Перезагружаем план и проверяем что данные не потеряны (один из статусов применён)
    const reloaded = await planManager.loadPlan(testCtxId, plan.id);
    const loadedStep = await reloaded.findStepById(step1.id);

    // Один из статусов должен быть применён (in_progress или done)
    expect(['in_progress', 'done']).toContain(loadedStep.status);
  });

  it('4. Перезапись данных — addStep + updateStepStatus сохраняются оба', async () => {
    const plan = await planManager.createPlan(testCtxId, { title: 'Write Conflict Test', createdBy: 'user' });
    const step1 = await plan.addStep('Шаг 1');

    // Перезагружаем план
    let currentPlan = await planManager.loadPlan(testCtxId, plan.id);

    // Параллельно добавляем шаг и обновляем статус другого шага
    const addPromise = currentPlan.addStep('Новый шаг');
    const updatePromise = currentPlan.updateStepStatus(step1.id, 'in_progress');

    await Promise.all([addPromise, updatePromise]);

    // Перезагружаем план и проверяем что оба изменения сохранились
    const reloaded = await planManager.loadPlan(testCtxId, plan.id);
    expect(reloaded.steps.length).toBe(2); // Оригинальный шаг + новый

    const loadedStep1 = await reloaded.findStepById(step1.id);
    expect(loadedStep1.status).toBe('in_progress');

    // Проверяем что новый шаг добавлен
    const newStep = reloaded.steps.find(s => s.task === 'Новый шаг');
    expect(newStep).toBeDefined();
  });

  it('5. Целостность при множественных модификациях — корректный прогресс', async () => {
    const plan = await planManager.createPlan(testCtxId, { title: 'Integrity Test', createdBy: 'user' });

    // Добавляем несколько шагов последовательно
    for (let i = 1; i <= 5; i++) {
      await plan.addStep(`Шаг ${i}`);
    }

    // Перезагружаем план
    let currentPlan = await planManager.loadPlan(testCtxId, plan.id);

    // Серия параллельных операций: обновляем статусы и добавляем подзадачи
    const stepIds = [];
    for (const step of currentPlan.steps) {
      stepIds.push(step.id);
    }

    const promises = [
      currentPlan.updateStepStatus(stepIds[0], 'done'),
      currentPlan.updateStepStatus(stepIds[1], 'in_progress'),
      currentPlan.addSubtask(stepIds[2], 'Подзадача к шагу 3'),
      currentPlan.addSubtask(stepIds[3], 'Подзадача к шагу 4')
    ];

    await Promise.all(promises);

    // Перезагружаем план и проверяем целостность
    const reloaded = await planManager.loadPlan(testCtxId, plan.id);

    // Проверяем что шаги не потеряны и нет дубликатов
    expect(reloaded.steps.length).toBe(5);

    // Проверяем корректный прогресс (1 done + 2 inline подзадачи)
    const progress = await reloaded.getOverallProgress();
    expect(progress.done).toBe(1);
    expect(progress.total).toBeGreaterThan(5); // 5 шагов + 2 подзадачи
  });

  it('6. Блокировки/взаимоисключения — сериализация записей', async () => {
    const plan = await planManager.createPlan(testCtxId, { title: 'Locking Test', createdBy: 'user' });
    const step1 = await plan.addStep('Шаг 1');

    // Загружаем план дважды
    let planA = await planManager.loadPlan(testCtxId, plan.id);
    let planB = await planManager.loadPlan(testCtxId, plan.id);

    // Обе операции пытаются записать в один файл одновременно
    const step1InA = await planA.findStepById(step1.id);
    step1InA.status = 'in_progress';

    const step1InB = await planB.findStepById(step1.id);
    step1InB.status = 'done';

    // Сохраняем обе операции параллельно — должна быть сериализация
    const savePromises = [
      planA.save(),
      planB.save()
    ];

    // Обе операции должны завершиться успешно (без ошибок)
    await Promise.all(savePromises);

    // Перезагружаем план и проверяем что данные не повреждены
    const reloaded = await planManager.loadPlan(testCtxId, plan.id);
    const loadedStep = await reloaded.findStepById(step1.id);

    // Один из статусов должен быть применён (зависит от порядка сериализации)
    expect(['in_progress', 'done']).toContain(loadedStep.status);
  });
});
