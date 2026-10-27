/**
 * PlanService — сервис для управления планами в системе multiagents.
 * Обертка над компонентом PlanManager, предоставляет доступ к функциям
 * планирования из основной системы.
 */

import { PlanManager } from "@multiagents/plan-manager";

/**
 * Плановый сервис — управляет экземплярами PlanManager для каждого контекста.
 * Использует Map для кэширования созданных менеджеров планов.
 */
export class PlanService {
  #manager = null;

  /**
   * Получить singleton-экземпляр PlanManager.
   * @returns {PlanManager} Экземпляр PlanManager (один на все контексты)
   */
  getManager() {
    if (!this.#manager) {
      this.#manager = PlanManager.getInstance();
    }
    return this.#manager;
  }

  /**
   * Создать новый план.
   * @param {string} ctxId - ID контекста
   * @param {object} params - Параметры плана (title, description, createdBy)
   * @returns {Plan} Созданный план
   */
  async createPlan(ctxId, params) {
    return this.getManager().createPlan(ctxId, params);
  }

  /**
   * Загрузить план по ID.
   * @param {string} ctxId - ID контекста
   * @param {string} planId - ID плана
   * @returns {Plan|null} Загруженный план или null если не найден
   */
  async loadPlan(ctxId, planId) {
    return this.getManager().loadPlan(ctxId, planId);
  }

  /**
   * Загрузить план по прямому пути к файлу.
   * @param {string} filePath - Полный путь к файлу плана
   * @returns {Plan|null} Загруженный план или null если не найден
   */
  async loadPlanByFile(filePath) {
    return this.getManager().loadPlanByFile(filePath);
  }

  /**
   * Сохранить изменения в плане.
   * @param {Plan} plan - План для сохранения
   */
  async savePlan(plan) {
    return this.getManager().savePlan(plan);
  }

  /**
   * Обновить статус шага плана.
   * @param {Plan} plan - План
   * @param {string} stepId - ID шага
   * @param {string} status - Новый статус (pending, in_progress, done, blocked)
   */
  async setStepStatus(plan, stepId, status) {
    return this.getManager().setStepStatus(plan, stepId, status);
  }

  /**
   * Добавить шаг в план.
   * @param {Plan} plan - План
   * @param {string} task - Описание задачи шага
   * @param {number} [index] - Позиция в списке (опционально)
   * @returns {PlanStep} Добавленный шаг
   */
  async addStep(plan, task, index) {
    return this.getManager().addStep(plan, task, index);
  }

  /**
   * Найти шаг по ID в плане.
   * @param {Plan} plan - План
   * @param {string} stepId - ID шага для поиска
   * @returns {PlanStep|null} Найденный шаг или null
   */
  async findStepById(plan, stepId) {
    return this.getManager().findStepById(plan, stepId);
  }

  /**
   * Добавить подзадачу к шагу плана.
   * @param {Plan} plan - План
   * @param {string} parentStepId - ID родительского шага
   * @param {string} task - Описание подзадачи
   * @returns {PlanStep} Добавленная подзадача
   */
  async addSubStep(plan, parentStepId, task) {
    return this.getManager().addSubStep(plan, parentStepId, task);
  }

  /**
   * Удалить шаг из плана.
   * @param {Plan} plan - План
   * @param {string} stepId - ID шага для удаления
   */
  async removeStep(plan, stepId) {
    return this.getManager().removeStep(plan, stepId);
  }

  /**
   * Встроить подплан в шаг.
   * @param {Plan} plan - План
   * @param {string} stepId - ID шага, в который встраивается подплан
   * @param {object|string} subplanPathOrObject - Путь к файлу подплана или объект плана
   */
  async setPlan(plan, stepId, subplanPathOrObject) {
    return this.getManager().setPlan(plan, stepId, subplanPathOrObject);
  }

  /**
   * Получить общий прогресс выполнения плана.
   * @param {Plan} plan - План
   * @returns {object} Объект с полями done и total
   */
  async getOverallProgress(plan) {
    return this.getManager().getOverallProgress(plan);
  }

  /**
   * Удалить план по ID.
   * @param {string} ctxId - ID контекста
   * @param {string} planId - ID плана для удаления
   */
  async deletePlan(ctxId, planId) {
    return this.getManager().deletePlan(ctxId, planId);
  }

  /**
   * Получить список всех планов для контекста.
   * @param {string} ctxId - ID контекста
   * @returns {Array<{id: string, title: string}>} Массив объектов с id и title
   */
  async listPlans(ctxId) {
    return this.getManager().listPlans(ctxId);
  }
}

// Экспортируем классы из компонента для удобства использования
export { PlanStep, Plan } from "@multiagents/plan-manager";