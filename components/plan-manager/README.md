# PlanManager

Модуль для управления файлами планов в системе multiagents. Обеспечивает создание, загрузку, сохранение, модификацию и разрешение вложенных подпланов. Работает с JSON-файлами внутри директории контекста.

## Структура файлов

```
components/plan-manager/
├── src/
│   └── plan-manager.js    # Основная реализация (PlanManager, Plan, PlanStep)
├── tests/
│   └── plan-manager.test.js  # Unit-тесты (23 сценария)
├── package.json
└── README.md
```

## API

### Создание плана
```javascript
import { PlanManager } from './src/plan-manager.js';

const pm = new PlanManager({ ctxDir: '/path/to/contexts/<ctxId>' });
const plan = await pm.createPlan({
  title: 'Реализация API авторизации',
  description: 'План разработки модуля авторизации',
  createdBy: 'orchestrator'
});
```

### Загрузка и сохранение
```javascript
const loaded = await pm.loadPlan(plan.id);
await pm.savePlan(plan);
```

### Работа с шагами
```javascript
// Добавить шаг
const step = await pm.addStep(plan, 'Реализовать роуты');

// Добавить подзадачу
const subtask = await pm.addSubtask(plan, step.id, 'Создать тесты');

// Обновить статус
await pm.updateStepStatus(plan, step.id, 'in_progress');

// Найти шаг (рекурсивно, включая вложенные подпланы)
const found = await pm.findStepById(plan, step.id);

// Удалить шаг
await pm.removeStep(plan, step.id);
```

### Привязка файлов
```javascript
await pm.attachTaskFile(plan, step.id, 'tasks/auth-routes.md');
await pm.attachResultFile(plan, step.id, 'results/auth-done.md');
```

### Вложенные подпланы
```javascript
// Создать и встроить подплан
const subplan = await pm.createPlan({ title: 'Детальный план', createdBy: 'user' });
await pm.embedSubplan(plan, step.id, subplan);

// Загрузить все вложенные подпланы
const nested = await pm.resolveNestedPlans(plan);

// Прогресс выполнения (включая вложенные)
const progress = await pm.getOverallProgress(plan);
// { done: 5, total: 12, percent: 41.7 }
```

### Активный план контекста
```javascript
await pm.setActivePlan(ctxId, plan.id);
const activePlan = await pm.getActivePlan(ctxId);
```

### Валидация
```javascript
// Проверка плана
if (plan.isValid()) { /* ... */ }
const errors = plan.getValidationErrors();

// Проверка шага
if (step.isValid()) { /* ... */ }
```

## Тестирование

```bash
cd components/plan-manager
npm install
npm test            # Запустить все тесты
npm run test:watch  # Режим watch
```

Покрытие: 23 unit-теста покрывают все сценарии из спецификации `docs/plan-manager-spec.md`:
- Создание, загрузка, сохранение планов
- Обновление статусов шагов
- Добавление и удаление подзадач
- Привязка файлов заданий и результатов
- Встраивание вложенных подпланов
- Рекурсивный поиск шагов и расчет прогресса
- Интеграция с context-store (active plan)
- Валидация планов и шагов

## Файловая структура данных

```
contexts/<ctxId>/
├── context.json              # Конфигурация контекста (activePlanId)
└── plans/
    ├── <plan-id>.json        # Основной план
    └── <subplan-id>.json     # Вложенный подплан
```
