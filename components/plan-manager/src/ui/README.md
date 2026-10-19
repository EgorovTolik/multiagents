# PlanEditor UI Компонент

React компонент для просмотра и редактирования планов во всплывающем окне. Использует тот же паттерн, что и RecoveryHistoryModal в основном проекте.

## Использование

```tsx
import { PlanEditor } from './PlanEditor';
import type { Plan } from './types';

// В родительском компоненте (App.tsx)
const [planModalOpen, setPlanModalOpen] = useState(false);

// Кнопка открытия модалки
<button onClick={() => setPlanModalOpen(true)}>
  Открыть редактор плана
</button>

// Модалка рендерится в конце JSX дерева
<PlanEditor
  planId="demo-plan"
  isOpen={planModalOpen}
  onClose={() => setPlanModalOpen(false)}
  onPlanChange={(plan) => console.log('Plan changed:', plan)}
/>
```

## Props

| Prop | Type | Description |
|------|------|-------------|
| `planId` | `string` | ID плана для загрузки |
| `isOpen` | `boolean` | Открыта ли модалка |
| `onClose` | `() => void` | Колбэк при закрытии |
| `onPlanChange` | `(plan: Plan) => void` | Колбэк при изменении плана (опционально) |

## Демо-приложение для отладки

Демо находится в `components/plan-manager/web/`. Запуск:

```bash
cd components/plan-manager/web
npm install
npm run dev -- --port 5173
# Открывает http://localhost:5173
```

В демо используется mock-данные для демонстрации функциональности UI без необходимости подключения к реальному backend API.

## Интеграция с PlanManager Backend

Для реального использования замените mock-загрузку на вызов PlanManager:

```tsx
import { PlanManager } from '../../src/plan-manager.js';

const pm = new PlanManager({ plansDir: '/path/to/plans' });

async function loadPlan(planId: string) {
  return await pm.loadPlan(planId);
}
```

## Типы данных

Типы определены в `types.ts`:
- `Plan` — план с шагами
- `PlanStep` — шаг плана с поддержкой вложенности
- `StepStatus` — статусы шагов (pending, in_progress, done, blocked)
- `PlanStatus` — статусы планов (planning, approved, executing, completed, archived)
