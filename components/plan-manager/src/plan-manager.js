/**
 * PlanManager — модуль для управления файлами планов в системе multiagents.
 * Обеспечивает создание, загрузку, сохранение, модификацию и разрешение вложенных подпланов.
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

// Типы статусов (JSDoc)
/** @typedef {'pending'|'in_progress'|'done'|'blocked'} StepStatus */
/** @typedef {'planning'|'approved'|'executing'|'completed'|'archived'} PlanStatus */

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
   * @param {PlanStep[]} [data.steps] - Вложенные подзадачи
   */
  constructor(data) {
    this.id = data.id;
    this.task = data.task;
    this.file = data.file;
    this.taskFiles = data.taskFiles || [];
    this.resultsFiles = data.resultsFiles || [];
    this.planFile = data.planFile;
    this.status = data.status;
    this.steps = data.steps || [];
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
    for (const sub of this.steps) {
      if (sub && sub.getValidationErrors) {
        errors.push(...sub.getValidationErrors());
      } else {
        errors.push({ stepId: this.id, error: `Invalid nested step structure in ${this.id}` });
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
      task: this.task,
      file: this.file,
      taskFiles: this.taskFiles,
      resultsFiles: this.resultsFiles,
      planFile: this.planFile,
      status: this.status,
      steps: this.steps.map(s => s.toJSON())
    };
  }
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
   */
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    this.description = data.description;
    this.createdBy = data.createdBy;
    this.createdAt = data.createdAt || Date.now();
    this.status = data.status || 'planning';
    this.steps = data.steps || [];
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
}

/**
 * Класс PlanManager — основной API управления планами.
 */
export class PlanManager {
  /**
   * @param {object} options
   * @param {string} options.ctxDir - Путь к директории контекста
   */
  constructor(options) {
    this.ctxDir = options.ctxDir;
    this.plansDir = join(this.ctxDir, 'plans');
  }

  /**
   * Создать новый пустой план.
   * @param {object} params
   * @param {string} params.title - Название плана
   * @param {string} [params.description] - Описание цели и контекста
   * @param {string} params.createdBy - ID агента, создавшего план
   * @returns {Plan}
   */
  async createPlan({ title, description, createdBy }) {
    const planId = randomUUID();
    const plan = new Plan({
      id: planId,
      title,
      description,
      createdBy,
      status: 'planning',
      steps: []
    });

    await this.savePlan(plan);
    return plan;
  }

  /**
   * Загрузить план по ID.
   * @param {string} planId - ID плана
   * @returns {Plan|null}
   */
  async loadPlan(planId) {
    const filePath = join(this.plansDir, `${planId}.json`);
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Восстанавливаем PlanStep объекты из данных
      const steps = (data.steps || []).map(s => this._deserializeStep(s));
      const plan = new Plan({ ...data, steps });

      return plan;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  /**
   * Сохранить изменения в плане.
   * @param {Plan} plan
   */
  async savePlan(plan) {
    await mkdir(this.plansDir, { recursive: true });
    const filePath = join(this.plansDir, `${plan.id}.json`);
    const content = JSON.stringify(plan.toJSON(), null, 2);
    await writeFile(filePath, content, 'utf-8');
  }

  /**
   * Установить активный план для контекста (записать в context.json).
   * @param {string} ctxId - ID контекста
   * @param {string} planId - ID плана
   */
  async setActivePlan(ctxId, planId) {
    const ctxStore = new ContextStore(this.ctxDir);
    await ctxStore.setActivePlanId(planId);
  }

  /**
   * Получить активный план контекста.
   * @param {string} ctxId - ID контекста
   * @returns {Plan|null}
   */
  async getActivePlan(ctxId) {
    const ctxStore = new ContextStore(this.ctxDir);
    const planId = await ctxStore.getActivePlanId();
    if (!planId) return null;
    return this.loadPlan(planId);
  }

  /**
   * Список всех планов в контексте.
   * @returns {Array<{id: string, title: string, status: PlanStatus}>}
   */
  async listPlans() {
    try {
      const files = await readdir(this.plansDir);
      const plans = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const planId = file.slice(0, -5);
        const plan = await this.loadPlan(planId);
        if (plan) {
          plans.push({ id: plan.id, title: plan.title, status: plan.status });
        }
      }
      return plans;
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  /**
   * Обновить статус шага (рекурсивно для вложенных планов).
   * @param {Plan} plan
   * @param {string} stepId - ID шага
   * @param {StepStatus} status
   */
  async updateStepStatus(plan, stepId, status) {
    const step = await this.findStepById(plan, stepId);
    if (!step) throw new Error(`STEP_NOT_FOUND: ${stepId}`);

    step.status = status;
    await this.savePlan(plan);
  }

  /**
   * Найти шаг по ID (включая вложенные подпланы).
   * @param {Plan} plan
   * @param {string} stepId
   * @returns {PlanStep|null}
   */
  async findStepById(plan, stepId) {
    for (const step of plan.steps) {
      if (step.id === stepId) return step;

      // Поиск в подшагах
      const nested = this._findStepInSteps(step.steps, stepId);
      if (nested) return nested;

      // Поиск во вложенном плане через planFile
      if (step.planFile) {
        try {
          const subPlanId = this._extractPlanId(step.planFile);
          if (subPlanId) {
            const subPlan = await this.loadPlan(subPlanId);
            if (subPlan) {
              const found = await this.findStepById(subPlan, stepId);
              if (found) return found;
            }
          }
        } catch (e) {
          // Продолжаем поиск в других шагах
        }
      }
    }
    return null;
  }

  /**
   * Добавить новый шаг к родительскому шагу или плану.
   * @param {Plan|PlanStep} parent - План или родительский шаг
   * @param {string} task - Описание задачи нового шага
   * @param {number} [index] - Позиция в массиве (по умолчанию в конец)
   * @returns {PlanStep}
   */
  async addStep(parent, task, index) {
    const newStep = new PlanStep({
      id: randomUUID(),
      task,
      status: 'pending'
    });

    if (parent instanceof Plan) {
      if (index !== undefined && index >= 0 && index <= parent.steps.length) {
        parent.steps.splice(index, 0, newStep);
      } else {
        parent.steps.push(newStep);
      }
      await this.savePlan(parent);
    } else if (parent instanceof PlanStep) {
      if (!parent.steps) parent.steps = [];
      if (index !== undefined && index >= 0 && index <= parent.steps.length) {
        parent.steps.splice(index, 0, newStep);
      } else {
        parent.steps.push(newStep);
      }
    }

    return newStep;
  }

  /**
   * Добавить подзадачу к существующему шагу.
   * @param {Plan} plan
   * @param {string} parentStepId - ID родительского шага
   * @param {string} task - Описание подзадачи
   * @returns {PlanStep}
   */
  async addSubtask(plan, parentStepId, task) {
    const parentStep = await this.findStepById(plan, parentStepId);
    if (!parentStep) throw new Error(`STEP_NOT_FOUND: ${parentStepId}`);

    const newStep = await this.addStep(parentStep, task);
    await this.savePlan(plan);
    return newStep;
  }

  /**
   * Удалить шаг и все его подзадачи.
   * @param {Plan} plan
   * @param {string} stepId - ID шага
   */
  async removeStep(plan, stepId) {
    const idx = plan.steps.findIndex(s => s.id === stepId);
    if (idx !== -1) {
      plan.steps.splice(idx, 1);
      await this.savePlan(plan);
      return;
    }

    // Поиск в подшагах всех шагов
    for (const step of plan.steps) {
      const removed = this._removeStepFromSteps(step.steps, stepId);
      if (removed) {
        await this.savePlan(plan);
        return;
      }
    }

    // Поиск во вложенных планах
    for (const step of plan.steps) {
      if (step.planFile) {
        try {
          const subPlanId = this._extractPlanId(step.planFile);
          if (subPlanId) {
            const subPlan = await this.loadPlan(subPlanId);
            if (subPlan) {
              // Пытаемся удалить из подплана
              try {
                await this.removeStep(subPlan, stepId);
                return;
              } catch (e) {
                // Шаг не найден в этом подплане
              }
            }
          }
        } catch (e) {
          // Подплан не найден или ошибка
        }
      }
    }

    throw new Error(`STEP_NOT_FOUND: ${stepId}`);
  }

  /**
   * Привязать файл задания к шагу.
   * @param {Plan} plan
   * @param {string} stepId - ID шага
   * @param {string} filePath - Путь к файлу задания
   */
  async attachTaskFile(plan, stepId, filePath) {
    const step = await this.findStepById(plan, stepId);
    if (!step) throw new Error(`STEP_NOT_FOUND: ${stepId}`);

    if (!step.taskFiles) step.taskFiles = [];
    step.taskFiles.push({ file: filePath, timestamp: Date.now() });
    await this.savePlan(plan);
  }

  /**
   * Привязать файл результата к шагу.
   * @param {Plan} plan
   * @param {string} stepId - ID шага
   * @param {string} filePath - Путь к файлу результата
   */
  async attachResultFile(plan, stepId, filePath) {
    const step = await this.findStepById(plan, stepId);
    if (!step) throw new Error(`STEP_NOT_FOUND: ${stepId}`);

    if (!step.resultsFiles) step.resultsFiles = [];
    step.resultsFiles.push({ file: filePath, timestamp: Date.now() });
    await this.savePlan(plan);
  }

  /**
   * Встроить подплан в шаг через поле planFile.
   * @param {Plan} plan
   * @param {string} stepId - ID шага
   * @param {string|Plan} subplanPathOrObject - Путь к файлу или объект плана
   */
  async embedSubplan(plan, stepId, subplanPathOrObject) {
    const step = await this.findStepById(plan, stepId);
    if (!step) throw new Error(`STEP_NOT_FOUND: ${stepId}`);

    if (typeof subplanPathOrObject === 'string') {
      // Перегрузка 1 — путь к файлу
      step.planFile = subplanPathOrObject;
    } else if (subplanPathOrObject instanceof Plan) {
      // Перегрузка 2 — объект плана (гарантия валидности)
      await this.savePlan(subplanPathOrObject);
      step.planFile = join(this.plansDir, `${subplanPathOrObject.id}.json`);
    }

    await this.savePlan(plan);
  }

  /**
   * Рекурсивно загрузить все вложенные подпланы.
   * @param {Plan} plan
   * @returns {Array<Plan>} - Массив загруженных подпланов
   */
  async resolveNestedPlans(plan) {
    const resolved = [];
    const visited = new Set();

    const visitStep = async (step) => {
      if (!step.planFile || visited.has(step.planFile)) return;
      visited.add(step.planFile);

      try {
        const subPlanId = this._extractPlanId(step.planFile);
        if (subPlanId) {
          const subPlan = await this.loadPlan(subPlanId);
          if (subPlan) {
            resolved.push(subPlan);
            // Рекурсивно обрабатываем подпланы
            for (const subStep of subPlan.steps) {
              await visitStep(subStep);
            }
          }
        }
      } catch (e) {
        // Подплан не найден или ошибка загрузки — пропускаем
      }
    };

    for (const step of plan.steps) {
      await visitStep(step);
    }

    return resolved;
  }

  /**
   * Получить общий прогресс выполнения плана (включая вложенные).
   * @param {Plan} plan
   * @returns {{done: number, total: number, percent: number}}
   */
  async getOverallProgress(plan) {
    const subPlans = await this.resolveNestedPlans(plan);

    let done = 0;
    let total = 0;

    const countSteps = (steps) => {
      for (const step of steps) {
        total++;
        if (step.status === 'done') done++;
        if (step.steps && step.steps.length > 0) {
          countSteps(step.steps);
        }
      }
    };

    countSteps(plan.steps);

    // Учитываем шаги из подпланов
    for (const subPlan of subPlans) {
      countSteps(subPlan.steps);
    }

    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
  }

  // --- Private helpers ---

  _deserializeStep(data) {
    const steps = (data.steps || []).map(s => this._deserializeStep(s));
    return new PlanStep({ ...data, steps });
  }

  _findStepInSteps(steps, stepId) {
    for (const step of steps) {
      if (step.id === stepId) return step;
      const nested = this._findStepInSteps(step.steps, stepId);
      if (nested) return nested;
    }
    return null;
  }

  _removeStepFromSteps(steps, stepId) {
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].id === stepId) {
        steps.splice(i, 1);
        return true;
      }
      if (this._removeStepFromSteps(steps[i].steps, stepId)) {
        return true;
      }
    }
    return false;
  }

  _extractPlanId(planFilePath) {
    // Извлекает ID плана из пути к файлу (plans/<planId>.json)
    const basename = planFilePath.split('/').pop();
    if (basename && basename.endsWith('.json')) {
      return basename.slice(0, -5);
    }
    return null;
  }
}

/**
 * ContextStore — вспомогательный класс для управления context.json.
 */
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
