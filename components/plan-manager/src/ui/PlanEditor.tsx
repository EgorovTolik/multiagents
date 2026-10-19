/**
 * Плановый редактор — всплывающее окно для просмотра и редактирования плана.
 * Использует тот же паттерн, что и RecoveryHistoryModal.
 */

import { useState, useEffect } from 'react';
import type { Plan, PlanStep, StepStatus } from './types';

interface PlanEditorProps {
  planId: string;
  isOpen: boolean;
  onClose: () => void;
  onPlanChange?: (plan: Plan) => void;
}

// Mock данные для демо
const mockPlans: Record<string, Plan> = {
  'demo-plan': {
    id: 'demo-plan',
    title: 'Реализация API авторизации',
    description: 'План разработки модуля авторизации пользователей',
    createdBy: 'orchestrator',
    createdAt: Date.now() - 3600000,
    status: 'executing',
    steps: [
      {
        id: 'step-1',
        task: 'Проектирование API',
        status: 'done',
        steps: [
          { id: 'step-1.1', task: 'Определить контракты API', status: 'done' },
          { id: 'step-1.2', task: 'Выбрать библиотеки JWT', status: 'done' }
        ]
      },
      {
        id: 'step-2',
        task: 'Реализация роутов авторизации',
        status: 'in_progress',
        steps: [
          { id: 'step-2.1', task: 'POST /auth/register', status: 'done' },
          { id: 'step-2.2', task: 'POST /auth/login', status: 'in_progress' },
          { id: 'step-2.3', task: 'Middleware авторизации', status: 'pending' }
        ]
      },
      {
        id: 'step-3',
        task: 'Тестирование',
        status: 'pending',
        steps: [
          { id: 'step-3.1', task: 'Unit тесты', status: 'pending' },
          { id: 'step-3.2', task: 'Интеграционные тесты', status: 'blocked' }
        ]
      }
    ]
  }
};

function StatusBadge({ status }: { status: StepStatus }) {
  const colors = {
    pending: 'bg-slate-600 text-slate-300',
    in_progress: 'bg-blue-600 text-white',
    done: 'bg-emerald-600 text-white',
    blocked: 'bg-rose-600 text-white'
  };

  const labels = {
    pending: 'Ожидает',
    in_progress: 'Выполняется',
    done: 'Готово',
    blocked: 'Заблокировано'
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

function StepRow({ step, depth = 0, onToggle, expanded }: { step: PlanStep; depth?: number; onToggle: (id: string) => void; expanded: Set<string> }) {
  const hasChildren = step.steps && step.steps.length > 0;
  const isExpanded = expanded.has(step.id);

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2 hover:bg-slate-800/50" style={{ paddingLeft: `${depth * 1.5 + 1}rem` }}>
        {hasChildren ? (
          <button onClick={() => onToggle(step.id)} className="text-slate-400 hover:text-white">
            {isExpanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-3" />
        )}
        <span className="flex-1 text-sm text-slate-200">{step.task}</span>
        <StatusBadge status={step.status} />
      </div>

      {hasChildren && isExpanded && step.steps!.map(subStep => (
        <StepRow key={subStep.id} step={subStep} depth={depth + 1} onToggle={onToggle} expanded={expanded} />
      ))}
    </div>
  );
}

export function PlanEditor({ planId, isOpen, onClose, onPlanChange }: PlanEditorProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set(['step-1', 'step-2', 'step-3']));

  // Закрытие по Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Загрузка плана при открытии
  useEffect(() => {
    if (!isOpen || !planId) return;
    loadPlan();
  }, [isOpen, planId]);

  async function loadPlan() {
    setLoading(true);
    setError(null);
    try {
      // В реальном проекте: загрузка через API или PlanManager instance
      // const loaded = await pm.loadPlan(planId);
      // Для демо используем mock данные
      setTimeout(() => {
        setPlan(mockPlans[planId] || null);
        setLoading(false);
      }, 200);
    } catch (e) {
      setError('Ошибка загрузки плана');
      setLoading(false);
    }
  }

  function handleToggleStep(stepId: string) {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  }

  function handleUpdateStatus(stepId: string, status: StepStatus) {
    // В реальном проекте: вызов API для обновления статуса
    console.log('Update status:', stepId, status);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[85vh] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <h3 className="text-lg font-semibold text-white">{plan?.title || 'План'}</h3>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white" aria-label="Закрыть">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(85vh-4rem)] overflow-y-auto">
          {loading ? (
            <div className="px-5 py-8 text-center text-slate-400">Загрузка...</div>
          ) : error ? (
            <div className="px-5 py-8 text-center text-rose-400">{error}</div>
          ) : plan ? (
            <>
              {/* Описание плана */}
              {plan.description && (
                <div className="border-b border-slate-700 px-5 py-3">
                  <p className="text-sm text-slate-400">{plan.description}</p>
                </div>
              )}

              {/* Шаги плана */}
              <div className="divide-y divide-slate-700/50">
                {plan.steps.map(step => (
                  <StepRow key={step.id} step={step} onToggle={handleToggleStep} expanded={expandedSteps} />
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 px-5 py-3 text-right">
          <button onClick={onClose} className="rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
