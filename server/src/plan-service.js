/**
 * PlanService — сервис для управления планами в системе multiagents.
 * Обертка над компонентом PlanManager, предоставляет доступ к функциям
 * планирования из основной системы.
 */

import path from "node:path";
import fs from "node:fs";
import { PlanManager } from "../../components/plan-manager/src/plan-manager.js";

/**
 * Плановый сервис — управляет экземплярами PlanManager для каждого контекста.
 * Использует Map для кэширования созданных менеджеров планов.
 */
export class PlanService {
  #managers = new Map(); // ctxId -> PlanManager

  /**
   * Получить (или создать) PlanManager для указанного контекста.
   * @param {string} ctxId - ID контекста
   * @param {string} ctxDir - Путь к директории контекста
   * @returns {PlanManager} Экземпляр PlanManager для этого контекста
   */
  getManager(ctxId, ctxDir) {
    if (!this.#managers.has(ctxId)) {
      const plansDir = path.join(ctxDir, "plans");
      this.#managers.set(ctxId, new PlanManager({ plansDir }));
    }
    return this.#managers.get(ctxId);
  }

  /**
   * Уничтожить PlanManager для контекста (освободить ресурсы).
   * @param {string} ctxId - ID контекста
   */
  destroyManager(ctxId) {
    this.#managers.delete(ctxId);
  }

  /**
   * Удалить план по ID.
   * @param {string} ctxId - ID контекста
   * @param {string} ctxDir - Путь к директории контекста
   * @param {string} planId - ID плана для удаления
   * @returns {boolean} true если план был удалён, false если не найден
   */
  async deletePlan(ctxId, ctxDir, planId) {
    const manager = this.getManager(ctxId, ctxDir);
    const plansDir = path.join(ctxDir, "plans");
    const planPath = path.join(plansDir, `${planId}.json`);

    try {
      if (fs.existsSync(planPath)) {
        fs.unlinkSync(planPath);
        return true;
      }
      return false;
    } catch (err) {
      console.error(`[plan-service] Error deleting plan ${planId}:`, err);
      throw err;
    }
  }

  /**
   * Получить все активные менеджеры планов (для отладки/мониторинга).
   * @returns {Map<string, PlanManager>} Карта ctxId -> PlanManager
   */
  getAllManagers() {
    return new Map(this.#managers);
  }
}

// Экспортируем классы из компонента для удобства использования
export { PlanStep, Plan } from "../../components/plan-manager/src/plan-manager.js";