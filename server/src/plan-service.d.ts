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
  steps(): Promise<PlanStep[]>;
  findStepById(stepId: string): Promise<PlanStep | null>;
  addStep(task: string, index?: number): Promise<PlanStep>;
  removeStep(stepId: string): Promise<boolean>;
  setPlanFile(path: string): Promise<void>;
  setPlan(plan: Plan): Promise<void>;
  resetCache(): void;
  plan(): Promise<Plan | null>;
  attachTaskFile(filePath: string): void;
  attachResultFile(filePath: string): void;
  detailed(): Promise<any>;
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
  addSubStep(stepId: string, task: string, index?: number): Promise<PlanStep>;
  addPlan(plan: Plan, index?: number): Promise<PlanStep>;
  setStepStatus(stepId: string, status: 'pending' | 'in_progress' | 'done' | 'blocked'): Promise<void>;
  setStepTask(stepId: string, task: string): Promise<void>;
  findStepById(stepId: string): Promise<PlanStep | null>;
  removeStep(stepId: string): Promise<void>;
  attachTaskFile(stepId: string, filePath: string): Promise<void>;
  attachResultFile(stepId: string, filePath: string): Promise<void>;
  setPlan(stepId: string, subplanPathOrObject: string | Plan): Promise<void>;
  getOverallProgress(): Promise<{ done: number; total: number }>;
  resetCache(): void;
  detailed(): Promise<any>;
}

class PlanManager {
  static getInstance(): PlanManager;
  createPlan(ctxId: string, params: { title: string; description?: string; createdBy: string }): Promise<Plan>;
  loadPlan(ctxId: string, planId: string): Promise<Plan | null>;
  loadPlanByFile(filePath: string): Promise<Plan | null>;
}

class PlanService {
  constructor();
  getManager(): PlanManager;
  createPlan(ctxId: string, params: { title: string; description?: string; createdBy: string }): Promise<Plan>;
  loadPlan(ctxId: string, planId: string): Promise<Plan | null>;
  loadPlanByFile(filePath: string): Promise<Plan | null>;
  listPlans(ctxId: string): Promise<Array<{ id: string; title: string }>>;
}

export { PlanManager, PlanService, PlanStep, Plan };