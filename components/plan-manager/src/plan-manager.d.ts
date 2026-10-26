declare class PlanStep {
  id: string;
  task: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
}

declare class Plan {
  id: string;
  title: string;
  steps: PlanStep[];
}

export declare class PlanManager {
  static getInstance(): PlanManager;
  createPlan(ctxId: string, params: { title: string; description?: string; createdBy: string }): Promise<Plan>;
  loadPlan(ctxId: string, planId: string): Promise<Plan | null>;
  savePlan(plan: Plan): Promise<void>;
  updateStepStatus(plan: Plan, stepId: string, status: 'pending' | 'in_progress' | 'done' | 'blocked'): Promise<void>;
  addStep(plan: Plan, task: string, index?: number): Promise<PlanStep>;
  findStepById(plan: Plan, stepId: string): Promise<PlanStep | null>;
  addSubtask(plan: Plan, parentStepId: string, task: string): Promise<PlanStep>;
  removeStep(plan: Plan, stepId: string): Promise<void>;
  embedSubplan(plan: Plan, stepId: string, subplanPathOrObject: string | Plan): Promise<void>;
  getOverallProgress(plan: Plan): Promise<{ done: number; total: number }>;
  deletePlan(ctxId: string, planId: string): Promise<void>;
}