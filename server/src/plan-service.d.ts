/**
 * Type declarations for plan-service.js (PlanManager wrapper)
 */

interface PlanStep {
  id: string;
  task: string;
  file?: string;
  taskFiles?: Array<{ file: string; timestamp: number }>;
  resultsFiles?: Array<{ file: string; timestamp: number }>;
  planFile?: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  steps?: PlanStep[];
}

interface Plan {
  id: string;
  title: string;
  description?: string;
  createdBy: string;
  createdAt: number;
  status: 'planning' | 'approved' | 'executing' | 'completed' | 'archived';
  steps: PlanStep[];
  save(): Promise<void>;
  addStep(task: string, index?: number): Promise<PlanStep>;
  updateStepStatus(stepId: string, status: 'pending' | 'in_progress' | 'done' | 'blocked'): Promise<void>;
  findStepById(stepId: string): Promise<PlanStep | null>;
  addSubtask(parentStepId: string, task: string): Promise<PlanStep>;
  removeStep(stepId: string): Promise<void>;
  embedSubplan(stepId: string, subplanPathOrObject: string | Plan): Promise<void>;
  getOverallProgress(): Promise<{ done: number; total: number }>;
  _cacheNestedPlans(): Promise<void>;
}

class PlanManager {
  static getInstance(): PlanManager;
  createPlan(ctxId: string, params: { title: string; description?: string; createdBy: string }): Promise<Plan>;
  loadPlan(ctxId: string, planId: string): Promise<Plan | null>;
}

class PlanService {
  constructor();
  getManager(): PlanManager;
  createPlan(ctxId: string, params: { title: string; description?: string; createdBy: string }): Promise<Plan>;
  loadPlan(ctxId: string, planId: string): Promise<Plan | null>;
}

export { PlanManager, PlanService, PlanStep, Plan };