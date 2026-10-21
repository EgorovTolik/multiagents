/**
 * PlanManager — singleton-менеджер для керирования объектами Plan.
 * Держит в памяти кэш всех загруженных планов, синхронизирует доступ
 * к созданию и загрузке планов через мютекс на уровне менеджера.
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import fs from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Plan } from './plan.js';
import { PlanStep } from './planstep.js';

/**
 * PlanManager — singleton.
 */
export class PlanManager {
  constructor() {
    // Кэш загруженных планов: Map<planId, Plan>
    this._plans = new Map();
  }

  /**
   * Получить экземпляр singleton.
   * @returns {PlanManager}
   */
  static getInstance() {
    if (!PlanManager._instance) {
      PlanManager._instance = new PlanManager();
    }
    return PlanManager._instance;
  }

  /**
   * Создать новый пустой план.
   * @param {string} ctxId - Идентификатор контекста
   * @param {object} params
   * @param {string} params.title - Название плана
   * @param {string} [params.description] - Описание цели и контекста
   * @param {string} params.createdBy - ID агента, создавшего план
   * @returns {Plan}
   */
  async createPlan(ctxId, { title, description, createdBy }) {
    const planId = randomUUID();
    const plansDir = join('contexts', ctxId, 'plans');

    // Создаём директорию для планов (если не существует)
    if (!fs.existsSync(plansDir)) {
      fs.mkdirSync(plansDir, { recursive: true });
    }

    const filePath = join(plansDir, `${planId}.json`);

    const plan = new Plan({
      id: planId,
      title,
      description,
      createdBy,
      status: 'planning',
      steps: [],
      filePath: filePath,
      ctxId: ctxId
    });

    // Сохраняем на диск (внутри save() будет свой мютекс)
    await plan.save();

    // Кешируем в памяти
    this._plans.set(planId, plan);

    return plan;
  }

  /**
   * Загрузить план по ID. Ищет в кэше, если нет — загружает из файла и кеширует.
   * @param {string} ctxId - Идентификатор контекста
   * @param {string} planId - ID плана
   * @returns {Plan|null}
   */
  async loadPlan(ctxId, planId) {
    // Сначала ищем в кэше
    let plan = this._plans.get(planId);

    if (!plan) {
      // Загружаем из файла
      const plansDir = join('contexts', ctxId, 'plans');
      const filePath = join(plansDir, `${planId}.json`);

      try {
        const content = await readFile(filePath, 'utf-8');
          if (!content || content.trim() === '') {
            throw new Error(`Plan file is empty: ${filePath}`);
          }

          let data;
          try {
            data = JSON.parse(content);
          } catch (parseError) {
            // Пытаемся загрузить резервную копию
            const backupFilePath = `${filePath}.prev`;
            if (fs.existsSync(backupFilePath)) {
              const backupContent = await readFile(backupFilePath, 'utf-8');
              data = JSON.parse(backupContent);
              // Обновляем основной файл из бэкапа
              await writeFile(filePath, backupContent, 'utf-8');
            } else {
              throw new Error(`Failed to parse plan file ${planId} (no backup available): ${parseError.message}`);
            }
          }

          // Восстанавливаем PlanStep объекты из данных
          const steps = (data.steps || []).map(s => this._deserializeStep(s));
          plan = new Plan({ ...data, steps, filePath: filePath, ctxId: ctxId });

          // Кешируем в памяти
          this._plans.set(planId, plan);
        } catch (e) {
          console.error(`[planmanager] Error loading plan ${planId}:`, e);
          if (e.code === 'ENOENT') return null;
          throw e;
        }
      }

    return plan;
  }

  /**
   * Получить план из кэша без загрузки с диска.
   * @param {string} planId - ID плана
   * @returns {Plan|null}
   */
  getCachedPlan(planId) {
    return this._plans.get(planId) || null;
  }

  /**
   * Удалить план из кэша (не с диска).
   * @param {string} planId - ID плана
   */
  removeCachedPlan(planId) {
    this._plans.delete(planId);
  }

  /**
   * Загрузить план по прямому пути к файлу. Если план уже в кэше — возвращает кэшированную версию.
   * @param {string} filePath - Полный путь к файлу плана
   * @returns {Plan|null}
   */
  async loadPlanByFile(filePath) {
    try {
      // Загружаем из файла
      const content = await readFile(filePath, 'utf-8');
      if (!content || content.trim() === '') {
        throw new Error(`Plan file is empty: ${filePath}`);
      }

      let data;
      try {
        data = JSON.parse(content);
      } catch (parseError) {
        // Пытаемся загрузить резервную копию
        const backupFilePath = `${filePath}.prev`;
        if (fs.existsSync(backupFilePath)) {
          const backupContent = await readFile(backupFilePath, 'utf-8');
          data = JSON.parse(backupContent);
          // Обновляем основной файл из бэкапа
          await writeFile(filePath, backupContent, 'utf-8');
        } else {
          throw new Error(`Failed to parse plan file (no backup available): ${parseError.message}`);
        }
      }

      // Проверяем кэш по ID плана из загруженных данных
      const cached = this._plans.get(data.id);
      if (cached) return cached;

      // Восстанавливаем PlanStep объекты из данных
      const steps = (data.steps || []).map(s => this._deserializeStep(s));
      const plan = new Plan({ ...data, steps, filePath: filePath });

      // Кешируем в памяти
      this._plans.set(data.id, plan);

      return plan;
    } catch (e) {
      console.error(`[planmanager] Error loading plan by file ${filePath}:`, e);
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  // --- Private helpers ---

  _deserializeStep(data) {
    const steps = (data.steps || []).map(s => this._deserializeStep(s));
    return new PlanStep({ ...data, steps });
  }
}

// Экспорт для использования в других файлах
export default PlanManager.getInstance();
