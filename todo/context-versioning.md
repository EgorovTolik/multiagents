# Ввести versioning контекстов и миграции схемы

**Статус:** запланировано  
**Приоритет:** средний  
**Сложность:** средняя  
**Зависимости:** нет

## Обоснование

Контексты хранятся как JSON/JSONL файлы на диске без versioning. Изменение структуры `context.json` (например, добавление нового поля) требует ручного обновления всех существующих контекстов или приводит к ошибкам при чтении старых данных. Это критично для долгосрочной поддержки системы.

## Детальное описание работ

### 1. Определить схему контекста с versioning
**Файл:** `server/src/context-schema.ts` (новый)

```typescript
export interface ContextV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  activeAgentId: string;
  // ... остальные поля v1
}

export interface ContextV2 {
  schemaVersion: 2;
  id: string;
  name: string;
  activeAgentId: string;
  newField: string; // новое поле в v2
  // ... остальные поля
}

export type Context = ContextV1 | ContextV2;
```

### 2. Добавить поле schemaVersion в существующие контексты
**Файл:** `server/src/context-store.ts`

В методе `create()`:
```typescript
const ctx: ContextMeta = {
  id,
  name,
  createdAt: new Date(),
  updatedAt: new Date(),
  schemaVersion: 2, // текущая версия
  activeAgentId,
  // ... остальные поля
};
```

### 3. Создать систему миграций
**Файл:** `server/src/migrations.ts` (новый)

```typescript
interface Migration {
  fromVersion: number;
  toVersion: number;
  migrate(ctx: any): ContextMeta;
}

const migrations: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    migrate(ctx) {
      // Добавить новое поле для v2
      return { ...ctx, schemaVersion: 2, newField: "default" };
    }
  }
];

export function migrateContext(ctx: any): ContextMeta {
  let current = ctx;
  const version = current.schemaVersion || 1;
  
  for (const migration of migrations) {
    if (migration.fromVersion === version) {
      current = migration.migrate(current);
    }
  }
  
  return current as ContextMeta;
}
```

### 4. Интегрировать миграции в ContextStore
**Файл:** `server/src/context-store.ts`

В методе `get()`:
```typescript
get(id: string): ContextMeta | undefined {
  const ctx = this.readFromFile(id);
  if (!ctx) return undefined;
  
  // Мигрировать, если версия устарела
  if (ctx.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    const migrated = migrateContext(ctx);
    this.save(migrated);
    return migrated;
  }
  
  return ctx;
}
```

### 5. Написать миграцию для существующих контекстов
**Файл:** `server/src/migrations/v1-to-v2.ts`

Создать скрипт, который:
- Находит все контексты со старыми схемами
- Применяет миграции
- Сохраняет обновлённые файлы
- Логгирует процесс

```bash
npm run migrate-contexts
```

### 6. Обновить API для получения информации о версии
**Файл:** `server/src/index.ts`

Добавить endpoint:
```typescript
app.get("/api/schema-version", (_req, res) => {
  res.json({ version: CURRENT_SCHEMA_VERSION });
});
```

## Критерии готовности

- [ ] Определена схема контекста с полем `schemaVersion`
- [ ] Реализована система миграций (`migrations.ts`)
- [ ] Миграции автоматически применяются при чтении устаревших контекстов
- [ ] Написана миграция v1 → v2 (если актуально)
- [ ] Создан скрипт командной строки для ручных миграций
- [ ] Все существующие контексты мигрированы на последнюю версию

## Риски

- Миграции могут сломать старые контексты при ошибках реализации
- Обратная совместимость: новые версии кода должны читать старые схемы
- Производительность: проверка и миграция при каждом чтении (минимизировать)
