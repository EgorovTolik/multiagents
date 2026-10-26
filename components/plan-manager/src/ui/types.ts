/**
 * Типы для UI компонента PlanEditor.
 */

export type StepStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type PlanStatus = 'planning' | 'approved' | 'executing' | 'completed' | 'archived';

export interface TaskFile {
  file: string;
  timestamp: number;
}

export interface PlanStep {
  id: string;
  task: string;
  file?: string;
  taskFiles?: TaskFile[];
  resultsFiles?: TaskFile[];
  planFile?: string;
  status: StepStatus;
  steps?: PlanStep[];
}

export interface Plan {
  id: string;
  title: string;
  description?: string;
  createdBy: string;
  createdAt: number;
  status: PlanStatus;
  ctxId?: string;
  filePath?: string;
  steps: PlanStep[];
}
