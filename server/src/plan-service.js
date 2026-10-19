/**
 * PlanService — сервис для управления планами в системе multiagents.
 * Обертка над компонентом PlanManager, предоставляет доступ к функциям
 * планирования из основной системы.
 */

import path from "node:path";
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
   * Получить все активные менеджеры планов (для отладки/мониторинга).
   * @returns {Map<string, PlanManager>} Карта ctxId -> PlanManager
   */
  getAllManagers() {
    return new Map(this.#managers);
  }
}

// Экспортируем классы из компонента для удобства использования
export { PlanStep, Plan } from "../../components/plan-manager/src/plan-manager.js";