# PlanManager

Модуль для управления файлами планов в системе multiagents. Обеспечивает создание, загрузку, сохранение, модификацию и разрешение вложенных подпланов. Работает с JSON-файлами внутри директории контекста.

## Архитектура

Компонент спроектирован по принципу **Single Responsibility Principle**:
- Принимает готовый путь к директории планов (`plansDir`)
- Не знает о структуре директорий контекстов multiagents
- Не зависит от ContextStore или других модулей системы
- Самодостаточный и тестируемый без привязки к основной системе

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

### Инициализация
```javascript
import { PlanManager } from './src/plan-manager.js';

// Принимает готовый путь к директории планов
const pm = new PlanManager({ plansDir: '/path/to/plans' });
```

### Создание плана
```javascript
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

**Кэширование подпланов:** при загрузке плана с `planFile` подпланы автоматически загружаются и кэшируются в поле `step.plan`. Последующие операции (`findStepById`, `resolveNestedPlans`) используют кэш, не читая файлы с диска. Это оптимизирует производительность при частых операциях.

**Сброс кэша:** если планы были изменены другим процессом и нужно перечитать их с диска:
```javascript
pm.resetCache(plan);  // Рекурсивно обнуляет поле step.plan во всех шагах
// При последующих операциях планы будут перечитаны с диска
```

### Активный план (внешняя ответственность)
Управление активным планом — задача внешнего кода, не PlanManager:
```javascript
import { ContextStore } from './path/to/context-store.js';
const store = new ContextStore('/path/to/contexts');
await store.setActivePlanId('plan-xyz');
const activeId = await store.getActivePlanId();
const plan = await pm.loadPlan(activeId);
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
├── context.json              # Конфигурация контекста (управляется внешним кодом)
└── plans/
    ├── <plan-id>.json        # Основной план
    └── <subplan-id>.json     # Вложенный подплан
```

PlanManager работает только с директорией `plans/`. Файлы в ней создаются автоматически при первом использовании.
