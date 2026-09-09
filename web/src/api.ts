import { useEffect, useRef, useState } from "react";

export interface Handoff {
  from: string;
  to: string;
  reason: string;
  context: string;
  ts: number;
}

export interface Message {
  role: "user" | "assistant" | "system";
  agentId?: string;
  text: string;
  ts: number;
}

export interface ContextMeta {
  id: string;
  name: string;
  createdAt: number;
  activeAgentId: string;
  handoffs: Handoff[];
  lastMessageAt?: number;
  /** Навыки, применённые к этому чату. */
  skills?: string[];
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

export type ServerMsg =
  | { type: "agents"; agents: AgentInfo[] }
  | { type: "skills"; skills: SkillInfo[] }
  | { type: "skills_applied"; ctxId: string; skills: string[] }
  | { type: "contexts"; contexts: ContextMeta[] }
  | { type: "context_created"; context: ContextMeta }
  | { type: "context_loaded"; context: ContextMeta | undefined; messages: Message[] }
  | { type: "message"; ctxId: string; message: Message }
  | { type: "delta"; ctxId: string; agentId: string; text: string }
  | { type: "assistant_end"; ctxId: string; agentId: string; text: string }
  | { type: "run_start"; ctxId: string; agentId: string }
  | { type: "run_end"; ctxId: string; agentId: string }
  | { type: "handoff"; ctxId: string; handoff: Handoff }
  | { type: "handoff_pending"; ctxId: string; handoff: Handoff }
  | { type: "handoff_cancelled"; ctxId: string }
  | { type: "ask_user"; ctxId: string; agentId: string; question: string }
  | { type: "run_state"; running: { ctxId: string; agentId: string } | null }
  | { type: "context_deleted"; ctxId: string }
  | { type: "message_received"; ctxId: string }
  | { type: "context_renamed"; ctxId: string; name: string }
  | { type: "history_truncated"; ctxId: string }
  | { type: "archive_status"; ctxId: string; state: "queued" | "preparing" | "ready" | "error"; url?: string; error?: string }
  | { type: "error"; ctxId?: string; message: string };

export type ConnStatus = "connected" | "connecting" | "disconnected";

export interface ClientApi {
  send: (msg: unknown) => void;
  onMessage: (fn: (msg: ServerMsg) => void) => void;
  status: ConnStatus;
}

export function useServer(onMessage: (msg: ServerMsg) => void): ClientApi {
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;
  const [status, setStatus] = useState<ConnStatus>("connecting");

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (closed) return;
      setStatus("connecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.hostname}:3000`);
      wsRef.current = ws;
      ws.onopen = () => setStatus("connected");
      ws.onclose = () => {
        setStatus("disconnected");
        // авто-реконнект через 2 сек
        if (!closed) timer = setTimeout(connect, 2000);
      };
      ws.onerror = () => { /* onclose сработает после */ };
      ws.onmessage = (ev) => {
        try {
          handlerRef.current(JSON.parse(ev.data));
        } catch { /* ignore */ }
      };
    }

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  return {
    send: (msg) => {
      if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(msg));
    },
    onMessage: () => {},
    status,
  };
}

/** Запрос размеров директорий контекстов в байтах: { [ctxId]: number } */
export async function fetchContextSizes(): Promise<Record<string, number>> {
  try {
    const r = await fetch("/api/context-sizes");
    if (!r.ok) return {};
    return (await r.json()) as Record<string, number>;
  } catch {
    return {};
  }
}

const AGENT_COLORS = [
  "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
  "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  "bg-amber-500/20 text-amber-300 border-amber-500/40",
  "bg-rose-500/20 text-rose-300 border-rose-500/40",
  "bg-sky-500/20 text-sky-300 border-sky-500/40",
  "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40",
];

export function agentColor(agentId: string): string {
  let h = 0;
  for (const ch of agentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length];
}
