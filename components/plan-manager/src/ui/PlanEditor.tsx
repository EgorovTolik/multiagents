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
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-all duration-300 ease-in-out hover:bg-slate-700 hover:text-white ${expanded ? 'rotate-90' : ''}`}>
      <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: '14px', height: '14px' }}>
        <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
      </svg>
    </span>
  );
}

function StatusBadge({ status }: { status: StepStatus }) {
  const styles = {
    pending: {
      backgroundColor: 'rgba(51, 65, 85, 0.8)',
      color: '#cbd5e1',
      borderColor: '#475569'
    },
    in_progress: {
      backgroundColor: 'rgba(59, 130, 246, 0.2)',
      color: '#93c5fd',
      borderColor: 'rgba(59, 130, 246, 0.4)'
    },
    done: {
      backgroundColor: 'rgba(16, 185, 129, 0.2)',
      color: '#6ee7b7',
      borderColor: 'rgba(16, 185, 129, 0.4)'
    },
    blocked: {
      backgroundColor: 'rgba(244, 63, 94, 0.2)',
      color: '#fda4af',
      borderColor: 'rgba(244, 63, 94, 0.4)'
    }
  };

  const labels = {
    pending: 'Ожидает',
    in_progress: 'Выполняется',
    done: 'Готово',
    blocked: 'Заблокировано'
  };

  return (
    <span 
      className="inline-flex items-center font-semibold tracking-wide uppercase"
      style={{
        ...styles[status],
        marginLeft: '16px',
        flexShrink: 0,
        borderRadius: '9999px',
        border: '1px solid',
        padding: '2px 10px',
        fontSize: '11px',
        lineHeight: '1.4'
      }}
    >
      {labels[status]}
    </span>
  );
}

function StepRow({ step, depth = 0, onToggle, expanded }: { step: PlanStep; depth?: number; onToggle: (id: string) => void; expanded: Set<string> }) {
  const hasChildren = step.steps && step.steps.length > 0;
  const isExpanded = expanded.has(step.id);

  return (
    <div className="relative">
      {/* Indentation guide line */}
      {depth > 0 && (
        <div 
          className="absolute left-0 top-0 bottom-0 w-px bg-slate-700/50"
          style={{ left: `${(depth - 1) * 24 + 16}px` }}
        />
      )}

      {/* Row header */}
      <div
        className="flex items-center gap-3 py-3 pr-4 cursor-pointer transition-colors"
        style={{ 
          paddingLeft: `${depth * 24 + 16}px`,
          backgroundColor: 'transparent'
        }}
        onClick={() => hasChildren && onToggle(step.id)}
        onMouseOver={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(30, 41, 59, 0.6)';
        }}
        onMouseOut={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        }}
      >
        {hasChildren ? (
          <ChevronIcon expanded={isExpanded} />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
          </span>
        )}

        <span 
          className={`flex-1 text-sm transition-colors ${
            step.status === 'done' 
              ? 'text-slate-400 line-through decoration-slate-600' 
              : step.status === 'in_progress'
                ? 'text-white font-medium'
                : 'text-slate-300'
          }`}
        >
          {step.task}
        </span>

        <StatusBadge status={step.status} />
      </div>

      {/* Children */}
      {hasChildren && (
        <div 
          className={`overflow-hidden transition-all duration-300 ease-in-out`} 
          style={{ maxHeight: isExpanded ? '2000px' : '0px', opacity: isExpanded ? 1 : 0 }}
        >
          <div style={{ borderLeft: '1px solid rgba(100, 116, 139, 0.5)', marginLeft: '16px' }}>
            {step.steps!.map(subStep => (
              <StepRow key={subStep.id} step={subStep} depth={depth + 1} onToggle={onToggle} expanded={expanded} />
            ))}
          </div>
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
        <div className="max-h-[calc(85vh-6rem)] overflow-y-auto bg-slate-900/50">
          {loading ? (
            <div className="px-5 py-8 text-center text-slate-400">Загрузка...</div>
          ) : error ? (
            <div className="px-5 py-8 text-center text-rose-400">{error}</div>
          ) : plan ? (
            <>
              {/* Описание плана */}
              {plan.description && (
                <div className="border-b border-slate-700/50 px-6 py-4">
                  <p className="text-sm text-slate-400">{plan.description}</p>
                </div>
              )}

              {/* Шаги плана */}
              <div>
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
