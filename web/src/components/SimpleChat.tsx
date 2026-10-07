import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentInfo, ClientApi, Handoff, Message, ServerMsg } from "../api";
import { MessageRow } from "./MessageRow";

export interface SimpleChatProps {
  ctxId: string;
  api: ClientApi;
  agents: AgentInfo[];
  agentName: (id: string) => string;
  onBack?: () => void;
}

export function SimpleChat({ ctxId, api, agents, agentName, onBack }: SimpleChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [pendingHandoff, setPendingHandoff] = useState<Handoff | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.send({ type: "load_context", ctxId });
  }, [api, ctxId]);

  const handleMsg = useCallback((msg: ServerMsg) => {
    if (msg.type === "message") {
      setMessages((prev) => [...prev, msg.message]);
    } else if (msg.type === "context_loaded") {
      setMessages(msg.messages);
    } else if (msg.type === "run_start") {
      setRunningAgentId(msg.agentId);
    } else if (msg.type === "run_end") {
      if (runningAgentId) setRunningAgentId(null);
    } else if (msg.type === "handoff_pending") {
      setPendingHandoff(msg.handoff);
    } else if (msg.type === "handoff_cancelled" || msg.type === "handoff") {
      setPendingHandoff(null);
    } else if (msg.type === "delta") {
      setMessages((m) => {
        const last = m[m.length - 1];
        // Временный пузырь: текст с «…» или пустой текст с идущими размышлениями
        if (last?.role === "assistant" && last.agentId === msg.agentId && (last.text.endsWith("…") || (last.text === "" && !!last.thinking))) {
          const copy = [...m];
          copy[m.length - 1] = { ...last, text: last.text === "" ? msg.text + "…" : last.text.slice(0, -1) + msg.text + "…" };
          return copy;
        }
        return [...m, { role: "assistant", agentId: msg.agentId, text: msg.text + "…", ts: Date.now() }];
      });
    }
  }, [runningAgentId]);

  useEffect(() => {
    api.onMessage(handleMsg);
  }, [api, handleMsg]);

  // Auto-scroll
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const [input, setInput] = useState("");

  const activeAgentName = agents.find((a) => a.id === "flow-manager")?.name ?? "Менеджер потока";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 p-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
            >
              ← Чат
            </button>
          )}
          <h2 className="text-sm font-bold text-slate-200">Анализ с flow-manager</h2>
        </div>
        <p className="text-xs text-slate-500">Активный агент: {activeAgentName}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((m, i) => (
          <MessageRow
            key={i}
            m={m}
            index={i}
            streaming={runningAgentId !== null}
            agentName={agentName}
            onImageClick={() => {}}
            onTruncate={() => {}}
            notify={() => {}}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="border-t border-slate-800 p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim()) {
                  api.send({ type: "message", ctxId, text: input });
                  setInput("");
                }
              }
            }}
            placeholder="Сообщение для flow-manager..."
            rows={3}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => {
              if (input.trim()) {
                api.send({ type: "message", ctxId, text: input });
                setInput("");
              }
            }}
            disabled={!input.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Отправить
          </button>
        </div>
      </div>
    </div>
  );
}