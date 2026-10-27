import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientApi, Message, SkillInfo } from "../api";
import { ChatHeader } from "./ChatHeader";
import { MessageRow } from "./MessageRow";
import { InputArea, type AttachedFile } from "./InputArea";

export interface FlowManagerChatProps {
  ctxId: string;
  api: ClientApi;
  messages: Message[];
  runningAgentId: string | null;
  agentName?: (id: string) => string;
  skills: SkillInfo[];
  appliedSkills: string[];
  input: string;
  onInputChange: (value: string) => void;
  sentText: string | null;
  setSentText: (value: string | null) => void;
  attachedFiles: AttachedFile[];
  setAttachedFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
  onAddFiles: (files: FileList | File[]) => void;
  onSend: (text: string, files?: AttachedFile[]) => void;
  onApplySkills: (ids: string[]) => void;
  onAbort: () => void;
}

export function FlowManagerChat({
  ctxId,
  api,
  messages,
  runningAgentId,
  agentName: propAgentName,
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
  onAbort,
}: FlowManagerChatProps) {
  // ─── Внутреннее состояние компонента (только для UI/скролла) ──────────────
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  // Refs для скролла
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Имя агента по ID — используем переданный resolver или fallback на flow-manager ──
  const defaultAgentName = useCallback((id: string) => id, []);
  const agentName = propAgentName ?? defaultAgentName;

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

  // Обработка WS-ошибок для этого чата
  useEffect(() => {
    const handler = (msg: any) => {
      if (msg.type === "error" && msg.ctxId === ctxId) {
        setErrors((e) => [...e, msg.message]);
        setTimeout(() => setErrors((e) => e.slice(1)), 5000);
      }
    };
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
        ctx={{
          id: ctxId,
          name: "Агент",
          createdAt: 0,
          activeAgentId: "flow-manager",
          handoffs: [],
        }}
        running={runningAgentId ? { agentId: runningAgentId } : null}
        pending={null}
        wsStatus={api.status}
        onOpenSidebar={() => {}}
        onCancelHandoff={() => {}}
        onAbort={onAbort}
        onClose={undefined}
        showAgentInfo={true}
        agentName={agentName}
      />

      {/* Messages area */}
      <div
        className="relative flex-1 min-h-0"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) onAddFiles(e.dataTransfer.files);
        }}
      >
        <div
          className="h-full overflow-y-auto px-3 py-3 sm:px-5 sm:py-4"
          ref={scrollRef}
          onScroll={onScroll}
        >
          {messages.map((m, i) => (
            <MessageRow
              key={i}
              m={m}
              index={i}
              streaming={i === streamingIdx}
              agentName={agentName}
              onImageClick={() => {}}
              onTruncate={() => {}}
              notify={() => {}}
            />
          ))}
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-slate-600">
              Напиши сообщение — диалог начнётся с {agentName("flow-manager")}
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
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </button>
      </div>

      {/* Error banner */}
      {errors.length > 0 && (
        <div className="border-t border-slate-800 px-3 py-1 text-xs text-rose-400 sm:px-4">
          {errors[errors.length - 1]}
        </div>
      )}

      {/* Input area */}
      <InputArea
        input={input}
        onInputChange={onInputChange}
        onSend={handleSend}
        onAddFiles={onAddFiles}
        attachedFiles={attachedFiles}
        onRemoveFile={(i) => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
        placeholder={`Сообщение для ${agentName("flow-manager")}`}
        disabled={
          (input.trim() === "" && attachedFiles.length === 0) ||
          sentText !== null ||
          api.status !== "connected"
        }
        sentText={sentText}
        skills={skills}
        appliedSkills={appliedSkills}
        onApplySkills={onApplySkills}
        skillsDisabled={api.status !== "connected"}
      />
    </div>
  );
}
