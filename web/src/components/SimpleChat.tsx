import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientApi, Handoff, Message, ServerMsg } from "../api";
import { MessageRow } from "./MessageRow";

export interface SimpleChatProps {
  ctxId: string;
  api: ClientApi;
  agentName: (id: string) => string;
}

export function SimpleChat({ ctxId, api, agentName }: SimpleChatProps) {
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

  return (
    <div className="flex h-full flex-col">
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
    </div>
  );
}