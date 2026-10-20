/**
 * PlanManager — модуль для управления файлами планов в системе multiagents.
 * Обеспечивает создание, загрузку, сохранение, модификацию и разрешение вложенных подпланов.
 */

import { readFile, writeFile, mkdir, readdir, rename, unlink } from 'fs/promises';
import fs from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

// Optimistic concurrency control for plans using version numbers.
// Shared across ALL PlanManager instances in this process to detect conflicts
// between separate tool calls that might modify the same plan concurrently.
export const sharedLoadedVersions = new Map(); // planId -> version at load time

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
   * @param {PlanStep[]} [data.steps] - Вложенные подзадачи (inline)
   */
  constructor(data) {
    this.id = data.id;
    this.task = data.task;
    this.file = data.file;
    this.taskFiles = data.taskFiles || [];
    this.resultsFiles = data.resultsFiles || [];
    this.planFile = data.planFile;
    this.status = data.status;
    // Храним inline steps отдельно, getter для .steps вернёт либо их,
    // либо шаги из встроенного подплана (если он есть)
    this._inlineSteps = data.steps || [];
  }

  /**
   * Getter для steps — возвращает inline steps или шаги из встроенного подплана.
   * Это создаёт единое древовидное представление плана для потребителей API/UI.
   */
  get steps() {
    // Если есть загруженный встроенный план — используем его шаги
    if (this.plan && this.plan.steps) {
      return this.plan.steps;
    }
    // Иначе возвращаем inline steps
    return this._inlineSteps;
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
    this.version = data.version || 0; // Версия для optimistic concurrency control
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
   * @param {string} options.plansDir - Путь к директории, где хранятся файлы планов
   */
  constructor(options) {
    this.plansDir = options.plansDir;
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
    const backupFilePath = `${filePath}.prev`;

    try {
      console.log(`[plan-manager] Loading plan ${planId} from ${filePath}`);
      const content = await readFile(filePath, 'utf-8');
      console.log(`[plan-manager] Read ${content.length} bytes for plan ${planId}`);
      
      // Валидация JSON
      if (!content || content.trim() === '') {
        throw new Error(`Plan file is empty: ${filePath}`);
      }

      let data;
      try {
        data = JSON.parse(content);
      } catch (parseError) {
        console.error(`[plan-manager] JSON parse error for plan ${planId}:`, parseError.message);
        
        // Пытаемся загрузить резервную копию
        if (fs.existsSync(backupFilePath)) {
          console.log(`[plan-manager] Trying backup file: ${backupFilePath}`);
          try {
            const backupContent = await readFile(backupFilePath, 'utf-8');
            data = JSON.parse(backupContent);
            console.log(`[plan-manager] Successfully loaded plan from backup`);
            // Обновляем основной файл из бэкапа
            await writeFile(filePath, backupContent, 'utf-8');
          } catch (backupError) {
            console.error(`[plan-manager] Failed to load from backup:`, backupError.message);
            throw new Error(`Failed to parse plan file ${planId} and backup is also invalid: ${parseError.message}`);
          }
        } else {
          throw new Error(`Failed to parse plan file ${planId} (no backup available): ${parseError.message}`);
        }
      }

      // Восстанавливаем PlanStep объекты из данных
      const steps = (data.steps || []).map(s => this._deserializeStep(s));
      const plan = new Plan({ ...data, steps });

      // Запоминаем версию в shared map'е для optimistic concurrency control
      sharedLoadedVersions.set(plan.id, plan.version);

      // Кэшируем подпланы в шагах
      await this._cacheNestedPlans(plan);

      return plan;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  /**
   * Кэшировать подпланы в шагах плана.
   * @param {Plan} plan
   */
  async _cacheNestedPlans(plan) {
    for (const step of plan.steps) {
      await this._cacheStepPlan(step);
    }
  }

  /**
   * Кэшировать подплан для шага.
   * @param {PlanStep} step
   */
  async _cacheStepPlan(step) {
    if (step.planFile && !step.plan) {
      const subPlanId = this._extractPlanId(step.planFile);
      if (subPlanId) {
        try {
          const subPlan = await this.loadPlan(subPlanId);
          step.plan = subPlan;
        } catch (e) {
          // Подплан не найден или ошибка загрузки — пропускаем
        }
      }
    }
  }

  /**
   * Сохранить изменения в плане.
   * @param {Plan} plan
   */
  async savePlan(plan) {
    await mkdir(this.plansDir, { recursive: true });
    const filePath = join(this.plansDir, `${plan.id}.json`);
    const tempFilePath = `${filePath}.tmp-${Date.now()}`;
    const backupFilePath = `${filePath}.prev`;

    // Optimistic concurrency control: check if version changed since load
    const loadedVersion = sharedLoadedVersions.get(plan.id);
    if (loadedVersion !== undefined && loadedVersion !== plan.version) {
      throw new Error(`PLAN_VERSION_CONFLICT: Plan ${plan.id} was modified by another operation since it was loaded. Loaded version: ${loadedVersion}, current file version: ${plan.version}. Please reload and retry.`);
    }

    // Increment version before saving
    plan.version = (plan.version || 0) + 1;

    try {
      // 1. Сериализация в JSON
      const content = JSON.stringify(plan.toJSON(), null, 2);
      console.log(`[plan-manager] Saving plan ${plan.id} to temp file (${content.length} bytes)`);

      // 2. Запись во временный файл
      await writeFile(tempFilePath, content, 'utf-8');

      // 3. Проверка целостности — читаем обратно и парсим
      const verifyContent = await readFile(tempFilePath, 'utf-8');
      JSON.parse(verifyContent);
      console.log(`[plan-manager] Plan file integrity verified`);

      // 4. Создание резервной копии текущего файла (если существует)
      if (fs.existsSync(filePath)) {
        try {
          if (fs.existsSync(backupFilePath)) {
            await unlink(backupFilePath); // Удаляем старую резервную копию
          }
          await rename(filePath, backupFilePath);
          console.log(`[plan-manager] Backup created at ${backupFilePath}`);
        } catch (backupErr) {
          console.warn(`[plan-manager] Failed to create backup:`, backupErr);
          // Продолжаем даже если бэкап не создан
        }
      }

      // 5. Атомарное переименование временного файла в основной
      await rename(tempFilePath, filePath);
      
      // Update tracked version in shared map after successful save
      sharedLoadedVersions.set(plan.id, plan.version);
      console.log(`[plan-manager] Plan ${plan.id} saved successfully (atomic), version: ${plan.version}`);
    } catch (err) {
      // Очистка временного файла при ошибке
      try {
        if (fs.existsSync(tempFilePath)) {
          await unlink(tempFilePath);
        }
      } catch (cleanupErr) {
        // Игнорируем ошибки очистки
      }
      console.error(`[plan-manager] Error saving plan ${plan.id}:`, err);
      throw err;
    }
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
    // savePlan uses optimistic concurrency control with version numbers
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

      // Поиск во вложенном плане через кэш или planFile
      if (step.plan) {
        // Используем кэшированный объект плана
        const found = await this.findStepById(step.plan, stepId);
        if (found) return found;
      } else if (step.planFile) {
        // Кэша нет — загружаем с диска и кэшируем
        try {
          const subPlanId = this._extractPlanId(step.planFile);
          if (subPlanId) {
            const subPlan = await this.loadPlan(subPlanId);
            step.plan = subPlan;
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
      if (!parent._inlineSteps) parent._inlineSteps = [];
      if (index !== undefined && index >= 0 && index <= parent._inlineSteps.length) {
        parent._inlineSteps.splice(index, 0, newStep);
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

    // Если у шага есть встроенный подплан — добавляем subtask туда
    if (parentStep.planFile) {
      let childPlan = parentStep.plan;
      if (!childPlan) {
        // Загружаем дочерний план из файла
        const subPlanId = this._extractPlanId(parentStep.planFile);
        if (subPlanId) {
          childPlan = await this.loadPlan(subPlanId);
          parentStep.plan = childPlan;
        }
      }

      if (childPlan) {
        // Добавляем subtask в дочерний план и сохраняем его файл
        const newStep = await this.addStep(childPlan, task);
        await this.savePlan(childPlan);
        return newStep;
      }
    }

    // Иначе добавляем inline subtask к шагу
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

    // Очищаем существующие inline steps — при встраивании подплана они не используются
    step._inlineSteps = [];

    if (typeof subplanPathOrObject === 'string') {
      // Перегрузка 1 — путь к файлу
      step.planFile = subplanPathOrObject;
    } else if (subplanPathOrObject instanceof Plan) {
      // Перегрузка 2 — объект плана (гарантия валидности)
      await this.savePlan(subplanPathOrObject);
      step.planFile = join(this.plansDir, `${subplanPathOrObject.id}.json`);
    }

    // Сохраняем только ссылку на файл подплана, не кэшируем объект в памяти
    // Кэширование происходит при загрузке плана (loadPlan)
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

      // Используем кэш, если есть
      let subPlan = step.plan;
      if (!subPlan) {
        try {
          const subPlanId = this._extractPlanId(step.planFile);
          if (subPlanId) {
            subPlan = await this.loadPlan(subPlanId);
            step.plan = subPlan;
          }
        } catch (e) {
          // Подплан не найден или ошибка загрузки — пропускаем
          return;
        }
      }

      if (subPlan) {
        resolved.push(subPlan);
        // Рекурсивно обрабатываем подпланы
        for (const subStep of subPlan.steps) {
          await visitStep(subStep);
        }
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
    // Загружаем вложенные планы чтобы их шаги были доступны через getter .steps
    await this._cacheNestedPlans(plan);

    let done = 0;
    let total = 0;

    const countSteps = (steps) => {
      for (const step of steps) {
        total++;
        if (step.status === 'done') done++;
        // Рекурсивно считаем подшаги — getter .steps вернёт inline или шаги встроенного плана
        if (step.steps && step.steps.length > 0) {
          countSteps(step.steps);
        }
      }
    };

    countSteps(plan.steps);

    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
  }

  /**
   * Сбросить кэш вложенных планов.
   * Рекурсивно обнуляет поле step.plan во всех шагах плана,
   * чтобы при последующих операциях планы перечитывались с диска.
   * @param {Plan} plan
   */
  resetCache(plan) {
    for (const step of plan.steps) {
      if (step.plan) {
        // Рекурсивно сбрасываем кэш вложенного плана
        this.resetCache(step.plan);
        step.plan = null;
      }
    }
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

  /**
   * Удалить файл встроенного подплана и его резервную копию.
   * @param {string} planFilePath - Путь к файлу подплана
   */
  async _cleanupEmbeddedPlan(planFilePath) {
    if (!planFilePath) return;
    try {
      // Удаляем основной файл подплана
      await unlink(planFilePath).catch(() => {});
      // Удаляем резервную копию если есть
      await unlink(`${planFilePath}.prev`).catch(() => {});
      console.log(`[plan-manager] Cleaned up embedded plan file: ${planFilePath}`);
    } catch (err) {
      console.warn(`[plan-manager] Warning: failed to cleanup embedded plan file ${planFilePath}:`, err);
    }
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
