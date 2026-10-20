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

// Простая Promise-based mutex для синхронизации доступа к кэшу планов.
let managerLocked = false;
let waitingResolves = [];

async function acquireManagerLock() {
  while (managerLocked) {
    await new Promise(resolve => {
      waitingResolves.push(resolve);
    });
  }
  managerLocked = true;
}

function releaseManagerLock() {
  managerLocked = false;
  if (waitingResolves.length > 0) {
    const resolve = waitingResolves.shift();
    resolve();
  }
}

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
    await acquireManagerLock();
    try {
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
    } finally {
      releaseManagerLock();
    }
  }

  /**
   * Загрузить план по ID. Ищет в кэше, если нет — загружает из файла и кеширует.
   * @param {string} ctxId - Идентификатор контекста
   * @param {string} planId - ID плана
   * @returns {Plan|null}
   */
  async loadPlan(ctxId, planId) {
    await acquireManagerLock();
    try {
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
          if (e.code === 'ENOENT') return null;
          throw e;
        }
      }

      console.log(`[planmanager] Calling _cacheNestedPlans for plan ${plan.id}`);
      // Автоматически загружаем и кэшируем вложенные подпланы для всех планов
      await plan._cacheNestedPlans();
      console.log(`[planmanager] _cacheNestedPlans completed for plan ${plan.id}`);

      return plan;
    } finally {
      releaseManagerLock();
    }
  }

  /**
   * Список всех планов в контексте.
   * @param {string} ctxId - Идентификатор контекста
   * @returns {Array<{id: string, title: string, status}>}
   */
  async listPlans(ctxId) {
    await acquireManagerLock();
    try {
      const plansDir = join('contexts', ctxId, 'plans');
      const files = fs.readdirSync(plansDir);
      const plans = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const planId = file.slice(0, -5);

        // Пытаемся загрузить план из кэша или с диска
        let plan = this._plans.get(planId);
        if (!plan) {
          try {
            plan = await this.loadPlan(ctxId, planId);
          } catch (e) {
            // Если не удалось загрузить — пропускаем
            console.warn(`[planmanager] Failed to load plan ${planId}:`, e);
            continue;
          }
        }

        if (plan) {
          plans.push({ id: plan.id, title: plan.title, status: plan.status });
        }
      }

      return plans;
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    } finally {
      releaseManagerLock();
    }
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

  // --- Private helpers ---

  _deserializeStep(data) {
    const steps = (data.steps || []).map(s => this._deserializeStep(s));
    return new PlanStep({ ...data, steps });
  }
}

// Экспорт для использования в других файлах
export default PlanManager.getInstance();
