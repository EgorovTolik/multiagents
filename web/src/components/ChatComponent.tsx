import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentInfo, ClientApi, ContextMeta, Handoff, Message, SkillInfo } from "../api";
import { ChatHeader } from "./ChatHeader";
import { MessageRow } from "./MessageRow";
import { InputArea, type AttachedFile } from "./InputArea";

export interface ChatComponentProps {
  /** ID активного контекста */
  ctxId: string;
  /** Метаданные контекста для хедера */
  context: ContextMeta;
  /** Список всех агентов (для названий) */
  agents: AgentInfo[];
  /** API-клиент WebSocket */
  api: ClientApi;
  /** Сообщения для отображения */
  messages: Message[];
  /** Активная цепочка выполнения в этом чате (agentId или null) */
  runningAgentId: string | null;
  /** Ожидающая передача управления */
  pending: Handoff | null;
  /** ID агента, который занят в другом чате (если этот чат ждёт) */
  waitingAgentId?: string | null;
  /** Доступные навыки */
  skills: SkillInfo[];
  /** Применённые навыки */
  appliedSkills: string[];
  /** Текст ввода (controlled) */
  input: string;
  onInputChange: (value: string) => void;
  /** Временное состояние "отправлено" */
  sentText: string | null;
  setSentText: (value: string | null) => void;
  /** Прикреплённые файлы (controlled) */
  attachedFiles: AttachedFile[];
  setAttachedFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>;

  /** Колбэк добавления файлов */
  onAddFiles: (files: FileList | File[]) => void;
  /** Колбэк для отправки сообщения */
  onSend: (text: string, files?: AttachedFile[]) => void;
  /** Колбэк применения навыков */
  onApplySkills: (ids: string[]) => void;
  /** Колбэк отмены передачи */
  onCancelHandoff: () => void;
  /** Колбэк прерывания выполнения */
  onAbort: () => void;
  /** Сигнал, что агент ответил — сбрасывает состояние "отправлено" */
  onAgentResponseReceived?: () => void;
  /** Опциональный колбэк закрытия сессии (кнопка в хедере) */
  onClose?: () => void;
  /** Показывать ли информацию об агенте в хедере */
  showAgentInfo?: boolean;
}

export function ChatComponent({
  ctxId,
  context,
  agents,
  api,
  messages,
  runningAgentId,
  pending,
  waitingAgentId,
  skills,
  appliedSkills,
  input,
  onInputChange,
  sentText,
  setSentText,
  attachedFiles,
  setAttachedFiles,
  onAddFiles,
  onSend,
  onApplySkills,
  onCancelHandoff,
  onAbort,
  onClose,
  showAgentInfo = true,
}: ChatComponentProps) {
  // ─── Внутреннее состояние компонента (только для UI/скролла) ──────────────
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  // Refs для скролла
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Имя агента по ID ─────────────────────────────────────────────────────
  const agentName = useCallback(
    (id: string) => agents.find((a) => a.id === id)?.name ?? id,
    [agents],
  );

  // ─── Определение индекса стримящегося сообщения ──────────────────────────
  const lastMsg = messages[messages.length - 1];
  const streamingIdx = useMemo(() => {
    if (!runningAgentId) return -1;
    if (lastMsg?.role === "assistant" && lastMsg.agentId === runningAgentId) {
      if (lastMsg.text.endsWith("…") || (lastMsg.text === "" && !!lastMsg.thinking)) {
        return messages.length - 1;
      }
    }
    return -1;
  }, [messages, runningAgentId, lastMsg]);

  // ─── Логика скролла ──────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && isAtBottom) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, runningAgentId, autoScroll, isAtBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setIsAtBottom(atBottom);
    if (atBottom) setAutoScroll(true);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setAutoScroll(true);
    setIsAtBottom(true);
  }, []);



  // ─── Отправка сообщения ──────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const text = input.trim();
    if ((!text && attachedFiles.length === 0) || sentText !== null) return;
    if (api.status !== "connected") return;
    setSentText(text || "(файл)");
    onSend(text || "Посмотри на файл", attachedFiles.length > 0 ? attachedFiles : undefined);
    onInputChange("");
    setAttachedFiles([]);
  }, [input, attachedFiles, sentText, api.status, onSend, onInputChange, setAttachedFiles]);

  // ─── Уведомления об ошибках (локальные) ──────────────────────────────────
  const [errors, setErrors] = useState<string[]>([]);
  const handleTruncate = useCallback((idx: number) => {
    if (!confirm("Удалить историю начиная с этого сообщения?")) return;
    // Отправка команды через props callback или напрямую через api
    api.send({ type: "truncate_history", ctxId, fromIndex: idx });
  }, [ctxId, api]);

  // Обработка WS-ошибок для этого чата (через api.onMessage — если поддерживается)
  useEffect(() => {
    const handler = (msg: any) => {
      if (msg.type === "error" && msg.ctxId === ctxId) {
        setErrors((e) => [...e, msg.message]);
        setTimeout(() => setErrors((e) => e.slice(1)), 5000);
      }
    };
    // Подписка через api (если есть onMessage), иначе ошибки обрабатываются в App
    if (typeof api.onMessage === "function") {
      api.onMessage(handler as any);
    }
    return () => {};
  }, [ctxId, api]);

  // ─── Рендер ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Drag & Drop overlay */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-indigo-500/10 backdrop-blur-sm">
          <div className="rounded-xl border-2 border-dashed border-indigo-400 bg-slate-900/80 px-8 py-6 text-center">
            <p className="text-2xl">📎</p>
            <p className="mt-2 text-sm font-medium text-indigo-300">Отпустите файл</p>
          </div>
        </div>
      )}

      <ChatHeader
        ctx={context}
        running={runningAgentId ? { ctxId, agentId: runningAgentId } : null}
        pending={pending}
        wsStatus={api.status}
        onOpenSidebar={() => {}}
        onCancelHandoff={onCancelHandoff}
        onAbort={onAbort}
        onClose={onClose}
        showAgentInfo={showAgentInfo}
        agentName={agentName}
      />

      {/* Pending handoff banner */}
      {pending && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs text-amber-300">
          ⏳ Запланирована передача: {agentName(pending.from)} → {agentName(pending.to)} — {pending.reason}
        </div>
      )}

      {/* Messages area */}
      <div
        className="relative flex-1 min-h-0"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) onAddFiles(e.dataTransfer.files); }}
      >
        <div className="h-full overflow-y-auto px-3 py-3 sm:px-5 sm:py-4" ref={scrollRef} onScroll={onScroll}>
          {messages.map((m, i) => (
            <MessageRow
              key={i}
              m={m}
              index={i}
              streaming={i === streamingIdx}
              agentName={agentName}
              onImageClick={() => {}}
              onTruncate={handleTruncate}
              notify={() => {}}
            />
          ))}
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-slate-600">
              Напиши сообщение — диалог начнётся с оркестратора
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Scroll-to-bottom button */}
        <button
          onClick={scrollToBottom}
          className={`absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-600 bg-slate-800/90 text-slate-300 shadow-lg backdrop-blur transition-all duration-300 hover:bg-slate-700 hover:text-white sm:right-5 ${
            isAtBottom ? "pointer-events-none translate-y-2 opacity-0" : "translate-y-0 opacity-100"
          }`}
          title="К последнему сообщению"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </button>
      </div>

      {/* Waiting agent banner */}
      {waitingAgentId && (
        <div className="border-t border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs text-sky-300">
          ⏳ {agentName(waitingAgentId)} занят в другом чате — ход начнётся после освобождения…
        </div>
      )}

      {/* Error banner */}
      {errors.length > 0 && (
        <div className="border-t border-slate-800 px-3 py-1 text-xs text-rose-400 sm:px-4">{errors[errors.length - 1]}</div>
      )}

      {/* Input area */}
      <InputArea
        input={input}
        onInputChange={onInputChange}
        onSend={handleSend}
        onAddFiles={onAddFiles}
        attachedFiles={attachedFiles}
        onRemoveFile={(i) => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
        placeholder={`Сообщение для: ${agentName(context.activeAgentId)}`}
        disabled={(input.trim() === "" && attachedFiles.length === 0) || sentText !== null || api.status !== "connected"}
        sentText={sentText}
        skills={skills}
        appliedSkills={appliedSkills}
        onApplySkills={onApplySkills}
        skillsDisabled={api.status !== "connected"}
      />
    </div>
  );
}
