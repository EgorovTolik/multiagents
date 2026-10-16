# Улучшить типизацию: заменить any на интерфейсы

**Статус:** запланировано  
**Приоритет:** средний  
**Сложность:** средняя  
**Зависимости:** нет

## Обоснование

В коде обильно используется `any` и ручная обработка JSON без валидации типов. Это приводит к ошибкам, которые обнаруживаются только в рантайме, а не на этапе компиляции. TypeScript теряет свою основную ценность.

## Детальное описание работ

### 1. Определить типы WS-сообщений
**Файл:** `server/src/ws-types.ts` (новый)

```typescript
// Client → Server
export type WsClientMessage =
  | { type: "message"; ctxId: string; text: string; files?: FileAttachment[] }
  | { type: "create_context"; name?: string }
  | { type: "delete_context"; ctxId: string }
  | { type: "load_context"; ctxId: string }
  | { type: "rename_context"; ctxId: string; name: string }
  | { type: "abort"; ctxId: string }
  | { type: "cancel_handoff"; ctxId: string }
  | { type: "list_contexts" }
  | { type: "prepare_archive"; ctxId: string }
  | { type: "apply_skills"; ctxId: string; skills: string[] }
  | { type: "truncate_history"; ctxId: string; fromIndex: number };

// Server → Client
export type WsServerMessage =
  | { type: "agents"; agents: AgentDef[] }
  | { type: "contexts"; contexts: ContextMeta[] }
  | { type: "message"; ctxId: string; message: Message }
  | { type: "delta"; ctxId: string; agentId: string; text: string }
  | { type: "run_start"; ctxId: string; agentId: string }
  // ... и т.д.
```

### 2. Типизировать обработку WS-сообщений в index.ts
**Файл:** `server/src/index.ts`

Заменить:
```typescript
let msg: any;
try { msg = JSON.parse(String(raw)); } catch { return; }
switch (msg.type) { ... }
```

На:
```typescript
const parsed = JSON.parse(String(raw)) as WsClientMessage;
switch (parsed.type) { ... }
```

### 3. Типизировать параметры API
**Файл:** `server/src/api-types.ts` (новый)

Определить типы body и query параметров для всех REST-эндпоинтов:
- `/api/agents/:id` — PUT params
- `/api/config` — PUT params
- `/api/skills` — POST params
- И т.д.

### 4. Заменить any на конкретные типы в runner.ts
**Файл:** `server/src/runner.ts`

Основные места:
- `private queue: { ctxId: string; text: string; files?: FileAttachment[] }[]` — уже типизировано, хорошо
- `private sessions = new Map<string, AgentSession>()` — уже типизировано
- Проверить все `any` и заменить на конкретные типы или `unknown` с проверками

### 5. Типизировать обработку ошибок
Заменить:
```typescript
catch (e: any) { ... }
```
На:
```typescript
catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  ...
}
```

### 6. Добавить strict mode в tsconfig
**Файл:** `server/tsconfig.json` и `web/tsconfig.json`

Убедиться, что включено:
```json
{
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "strictFunctionTypes": true,
  "strictBindCallApply": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true
}
```

Исправить все ошибки, которые появятся после включения.

### 7. Типизировать фронтенд API клиент
**Файл:** `web/src/api.ts`

Убедиться, что все WS-сообщения типизированы соответствующими интерфейсами из `server/src/ws-types.ts`.

## Критерии готовности

- [ ] Определены типы для всех WS-сообщений (client → server и server → client)
- [ ] Типы экспортированы и используются в index.ts и api.ts
- [ ] Минимизировано использование `any` (максимум 3-5 мест с обоснованием)
- [ ] Включён strict mode TypeScript
- [ ] `npm run build` проходит без ошибок типизации
- [ ] Все API endpoint'ы имеют типизированные параметры

## Риски

- Строгий режим TypeScript может выявить множество скрытых ошибок (null/undefined), которые нужно исправить
- Изменение сигнатур функций может потребовать обновления вызывающего кода
- Потеря производительности при компиляции (не критично для этого размера проекта)
