import { useCallback, useEffect } from "react";
import type { Message, ServerMsg } from "../api";

/** Общий хук для обработки WS-сообщений чата (стриминг, ошибки). */
export function useChatMessages(
  ctxId: string | null,
  setMessages: (msgs: Message[]) => void,
  onError: (msg: string) => void,
  onStatus?: (status: "typing" | null) => void,
) {
  const handler = useCallback((msg: ServerMsg) => {
    if (msg.type === "delta") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.agentId === msg.agentId && !last.completed) {
          return [...prev.slice(0, -1), { ...last, text: last.text + msg.text }];
        }
        return [...prev, { role: "assistant", agentId: msg.agentId, text: msg.text, ts: Date.now() }];
      });
    } else if (msg.type === "thinking_delta") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.agentId === msg.agentId) {
          return [...prev.slice(0, -1), { ...last, thinking: (last.thinking || "") + msg.text }];
        }
        return prev;
      });
    } else if (msg.type === "assistant_end") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.agentId === msg.agentId) {
          return [...prev.slice(0, -1), { ...last, completed: true }];
        }
        return prev;
      });
      if (onStatus) onStatus(null);
    } else if (msg.type === "error") {
      onError(msg.message);
      if (onStatus) onStatus(null);
    }
  }, [setMessages, onError, onStatus]);

  useEffect(() => {
    return () => {}; // cleanup на случай подписки
  }, [ctxId]);

  return handler;
}