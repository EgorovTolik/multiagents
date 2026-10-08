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
  /** Рассуждения модели (thinking) — раскрывающийся блок в UI. */
  thinking?: string;
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
  /** Агент может применить навык к себе сам (инструмент use_skill). */
  autoApply?: boolean;
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
  | { type: "thinking_delta"; ctxId: string; agentId: string; text: string }
  | { type: "assistant_end"; ctxId: string; agentId: string; text: string; thinking?: string }
  | { type: "run_start"; ctxId: string; agentId: string }
  | { type: "run_end"; ctxId: string; agentId: string }
  | { type: "handoff"; ctxId: string; handoff: Handoff }
  | { type: "handoff_pending"; ctxId: string; handoff: Handoff }
  | { type: "handoff_cancelled"; ctxId: string }
  | { type: "ask_user"; ctxId: string; agentId: string; question: string }
  | { type: "run_state"; actives: { ctxId: string; agentId: string }[] }
  | { type: "chain_waiting"; ctxId: string; agentId: string }
  | { type: "queued"; ctxId: string; count: number }
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

// Singleton WebSocket connection shared across all components
let globalWs: WebSocket | null = null;
let globalHandlers: ((msg: ServerMsg) => void)[] = [];
let globalStatus: ConnStatus = "connecting";
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectionStarted = false;
let appHandler: ((msg: ServerMsg) => void) | null = null;

function ensureConnection() {
  console.log("[WS ENSURE] connectionStarted:", connectionStarted, "globalWs:", !!globalWs);
  if (connectionStarted) {
    if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) {
      return globalWs;
    }
    // Connection was started but is now closed — try to reconnect
  }
  
  connectionStarted = true;
  console.log("[WS ENSURE] creating WebSocket");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  console.log("[WS ENSURE] URL:", `${proto}://${location.hostname}:3000`);
  const ws = new WebSocket(`${proto}://${location.hostname}:3000`);
  globalWs = ws;
  globalStatus = "connecting";
  console.log("[WS ENSURE] WebSocket created");
  
  ws.onopen = () => {
    globalStatus = "connected";
  };
  
  ws.onclose = () => {
    globalStatus = "disconnected";
    // авто-реконнект через 2 сек
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectionStarted = false; // Allow new connection attempt
        ensureConnection();
      }, 2000);
    }
  };
  
  ws.onerror = () => { /* onclose сработает после */ };
  
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      globalHandlers.forEach((h) => h(msg));
    } catch { /* ignore */ }
  };
  
  return ws;
}

export function useServer(initialHandler?: (msg: ServerMsg) => void): ClientApi {
  const [status, setStatus] = useState<ConnStatus>(globalStatus);
  
  useEffect(() => {
    ensureConnection();
    
    // Update or register app handler
    if (initialHandler) {
      if (appHandler && appHandler !== initialHandler) {
        // Replace old handler with new one
        const idx = globalHandlers.indexOf(appHandler);
        if (idx >= 0) globalHandlers[idx] = initialHandler;
      } else if (!appHandler) {
        globalHandlers.push(initialHandler);
      }
      appHandler = initialHandler;
    }
    
    // Poll status updates
    const interval = setInterval(() => {
      if (globalWs) {
        if (globalWs.readyState === WebSocket.OPEN) {
          setStatus("connected");
        } else if (globalWs.readyState === WebSocket.CLOSED) {
          setStatus("disconnected");
        }
      }
    }, 500);
    
    return () => {
      clearInterval(interval);
      // Don't close the connection on unmount — other components may still be using it
    };
  }, []);

  return {
    send: (msg) => {
      const ws = ensureConnection();
      if (ws.readyState === WebSocket.OPEN) {
        console.log("[WS SEND]", msg.type);
        ws.send(JSON.stringify(msg));
      }
    },
    onMessage: (fn) => {
      console.log("[WS ONMESSAGE] registering handler, total:", globalHandlers.length + 1);
      globalHandlers.push(fn);
    },
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

// ─── Training sessions API ──────────────────────────────────────────────────────

export interface TrainingSession {
  id: string;
  agentId: string;
  name?: string;
  createdAt: number;
  updatedAt?: number;
  status?: "active" | "completed";
}

/** Создать обучающую сессию для агента */
export async function createTrainingSession(agentId: string): Promise<TrainingSession> {
  const r = await fetch(`/api/training/sessions/${encodeURIComponent(agentId)}`, { method: "POST" });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

/** Список обучающих сессий агента */
export async function listTrainingSessions(agentId: string): Promise<TrainingSession[]> {
  const r = await fetch(`/api/training/sessions/${encodeURIComponent(agentId)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

/** Завершить обучающую сессию (пометить как completed, не удаляя историю) */
export async function completeTrainingSession(sessionId: string): Promise<void> {
  const r = await fetch(`/api/training/sessions/${encodeURIComponent(sessionId)}/complete`, { method: "POST" });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
}

/** Переименовать обучающую сессию */
export async function renameTrainingSession(sessionId: string, name: string): Promise<void> {
  const r = await fetch(`/api/training/sessions/${encodeURIComponent(sessionId)}/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
}

/** Удалить обучающую сессию */
export async function deleteTrainingSession(sessionId: string): Promise<void> {
  const r = await fetch(`/api/training/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
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
