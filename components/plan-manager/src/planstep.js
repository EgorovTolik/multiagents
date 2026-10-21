/**
 * PlanStep — шаг плана с поддержкой вложенности.
 */

import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { Plan } from './plan.js';
const require = createRequire(import.meta.url);

// Типы статусов (JSDoc)
/** @typedef {'pending'|'in_progress'|'done'|'blocked'} StepStatus */

/**
 * Класс PlanStep — шаг плана с поддержкой вложенности.
 */
export class PlanStep {
  /**
   * @param {object} data
   * @param {string} data.id - UUID шага
   * @param {string} data.task - Описание задачи
   * @param {string} [data.file] - Путь к файлу с детальным описанием
   * @param {Array<{file: string, timestamp: number}>} [data.taskFiles]
   * @param {Array<{file: string, timestamp: number}>} [data.resultsFiles]
   * @param {string} [data.planFile] - Путь к вложенному подплану
   * @param {StepStatus} data.status
   * @param {PlanStep[]} [data.steps] - Вложенные подзадачи (inline)
   * @param {Plan} data.parentPlan
   */
  constructor(data) {
    this.id = data.id;
    this.task = data.task;
    this.file = data.file;
    this.taskFiles = data.taskFiles || [];
    this.resultsFiles = data.resultsFiles || [];
    this.planFile = data.planFile;
    this._plan = null; // тут хранится Plan загруженный из файла planFile
    this.status = data.status;
    this._steps = data.steps || [];
    this.parentPlan = null;
  }

  /**
   * Async-метод для получения всех шагов (inline или из встроенного подплана).
   */
  async steps() {
    let plan = await this.plan();
    return plan ? plan.steps : this._steps;
  }

  /**
   * Найти шаг по ID среди подшагов и встроенного подплана.
   * @param {string} stepId - ID шага для поиска
   * @returns {Promise<PlanStep|null>} Найденный шаг или null
   */
  async findStepById(stepId) {
    // Сначала проверяем inline steps
    for (const step of this._steps) {
      step.parentPlan = this.parentPlan;
      if (step.id === stepId) return step;
      const found = await step.findStepById(stepId);
      if (found) return found;
    }

    // Если есть embedded plan — ищем там
    let plan = await this.plan();
    if (plan) {
      try {
        const found = await plan.findStepById(stepId);
        if (found) return found;
      } catch (e) {
        // Шаг не найден в embedded plan
      }
    }

    return null;
  }

  /**
   * Добавить шаг. 
   * @param {string} [task] - Описание задачи
   * @param {number} [index] - Позиция в массиве (по умолчанию в конец)
   * @returns {Promise<PlanStep>} Добавленный шаг
   */
  async addStep(task, index) {

    // Сначала пытаемся добавить во встроенный подплан родителя
    const plan = await this.plan();
    if (plan) {
      return await plan.addStep(task, index);
    }

    const newStep = new PlanStep({ id: randomUUID(), task, status: 'pending' });
    newStep.parentPlan = this.parentPlan;

    if (!this._steps) this._steps = [];
    
    if (index !== undefined && index >= 0 && index <= this._steps.length) {
      this._steps.splice(index, 0, newStep);
    } else {
      this._steps.push(newStep);
    }

    if (!this.parentPlan) {
      await this.parentPlan.save();
    }

    return newStep;
  }

  /**
   * Удалить шаг по ID из inline steps, рекурсивных подшагов или встроенного подплана.
   * @param {string} stepId - ID шага для удаления
   * @returns {Promise<boolean>} true если шаг найден и удален, иначе false
   */
  async removeStep(stepId) {
    // Сначала проверяем inline steps
    const idx = this._steps.findIndex(s => s.id === stepId);
    if (idx !== -1) {
      this._steps.splice(idx, 1);
      this.save();
      return true;
    }

    // Рекурсивный поиск в inline подшагах
    for (const step of this._steps) {
      const removed = await step.removeStep(stepId);
      if (removed) return true;
    }

    // Если есть embedded plan — ищем там
    let plan = await this.plan();
    if (plan) {
      try {
        await plan.removeStep(stepId);
        return true;
      } catch (e) {
        // Шаг не найден в embedded plan
      }
    }

    return false;
  }

  async setPlanFile(path) {
    this.planFile = path;
    this._plan = null;
    this._steps = [];
    await this.save();
  }

  /**
   * @param {Plan} plan 
   */
  async setPlan(plan) {
    this.planFile = plan.filePath;
    this._plan = plan;
    await this.save();
  }

  /**
   * Сбросить кэш загруженного встроенного подплана.
   */
  resetCache() {
    if (this._plan) {
      this._plan.resetCache();
    }
    this._plan = null;
  }

  async plan() {
    if (!this._plan && this.planFile) {
      try {
        const pm = require('./planmanager.js').default;
        this._plan = await pm.loadPlanByFile(this.planFile);
      } catch (e) {
        console.error(`[step] Error loading embedded plan for step ${this.id}:`, e);
      }
    }
    return this._plan;
  }

  /**
   * Привязать файл задания к шагу.
   * @param {string} filePath - Путь к файлу задания
   */
  attachTaskFile(filePath) {
    if (!this.taskFiles) this.taskFiles = [];
    this.taskFiles.push({ file: filePath, timestamp: Date.now() });
  }

  /**
   * Привязать файл результата к шагу.
   * @param {string} filePath - Путь к файлу результата
   */
  attachResultFile(filePath) {
    if (!this.resultsFiles) this.resultsFiles = [];
    this.resultsFiles.push({ file: filePath, timestamp: Date.now() });
  }

  /**
   * Проверка валидности шага (рекурсивная для подшагов).
   * @returns {boolean}
   */
  isValid() {
    const errors = this.getValidationErrors();
    return errors.length === 0;
  }

  /**
   * Получить список ошибок валидации.
   * @returns {Array<{stepId: string, error: string}>}
   */
  getValidationErrors() {
    const errors = [];

    if (!this.id || typeof this.id !== 'string' || this.id.trim() === '') {
      errors.push({ stepId: this.id, error: 'Missing or empty id' });
    }
    if (!this.task || typeof this.task !== 'string' || this.task.trim() === '') {
      errors.push({ stepId: this.id, error: 'Missing or empty task description' });
    }
    if (typeof this.status !== 'string' || !['pending', 'in_progress', 'done', 'blocked'].includes(this.status)) {
      errors.push({ stepId: this.id, error: `Invalid status: ${this.status}` });
    }

    // Рекурсивная валидация подшагов
    // for (const sub of this._steps) {
    //   if (sub && sub.getValidationErrors) {
    //     errors.push(...sub.getValidationErrors());
    //   } else {
    //     errors.push({ stepId: this.id, error: `Invalid nested step structure in ${this.id}` });
    //   }
    // }

    return errors;
  }

  /**
   * Сериализация в объект.
   */
  toJSON() {
    return {
      id: this.id,
      task: this.task,
      file: this.file,
      taskFiles: this.taskFiles,
      resultsFiles: this.resultsFiles,
      planFile: this.planFile,
      status: this.status,
      steps: this._steps.map(s => s.toJSON())
    };
  }

  async detailed() {
    let plan = await this.plan();
    const subSteps = plan ? plan.steps : this._steps;
    return {
      id: this.id,
      task: this.task,
      file: this.file,
      taskFiles: this.taskFiles,
      resultsFiles: this.resultsFiles,
      status: this.status,
      steps: await Promise.all(subSteps.map(async s => s.detailed()))
    };
  }

  async save() {
    let plan = await this.plan();
    if (!plan) {
      plan.save();
    }

    if (!this.parentPlan) {
      this.parentPlan.save();
    }
  }

  hasPlan() {
    return !this._plan || !this.planFile;
  }
}
