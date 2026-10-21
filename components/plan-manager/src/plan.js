/**
 * Plan — план с шагами.
 * Управляет своим состоянием, включает атомарное сохранение на диск
 * и методы работы со всеми шагами (включая вложенные подпланы).
 */

import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import fs from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PlanStep } from './planstep.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Типы статусов (JSDoc)
/** @typedef {'planning'|'approved'|'executing'|'completed'|'archived'} PlanStatus */

// Map<planId, Promise> для отслеживания блокировок по каждому плану отдельно.
const planLocks = new Map();

async function acquirePlanLock(planId) {
  while (planLocks.has(planId)) {
    await new Promise(resolve => setTimeout(resolve, 5)); // Spin-wait
  }
  planLocks.set(planId, true);
}

function releasePlanLock(planId) {
  planLocks.delete(planId);
}

/**
 * Класс Plan — план с шагами.
 */
export class Plan {
  /**
   * @param {object} data
   * @param {string} data.id - UUID плана
   * @param {string} data.title - Название плана
   * @param {string} [data.description] - Описание цели и контекста
   * @param {string} data.createdBy - ID агента, создавшего план
   * @param {number} data.createdAt - Timestamp создания
   * @param {PlanStatus} data.status
   * @param {PlanStep[]} data.steps
   * @param {string} [data.filePath] - Путь к файлу на диске
   */
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    this.description = data.description;
    this.createdBy = data.createdBy;
    this.createdAt = data.createdAt || Date.now();
    this.status = data.status || 'planning';
    this.steps = data.steps || [];
    this.filePath = data.filePath || null;
  }

  /**
   * Проверка валидности всего плана (рекурсивная).
   * @returns {boolean}
   */
  isValid() {
    const errors = this.getValidationErrors();
    return errors.length === 0;
  }

  /**
   * Получить список ошибок валидации плана.
   * @returns {Array<{stepId?: string, error: string}>}
   */
  getValidationErrors() {
    const errors = [];

    if (!this.id || typeof this.id !== 'string' || this.id.trim() === '') {
      errors.push({ error: 'Missing or empty plan id' });
    }
    if (!this.title || typeof this.title !== 'string' || this.title.trim() === '') {
      errors.push({ error: 'Missing or empty plan title' });
    }
    if (!this.createdBy || typeof this.createdBy !== 'string' || this.createdBy.trim() === '') {
      errors.push({ error: 'Missing or empty createdBy' });
    }
    if (typeof this.status !== 'string' || !['planning', 'approved', 'executing', 'completed', 'archived'].includes(this.status)) {
      errors.push({ error: `Invalid plan status: ${this.status}` });
    }

    // Валидация шагов
    for (const step of this.steps) {
      if (step && step.getValidationErrors) {
        errors.push(...step.getValidationErrors());
      } else {
        errors.push({ error: 'Invalid step structure in plan' });
      }
    }

    return errors;
  }

  /**
   * Сериализация в объект.
   */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      status: this.status,
      steps: this.steps.map(s => s.toJSON())
    };
  }

  detailed() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      status: this.status,
      steps: this.steps.map(s => s.detailed())
    };
  }

  /**
   * Атомарное сохранение плана на диск.
   * NOTE: Этот метод должен вызываться из контекста уже полученного lock,
   * поэтому здесь нет дополнительной блокировки.
   */
  async save() {
    if (!this.filePath) {
      throw new Error(`Cannot save plan ${this.id}: filePath is not set`);
    }

    const filePath = this.filePath;
    // Уникальный суффикс для временного файла, чтобы избежать конфликтов при параллельных операциях
    const uniqueSuffix = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const tempFilePath = `${filePath}.tmp-${uniqueSuffix}`;
    const backupFilePath = `${filePath}.prev`;

    // 1. Сериализация в JSON
    const content = JSON.stringify(this.toJSON(), null, 2);

    // 2. Запись во временный файл
    await writeFile(tempFilePath, content, 'utf-8');

    // 3. Проверка целостности — читаем обратно и парсим
    const verifyContent = await readFile(tempFilePath, 'utf-8');
    JSON.parse(verifyContent);

    // 4. Создание резервной копии текущего файла (если существует)
    if (fs.existsSync(filePath)) {
      try {
        if (fs.existsSync(backupFilePath)) {
          await unlink(backupFilePath);
        }
        await rename(filePath, backupFilePath);
      } catch (backupErr) {
        console.warn(`[plan] Failed to create backup for ${this.id}:`, backupErr);
      }
    }

    // 5. Атомарное переименование временного файла в основной
    await rename(tempFilePath, filePath);
  }

  /**
   * Добавить новый шаг к плану.
   * @param {string} task - Задача (строка)
   * @param {number} [index] - Позиция в массиве (по умолчанию в конец)
   * @returns {PlanStep}
   */
  async addStep(task, index) {
    await acquirePlanLock(this.id);
    try {

      const newStep = new PlanStep({ id: randomUUID(), task, status: 'pending' });
      newStep.parentPlan = this;

      if (index !== undefined && index >= 0 && index <= this.steps.length) {
        this.steps.splice(index, 0, newStep);
      } else {
        this.steps.push(newStep);
      }

      // Сохраняем изменения
      await this.save();

      return newStep;
    } finally {
      releasePlanLock(this.id);
    }
  }

  /**
   * Добавить подзадачу к существующему шагу.
   * @param {string} stepId - ID родительского шага
   * @param {string} task - Описание подзадачи
   * @param {number} [index] - Позиция в массиве (по умолчанию в конец)
   * @returns {PlanStep}
   */
  async addSubStep(stepId, task, index) {
    const step = await this.findStepById(stepId);
    if (!step) throw new Error(`STEP_NOT_FOUND: ${stepId}`);

    return await step.addStep(task, index);
  }

  /**
   * Встроить готовый план как шаг с сохранением в файл.
   * @param {Plan} plan - Объект плана для встраивания
   * @param {number} [index] - Позиция в массиве (по умолчанию в конец)
   * @returns {PlanStep}
   */
  async addPlan(plan, index) {
    await acquirePlanLock(this.id);
    try {
      // Сохраняем подплан в файл
      const planFile = join(this.plansDir, `${plan.id}.json`);

      // Создаём шаг для встроенного плана
      const newStep = new PlanStep({
        id: randomUUID(),
        task: plan.title,
        status: 'pending',
        planFile: planFile
      });
      newStep._plan = plan; // Кэшируем объект плана

      if (index !== undefined && index >= 0 && index <= this.steps.length) {
        this.steps.splice(index, 0, newStep);
      } else {
        this.steps.push(newStep);
      }

      await this.save();
      return newStep;
    } finally {
      releasePlanLock(this.id);
    }
  }

  /**
   * Обновить статус шага (рекурсивно для вложенных планов).
   * @param {string} stepId - ID шага
   * @param {string} status
   */
  async setStepStatus(stepId, status) {
    await acquirePlanLock(this.id);
    try {
      const step = await this.findStepById(stepId);
      if (!step) throw new Error(`STEP_NOT_FOUND: ${stepId}`);

      step.status = status;
      await step.save();

    } finally {
      releasePlanLock(this.id);
    }
  }

  /**
   * Обновить описание задачи шага (рекурсивно для вложенных планов).
   * @param {string} stepId - ID шага
   * @param {string} task - Новое описание задачи
   */
  async setStepTask(stepId, task) {
    await acquirePlanLock(this.id);
    try {
      const step = await this.findStepById(stepId);
      if (!step) throw new Error(`STEP_NOT_FOUND: ${stepId}`);

      step.task = task;
      await step.save();
      
    } finally {
      releasePlanLock(this.id);
    }
  }

  /**
   * Найти шаг по ID (включая вложенные подпланы).
   * @param {string} stepId
   * @returns {Promise<PlanStep|null>}
   */
  async findStepById(stepId) {
    for (const step of this.steps) {
      step.parentPlan = this;
      if (step.id === stepId) return step;
    }
    for (const step of this.steps) {
      const nested = await step.findStepById(stepId);
      if (nested) return nested;
    }
    return null;
  }

  /**
   * Удалить шаг и все его подзадачи.
   * @param {string} stepId - ID шага
   */
  async removeStep(stepId) {
    await acquirePlanLock(this.id);
    try {
      const idx = this.steps.findIndex(s => s.id === stepId);
      if (idx !== -1) {
        this.steps.splice(idx, 1);
        await this.save();
        return;
      }

      // Поиск в подшагах всех шагов
      for (const step of this.steps) {
        const removed = await step.removeStep(stepId);
        if (removed) {
          return;
        }
      }

      throw new Error(`STEP_NOT_FOUND: ${stepId}`);
    } finally {
      releasePlanLock(this.id);
    }
  }

  /**
   * Привязать файл задания к шагу.
   * @param {string} stepId - ID шага
   * @param {string} filePath - Путь к файлу задания
   */
  async attachTaskFile(stepId, filePath) {
    const step = await this.findStepById(stepId);
    if (!step) throw new Error(`STEP_NOT_FOUND: ${stepId}`);

    step.attachTaskFile(filePath);
    await this.save();
  }

  /**
   * Привязать файл результата к шагу.
   * @param {string} stepId - ID шага
   * @param {string} filePath - Путь к файлу результата
   */
  async attachResultFile(stepId, filePath) {
    const step = await this.findStepById(stepId);
    if (!step) throw new Error(`STEP_NOT_FOUND: ${stepId}`);

    step.attachResultFile(filePath);
    await this.save();
  }

  /**
   * Встроить подплан в шаг через поле planFile.
   * @param {string} stepId - ID шага
   * @param {string|Plan} subplanPathOrObject - Путь к файлу или объект плана
   */
  async setPlan(stepId, subplanPathOrObject) {
    await acquirePlanLock(this.id);
    try {
      const step = await this.findStepById(stepId);
      if (!step) throw new Error(`STEP_NOT_FOUND: ${stepId}`);

      if (typeof subplanPathOrObject === 'string') {
        // Перегрузка 1 — путь к файлу
        step.setPlanFile(subplanPathOrObject);
      } else if (subplanPathOrObject instanceof Plan) {
        step.setPlan(subplanPathOrObject);
      }

      // Сохраняем только ссылку на файл подплана, не кэшируем объект в памяти
      await this.save();
    } finally {
      releasePlanLock(this.id);
    }
  }

  /**
   * Получить общий прогресс выполнения плана (включая вложенные).
   * @returns {{done: number, total: number, percent: number}}
   */
  async getOverallProgress() {
    const total = await this.countSteps();
    const done = await this.countSteps('done');
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
  }

  /**
   * Сбросить кэш вложенных планов.
   */
  resetCache() {
    for (const step of this.steps) {
      step.resetCache();
    }
  }

  // --- Private helpers ---

  _deserializeStep(data) {
    const steps = (data.steps || []).map(s => this._deserializeStep(s));
    return new PlanStep({ ...data, steps });
  }

  get plansDir() {
    if (this.filePath) {
      return join(this.filePath, '..');
    }
    throw new Error('Plan filePath is not set');
  }

  /**
   * Подсчитать количество шагов с указанным статусом (включая вложенные).
   * Если status не указан — вернуть общее количество всех шагов.
   * @param {StepStatus} [status] - статус для фильтрации
   * @returns {Promise<number>} количество шагов
   */
  async countSteps(status) {
    let counter = 0;

    for (const step of this.steps) {
      counter += await step.countSteps(status);
    }

    return counter;
  }
}
