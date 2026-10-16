# Логи с correlation ID для отслеживания цепочек

**Статус:** запланировано  
**Приоритет:** средний  
**Сложность:** низкая/средняя  
**Зависимости:** желательно после рефакторинга runner.ts (todo/refactor-runner.md)

## Обоснование

При отладке проблем в продакшене сложно отслеживать, к какой цепочке handoff относится конкретный лог. Все контексты пишутся в один поток логов, и при параллельных цепочках они смешиваются. Correlation ID позволяет фильтровать логи по конкретной цепочке.

## Детальное описание работ

### 1. Определить формат correlation ID
**Рекомендация:** использовать UUID v4 для каждой новой цепочки (пользовательское сообщение).

```typescript
import { randomUUID } from "node:crypto";

// При получении сообщения пользователя
const correlationId = randomUUID();
console.log(`[${correlationId}] User message received in context ${ctxId}`);
```

### 2. Генерировать correlation ID при создании цепочки
**Файл:** `server/src/runner.ts` (или новый модуль)

При получении сообщения пользователя от оркестратора:
```typescript
async handleMessage(ctxId: string, text: string, files?: FileAttachment[]) {
  const correlationId = randomUUID();
  
  // Передаём correlationId во все вызовы run()
  await this.run(ctxId, text, files, correlationId);
}
```

### 3. Использовать correlation ID в логах
Во всех ключевых точках системы добавить correlation ID:

```typescript
// При handoff
console.log(`[${correlationId}] Handoff: ${fromAgent} → ${toAgent}`);

// При восстановлении цепочки
console.log(`[${correlationId}] Chain broken, recovery triggered`);

// При завершении хода агента
console.log(`[${correlationId}] Agent run completed: ${agentId}`);

// Ошибки
console.error(`[${correlationId}] Error in agent run:`, error);
```

### 4. Сохранять correlation ID в контексте
Добавить поле `currentCorrelationId` в `ContextMeta`:
```typescript
interface ContextMeta {
  // ... существующие поля
  currentCorrelationId?: string;
}
```

Это позволит отслеживать цепочку даже после перезапуска сервера.

### 5. Добавить correlation ID в API-логирование
Для REST-эндпоинтов добавить logging middleware:
```typescript
import { randomUUID } from "node:crypto";

app.use((req, res, next) => {
  const reqId = randomUUID();
  req.id = reqId;
  console.log(`[${reqId}] ${req.method} ${req.url}`);
  
  res.on("finish", () => {
    console.log(`[${reqId}] ${res.statusCode} in ${Date.now() - startTime}ms`);
  });
  
  next();
});
```

### 6. Форматировать логи для удобной фильтрации
Использовать структурированный формат (JSON) или стандартный логгер:

**Вариант A — JSON:**
```bash
{"ts":"2025-10-16T14:30:00Z","corrId":"abc-123","ctxId":"chat-1","level":"info","msg":"Handoff"}
```

**Вариант B — Winston/Pino:**
Добавить `pino` или `winston` для структурированных логов.

### 7. Документировать использование
**Файл:** `docs/correlation-id.md` (новый)

Описать:
- Как генерируется correlation ID
- Где используется в логах
- Как фильтровать логи: `grep "corrId-abc-123" server.log`

## Критерии готовности

- [ ] Correlation ID генерируется для каждой цепочки handoff
- [ ] Все ключевые лог-события содержат correlation ID
- [ ] Correlation ID сохраняется в контексте (опционально)
- [ ] API запросы имеют reqId в логах
- [ ] Документация по использованию написана

## Риски

- Увеличение объёма логов (не критично)
- Потеря correlation ID при переходе между модулями (нужна передача через параметры)
