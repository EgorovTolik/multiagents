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

// Chevron icon для expand/collapse
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 transition-transform duration-300 ease-in-out ${expanded ? 'rotate-90' : ''}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
    </svg>
  );
}

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
    <div className="transition-all duration-300 ease-in-out">
      {/* Row header */}
      <div
        className="group flex items-center gap-2 py-2 pr-4 hover:bg-slate-800/70 cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 16}px` }}
        onClick={() => hasChildren && onToggle(step.id)}
      >
        {hasChildren ? (
          <ChevronIcon expanded={isExpanded} />
        ) : (
          <span className="w-4" />
        )}

        <span className={`flex-1 text-sm ${step.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-200'} transition-colors`}>{
          step.task
        }</span>

        <StatusBadge status={step.status} />
      </div>

      {/* Children */}
      {hasChildren && (
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
          {step.steps!.map(subStep => (
            <StepRow key={subStep.id} step={subStep} depth={depth + 1} onToggle={onToggle} expanded={expanded} />
          ))}
        </div>
      )}
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
