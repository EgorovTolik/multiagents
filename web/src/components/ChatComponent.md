# ChatComponent — Переиспользуемый компонент чата

Рефакторинг: вынесен из `App.tsx` в отдельный компонент для переиспользования
на странице основного чата и на странице обучения агентов (LearningPage).

## Экспортируемые типы

```typescript
import { ChatComponent, type ChatComponentProps } from "./components/ChatComponent";
```

## Props

| Prop | Тип | Описание |
|------|-----|----------|
| `ctxId` | `string` | ID активного контекста |
| `context` | `ContextMeta` | Метаданные контекста для хедера |
| `agents` | `AgentInfo[]` | Список всех агентов (для названий) |
| `api` | `ClientApi` | API-клиент WebSocket |
| `messages` | `Message[]` | Сообщения для отображения |
| `runningAgentId` | `string \| null` | ID активного агента или null |
| `pending` | `Handoff \| null` | Ожидающая передача управления |
| `waitingAgentId?` | `string \| null` | Агент, занятый в другом чате |
| `skills` | `SkillInfo[]` | Доступные навыки |
| `appliedSkills` | `string[]` | Применённые навыки |
| `input` | `string` | Текст ввода (controlled) |
| `onInputChange` | `(value: string) => void` | Колбэк изменения текста |
| `sentText` | `string \| null` | Временное состояние "отправлено" |
| `setSentText` | `(value: string \| null) => void` | Сеттер sentText |
| `attachedFiles` | `AttachedFile[]` | Прикреплённые файлы (controlled) |
| `setAttachedFiles` | `React.Dispatch<...>` | Сеттер attachedFiles |
| `onAddFiles` | `(files: FileList \| File[]) => void` | Колбэк добавления файлов |
| `onSend` | `(text: string, files?: AttachedFile[]) => void` | Колбэк отправки сообщения |
| `onApplySkills` | `(ids: string[]) => void` | Колбэк применения навыков |
| `onCancelHandoff` | `() => void` | Колбэк отмены передачи |
| `onAbort` | `() => void` | Колбэк прерывания выполнения |
| `onClose?` | `() => void` | Опциональный колбэк закрытия сессии (кнопка в хедере) |
| `showAgentInfo?` | `boolean` | Показывать ли бейдж активного агента (default: true) |

## Использование на LearningPage

```tsx
import { ChatComponent } from "./components/ChatComponent";

function LearningPage() {
  const [ctxId] = useState(generateLearningContextId());
  // ... setup API, messages, etc.

  return (
    <div className="flex h-dvh bg-slate-950 text-slate-200">
      <aside>...</aside>
      <ChatComponent
        ctxId={ctxId}
        context={learningContext}
        agents={agents}
        api={api}
        messages={messages}
        runningAgentId={running?.agentId ?? null}
        pending={pending}
        skills={skills}
        appliedSkills={appliedSkills}
        input={input}
        onInputChange={setInput}
        sentText={sentText}
        setSentText={setSentText}
        attachedFiles={attachedFiles}
        setAttachedFiles={setAttachedFiles}
        onAddFiles={addFiles}
        onSend={(text, files) => api.send({ type: "message", ctxId, text, files })}
        onApplySkills={applySkills}
        onCancelHandoff={() => api.send({ type: "cancel_handoff", ctxId })}
        onAbort={() => api.send({ type: "abort", ctxId })}
        onClose={handleCloseLearningSession}  // кнопка "Завершить сессию"
        showAgentInfo={false}                  // скрыть бейдж агента на странице обучения
      />
    </div>
  );
}
```

## Инкапсулированная логика

Компонент сам управляет:
- Автоматический скролл к последнему сообщению
- Кнопка "К последнему сообщению" (появляется при прокрутке вверх)
- Drag & Drop файлов с overlay
- Определение индекса стримящегося сообщения
- Обработку ошибок WebSocket для текущего контекста
