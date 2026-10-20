/**
 * PlanStep — шаг плана с поддержкой вложенности.
 */

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
   */
  get steps() {
    if (this.plan && this.plan.steps) {
      return this.plan.steps;
    }
    return this._inlineSteps;
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
