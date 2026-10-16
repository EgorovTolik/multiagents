# Рефакторинг: Разбить runner.ts на модули

**Статус:** запланировано  
**Приоритет:** высокий  
**Сложность:** средняя/высокая  
**Зависимости:** нет

## Обоснование

`server/src/runner.ts` — 1797 строк кода, содержащий слишком много ответственности: мьютекс, очередь, handoff между агентами, watchdog, восстановление цепочки, регистрация провайдеров и моделей, миграция конфигов, инжиниринг навыков. Это затрудняет понимание, тестирование и поддержку.

## Детальное описание работ

### 1. Выделить MutexManager
- Создать `server/src/mutex.ts`
- Перенести логику глобального мьютекса: `acquireAgent()`, `releaseAgent()`
- Перенести очереди ожидания: `agentBusy`, `agentWaiters`
- Публичный API: `acquire(agentId, ctxId)`, `release(agentId)`

### 2. Выделить RecoveryEngine
- Создать `server/src/recovery.ts`
- Перенести логику восстановления цепочки:
  - `detectIncompleteTask()` — обнаружение незавершённых задач
  - `buildRecoveryPrompt()` — промпт для оркестратора при обрыве
  - `buildRouterPrompt()` — промпт для chain-router
  - `buildRouterFallbackPrompt()` — fallback-промпт
  - `buildAutoRecoveryPrompt()` — автоматическое восстановление
- Перенести конфигурацию: `RECOVERY_MODE`, `MAX_RECOVERIES`
- Публичный API: `handleBrokenChain(ctx, agentId, task, lastMsg)`, `shouldRecover(ctx)`

### 3. Выделить ProviderRegistry
- Создать `server/src/providers.ts`
- Перенести логику регистрации провайдеров и моделей:
  - `registerProjectProviders()`
  - `fetchProviderModels()`
  - `registerProviderModels()`
  - `ensureModelRegistered()`
  - `correctAgentModels()`
- Перенести кэш: `knownModelIds`
- Публичный API: `registerProviders(modelRuntime, providers)`, `ensureModel(spec)`

### 4. Выделить SkillInjector
- Создать `server/src/skills-injector.ts`
- Перенести логику инъекции навыков в промпт агента
- Публичный API: `injectSkills(ctx, agentId, text)`

### 5. Выделить QueueManager (опционально)
- Перенести обработку очереди сообщений: `queue`, `dispatchQueue()`, `emitQueued()`
- Можно объединить с MutexManager или оставить в AgentRunner

### 6. Обновить AgentRunner
- В `runner.ts` оставить только оркестрацию:
  - `handleMessage()` — входная точка
  - `run()` — запуск хода агента (вызывает MutexManager, SkillInjector, RecoveryEngine)
  - Инициализация и координация всех модулей
- Размер AgentRunner: не более 400-500 строк

### 7. Обновить index.ts
- Импорт обновлённых модулей
- Инициализация в правильном порядке (ProviderRegistry перед AgentRunner)

## Критерии готовности

- [ ] `runner.ts` разбит на отдельные файлы
- [ ] Каждый модуль имеет чёткий публичный API с документацией
- [ ] Размер `runner.ts` ≤ 500 строк
- [ ] Все существующие функции работают (ручной тест через UI)
- [ ] Нет регрессий в поведении системы

## Риски

- Изменение порядка инициализации может сломать работу провайдеров
- Циклические зависимости между модулями (следить за импортами)
- Потеря контекста при разделении Map'ов состояния
