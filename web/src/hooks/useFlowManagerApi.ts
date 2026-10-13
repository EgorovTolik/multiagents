import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientApi, Message, ServerMsg } from "../api";

interface UseFlowManagerApiOptions {
  api: ClientApi;
  analyzedCtxId: string;
}

export function useFlowManagerApi({ api, analyzedCtxId }: UseFlowManagerApiOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [flowMessages, setFlowMessages] = useState<Message[]>([]);
  const [flowRunning, setFlowRunning] = useState(false);

  // Отдельное WebSocket подключение для flow-manager коммуникации
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.hostname}:3000`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("FlowManager WS connected");
      };

      ws.onclose = () => {
        console.log("FlowManager WS disconnected, reconnecting...");
        if (!closed) timer = setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        console.error("FlowManager WS error:", err);
      };

      ws.onmessage = (ev) => {
        try {
          const msg: ServerMsg = JSON.parse(ev.data);
          const currentSessionId = sessionIdRef.current;

          // Фильтрация по ctxId mistakes session
          if (
            !currentSessionId ||
            typeof msg !== "object" ||
            !("ctxId" in msg) ||
            msg.ctxId !== currentSessionId
          ) {
            return;
          }

          if (msg.type === "message") {
            setFlowMessages((prev) => [...prev, msg.message]);
          } else if (msg.type === "run_start") {
            setFlowRunning(true);
          } else if (msg.type === "assistant_end") {
            setFlowRunning(false);
          } else if (msg.type === "delta") {
            setFlowMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== "assistant") {
                return [...prev, { role: "assistant", agentId: msg.agentId, text: msg.text, ts: Date.now() }];
              } else {
                const updated = { ...last, text: last.text + msg.text };
                return [...prev.slice(0, -1), updated];
              }
            });
          }
        } catch (e) {
          console.error("FlowManager WS message parse error:", e);
        }
      };
    }

    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  const loadExistingSession = useCallback(async (): Promise<string | null> => {
    try {
      // GET endpoint: find existing or create new
      const response = await fetch(`/api/work-on-mistakes/sessions/${analyzedCtxId}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      setSessionId(data.id);

      // If existing session was found, load its messages
      if (data.found) {
        try {
          const msgsResponse = await fetch(`/api/contexts/${data.id}/messages`);
          if (msgsResponse.ok) {
            const msgsData = await msgsResponse.json();
            const mapped: Message[] = (msgsData.messages || [])
              .filter((m: any) => m.agentId === "flow-manager" || m.role === "user")
              .map((m: any, i: number) => ({
                role: m.role,
                agentId: m.agentId,
                text: m.text,
                thinking: m.thinking,
                ts: m.ts || Date.now(),
                id: `msg-${i + 1}`,
              }));
            setFlowMessages(mapped);
          }
        } catch (e) {
          console.warn("Failed to load existing mistakes session messages:", e);
        }
      }

      return data.id;
    } catch (error: any) {
      console.error("Failed to load/create mistakes session:", error.message || error);
      return null;
    }
  }, [analyzedCtxId]);

  const createSession = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/work-on-mistakes/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyzedCtxId }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      setSessionId(data.id);
      return data.id;
    } catch (error: any) {
      console.error("Failed to create mistakes session:", error.message || error);
      return null;
    }
  }, [analyzedCtxId]);

  const getSessionId = useCallback((): string | null => sessionId, [sessionId]);

  const send = useCallback(
    (message: { type: string; ctxId?: string; text?: string }) => {
      console.log("[FlowManagerApi] send called:", JSON.stringify(message).substring(0, 100));
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.log("[FlowManagerApi] WS is OPEN, sending...");
        wsRef.current.send(JSON.stringify(message));
      } else {
        console.warn("[FlowManagerApi] FlowManager WS not connected, readyState:", wsRef.current?.readyState);
      }
    },
    []
  );

  const getFlowMessages = useCallback((): Message[] => flowMessages, [flowMessages]);

  const isFlowRunning = useCallback((): boolean => flowRunning, [flowRunning]);

  return {
    createSession,
    loadExistingSession,
    getSessionId,
    send,
    getFlowMessages,
    isFlowRunning,
  };
}