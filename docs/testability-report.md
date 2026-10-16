# Анализ тестируемости кодовой базы сервера Multiagents

## Общая оценка: **6/10** (средняя)

Код написан в чистом TypeScript без фреймворков, что даёт хорошую базу для тестирования. Однако есть проблемы с архитектурой, которые усложняют написание unit-тестов — особенно для `runner.ts`.

---

## Анализ по модулям

### 1. `utils.ts` (50 строк) — **9/10 (отлично)**

```typescript
// Чистые функции без зависимостей
export function validateParam(value: string): boolean { ... }
export function parseModelList(data: any): string[] { ... }
```

**Плюсы:**
- Все функции чистые — только входные параметры, нет side-effects
- Нет зависимостей (только stdlib `fs` и `path`)
- Легко тестировать на различных input/output парах

**Минусы:**
- `parseModelList` использует `any` для параметра — сложнее типизировать тестовые данные
- Файловые функции (`readMarkdownDir`, `syncMarkdownDir`) требуют mock'а `fs`

**Тестируемость:** Прямое написание unit-тестов без каких-либо mock'ов (для чистых функций).

---

### 2. `registry.ts` (162 строки) — **8/10 (хорошо)**

```typescript
export class AgentRegistry {
  private agents = new Map<string, AgentDef>();
  constructor(private agentsDir: string) { this.reload(); }
  reload() { ... } // читает с диска
  get(id: string) { return this.agents.get(id); }
  list() { return [...this.agents.values()]; }
  create(params: NewAgentParams): AgentDef { ... } // пишет на диск
}
```

**Плюсы:**
- Классический CRUD — все операции имеют чёткие границы
- Конструктор принимает путь к директории (инъекция через параметр)
- Внутреннее состояние (`Map`) легко проверяется через `get()` и `list()`

**Минусы:**
- Файловые операции разбросаны по методам — нужно mock'овать `fs` целиком
- Метод `reload()` читает с диска каждый раз — нет контроля кэширования в тестах
- Нет инъекции зависимостей для файловой системы (например, через интерфейс `FileSystem`)

**Тестируемость:** Хорошо тестируется через mock'а `fs` (`vi.mock("node:fs")`). Можно создать временную директорию для каждого теста.

---

### 3. `skill-registry.ts` (201 строка) — **8/10 (хорошо)**

```typescript
export class SkillRegistry {
  constructor(private skillsDir: string) { this.reload(); }
  get(id: string): SkillDef | undefined { ... } // читает с диска
  create(id: string, params: SkillParams): SkillDef { ... }
}
```

**Плюсы:**
- Аналогично `registry.ts` — классический CRUD
- Чёткие границы операций
- Простая структура данных (Map)

**Минусы:**
- Метод `get()` читает с диска каждый раз вместо возврата из кэша — сложно тестировать поведение кэширования
- Файловые операции не изолированы в отдельный модуль

**Тестируемость:** Аналогично registry.ts — mock'ование `fs` + временные директории.

---

### 4. `context-store.ts` (389 строк) — **7/10 (хорошо)**

```typescript
export class ContextStore {
  constructor(private root: string, private defaultAgent: string) { ... }
  create(name: string): ContextMeta { ... } // создаёт директорию + JSON
  get(id: string): ContextMeta | undefined { ... } // читает JSON
  save(meta: ContextMeta) { ... } // пишет JSON
  maskPaths(ctxId: string, text: string): string { ... } // сложная логика замены путей
}
```

**Плюсы:**
- CRUD операции чётко разделены
- Методы имеют чёткие входные/выходные параметры
- Нет привязки к конкретному формату хранения (JSON)

**Минусы:**
- Сложная логика `maskPaths` — требует отдельного тестирования с множеством edge cases
- Три типа контекстов (work, training, mistakes) увеличивают количество тестовых сценариев
- Файловые операции разбросаны по методам

**Тестируемость:** CRUD хорошо тестируется. `maskPaths` требует отдельного модуля с набором test fixtures для различных форматов путей (абсолютные, относительные, markdown-ссылки и т.д.).

---

### 5. `runner.ts` (1797 строк) — **4/10 (плохо)**

```typescript
export class AgentRunner {
  private sessions = new Map<string, AgentSession>();
  private activeByCtx = new Map<string, string>();
  private agentBusy = new Map<string, string>();
  private queue: {...}[] = [];
  // ... многие внутренние состояния
  
  async run(ctxId: string, text: string) {
    // Сложная логика: мьютекс → сессия → prompt → handoff → recovery
  }
  
  buildRecoveryPrompt(agentId: string): string { ... } // чистая функция
  detectIncompleteTask(...): {...} { ... } // почти чистая функция
}
```

**Плюсы:**
- Некоторые методы являются чистыми функциями и могут тестироваться изолированно (`buildRecoveryPrompt`, `buildRouterPrompt`, `detectIncompleteTask`)
- Конструктор принимает зависимости (registry, store, skillRegistry) — хорошая основа для инъекции зависимостей
- Логика handoff/recovery имеет чёткие точки входа/выхода

**Минусы:**
- **Огромный размер** — 1797 строк в одном классе
- **Глобальное состояние** — множество Map'ов с внутренним состоянием, которые сложно контролировать в тестах
- **Зависимость от pi SDK** — `createAgentSession`, `ModelRuntime` нужно mock'овать
- **Watchdog на setInterval** — требует контроля времени в тестах (`vi.useFakeTimers()`)
- **Асинхронная логика** — Promise chaining усложняет тестирование последовательностей событий
- **Отсутствие инъекции зависимостей для файловых операций**

**Тестируемость:** Требует разделения на меньшие модули (как в `todo/refactor-runner.md`) или тщательного mock'ования pi SDK. Чистые функции (`build*Prompt`) можно тестировать прямо сейчас без изменений кода.

---

### 6. `index.ts` (922 строки) — **5/10 (средне)**

```typescript
const app = express();
app.use(express.json());

// REST API endpoints
app.get("/api/agents", (_req, res) => { ... });
app.post("/api/config", (req, res) => { ... });

// WebSocket handling
wss.on("connection", (ws) => {
  ws.on("message", async (raw) => { ... });
});
```

**Плюсы:**
- Стандартный Express API — хорошо поддерживается тестовыми инструментами (supertest)
- REST endpoints имеют чёткие входные/выходные параметры

**Минусы:**
- WebSocket логика сложно тестируется unit-тестами — требует создания реальных WS соединений или mock'ования `ws` модуля
- Смешивание HTTP и WebSocket в одном файле
- Глобальные переменные (`wss`, `app`, `server`)

**Тестируемость:** REST API хорошо тестируется через `supertest`. WebSocket — лучше интеграционные тесты, чем unit.

---

## Ключевые проблемы тестируемости

| Проблема | Модули | Влияние |
|----------|--------|---------|
| Отсутствие инъекции зависимостей для файловых операций | Все модули кроме utils.ts | Требует mock'ования `node:fs` целиком — сложно, хрупко |
| Глобальное состояние (Map'ы) | runner.ts | Трудно изолировать тесты — один тест влияет на другой |
| Огромный класс с множеством обязанностей | runner.ts (1797 строк) | Сложно понять, что именно тестируется; много edge cases |
| Зависимость от pi SDK без абстракции | runner.ts | Нужно mock'овать `createAgentSession`, `ModelRuntime` — нет стандартного способа |
| setInterval в watchdog | runner.ts | Требует `vi.useFakeTimers()` и ручного tick'а времени |
| Асинхронная логика с Promise chaining | runner.ts, index.ts | Сложно тестировать последовательности событий (например, handoff → recovery) |

---

## Рекомендации по улучшению тестируемости

### Высокий приоритет

1. **Разбить runner.ts на модули** (`todo/refactor-runner.md`)
   - Выделить `MutexManager` — легко тестируется изолированно
   - Выделить `RecoveryEngine` — чистые функции для тестирования логики восстановления
   - Выделить `ProviderRegistry` — изоляция от pi SDK

2. **Добавить интерфейсы для зависимостей от pi SDK**
   ```typescript
   interface AgentSessionFactory {
     createSession(cwd: string): Promise<AgentSession>;
   }
   
   class AgentRunner {
     constructor(private sessionFactory: AgentSessionFactory) { ... }
   }
   ```

### Средний приоритет

3. **Добавить инъекцию зависимостей для файловых операций**
   ```typescript
   interface FileSystem {
     readFileSync(path: string): string;
     writeFileSync(path: string, content: string): void;
   }
   
   class AgentRegistry {
     constructor(private fs: FileSystem, private agentsDir: string) { ... }
   }
   ```

4. **Использовать временные директории для тестов**
   - Vitest: `fs.mkdtempSync(path.join(os.tmpdir(), "test-"))` перед каждым тестом
   - Cleanup в `afterEach()` или `afterAll()`

### Низкий приоритет

5. **Добавить типизацию для API параметров** (`todo/improve-typing.md`) — упростит написание тестов с правильными входными данными

---

## Примеры того, что можно протестировать прямо сейчас (без изменений кода)

1. **utils.ts:** `validateParam`, `parseModelList` — чистые функции
2. **runner.ts:** `buildRecoveryPrompt`, `buildRouterPrompt`, `detectIncompleteTask` — почти чистые функции
3. **registry.ts/skill-registry.ts/context-store.ts:** CRUD операции через mock'а `fs`

---

## Вывод

Кодовая база имеет хорошую основу для тестирования, но требует архитектурных улучшений для полноценного покрытия unit-тестами. Критическим изменением является разделение `runner.ts` (рекомендация из `todo/refactor-runner.md`). После этого покрытие тестами может достичь 80-90%.

**Оценка по модулям:**
- utils.ts: ✅ Отлично (9/10)
- registry.ts: ✅ Хорошо (8/10)
- skill-registry.ts: ✅ Хорошо (8/10)
- context-store.ts: ⚠️ Хорошо (7/10) — сложная логика maskPaths
- index.ts: ⚠️ Средне (5/10) — REST хорошо, WebSocket плохо для unit-тестов
- runner.ts: ❌ Плохо (4/10) — требует рефакторинга
