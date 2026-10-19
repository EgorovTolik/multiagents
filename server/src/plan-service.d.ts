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
}

class PlanManager {
  constructor(options: { plansDir: string });
  createPlan(data: { title: string; description?: string; createdBy: string }): Promise<Plan>;
  loadPlan(planId: string): Promise<Plan | null>;
  savePlan(plan: Plan): Promise<void>;
  addStep(plan: Plan, task: string, index?: number): Promise<PlanStep>;
  addSubtask(plan: Plan, parentStepId: string, task: string): Promise<PlanStep>;
  updateStepStatus(plan: Plan, stepId: string, status: 'pending' | 'in_progress' | 'done' | 'blocked'): Promise<void>;
  findStepById(plan: Plan, stepId: string): Promise<PlanStep | null>;
  removeStep(plan: Plan, stepId: string): Promise<void>;
  attachTaskFile(plan: Plan, stepId: string, filePath: string): Promise<void>;
  attachResultFile(plan: Plan, stepId: string, filePath: string): Promise<void>;
  embedSubplan(plan: Plan, stepId: string, subplanPathOrObject: string | Plan): Promise<void>;
  resolveNestedPlans(plan: Plan): Promise<PlanManager[]>;
  getOverallProgress(plan: Plan): Promise<{ done: number; total: number; percent: number }>;
  resetCache(plan: Plan): void;
}

class PlanService {
  constructor();
  getManager(ctxId: string, ctxDir: string): PlanManager;
  destroyManager(ctxId: string): void;
  getAllManagers(): Map<string, PlanManager>;
}

export { PlanManager, PlanService, PlanStep, Plan };