import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentInfo, ClientApi, ContextMeta, Handoff, Message, ServerMsg, SkillInfo } from "./api";
import { useServer, createTrainingSession, listTrainingSessions, completeTrainingSession, deleteTrainingSession, TrainingSession } from "./api";
import { ChatComponent } from "./components/ChatComponent";

interface Props {
  onBack: (agentId?: string) => void;
}

export default function LearningPage({ onBack }: Props) {
  const hash = window.location.hash; // #/training/:sessionId
  const sessionId = hash.replace("#/training/", "");

  // State
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [menu, setMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [activeSession, setActiveSession] = useState<TrainingSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [pendingHandoff, setPendingHandoff] = useState<Handoff | null>(null);
  const [input, setInput] = useState("");
  const [sentText, setSentText] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; mediaType: string; data: string; size: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const apiRef = useRef<ClientApi | null>(null);

  // WebSocket handler
  const handleMsg = useCallback((msg: ServerMsg) => {
    switch (msg.type) {
      case "agents":
        setAgents(msg.agents);
        break;
      case "skills":
        setSkills(msg.skills);
        break;
      case "message":
        if (activeSession && msg.ctxId === activeSession.id) {
          setMessages((m) => [...m, msg.message]);
          // Reset sentText when any new message arrives from agent
          if (msg.message.role === "assistant") {
            setSentText(null);
          }
        }
        break;
      case "delta":
        if (activeSession && msg.ctxId === activeSession.id) {
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role === "assistant" && last.agentId === msg.agentId && (last.text.endsWith("…") || (last.text === "" && !!last.thinking))) {
              const copy = [...m];
              copy[m.length - 1] = { ...last, text: last.text === "" ? msg.text + "…" : last.text.slice(0, -1) + msg.text + "…" };
              return copy;
            }
            return [...m, { role: "assistant", agentId: msg.agentId, text: msg.text + "…", ts: Date.now() }];
          });
        }
        break;
      case "thinking_delta":
        if (activeSession && msg.ctxId === activeSession.id) {
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role === "assistant" && last.agentId === msg.agentId && (last.text.endsWith("…") || (last.text === "" && !!last.thinking))) {
              const copy = [...m];
              copy[m.length - 1] = { ...last, thinking: (last.thinking ?? "") + msg.text };
              return copy;
            }
            return [...m, { role: "assistant", agentId: msg.agentId, text: "", thinking: msg.text, ts: Date.now() }];
          });
        }
        break;
      case "assistant_end":
        if (activeSession && msg.ctxId === activeSession.id) {
          setMessages((m) => {
            const i = [...m].reverse().findIndex((x) => x.role === "assistant" && x.agentId === msg.agentId);
            if (i < 0) return m;
            const idx = m.length - 1 - i;
            const copy = [...m];
            copy[idx] = { role: "assistant", agentId: msg.agentId, text: msg.text, thinking: msg.thinking || copy[idx].thinking || undefined, ts: Date.now() };
            return copy;
          });
          setSentText(null);
        }
        break;
      case "run_start":
        if (activeSession && msg.ctxId === activeSession.id) {
          setRunningAgentId(msg.agentId);
        }
        break;
      case "run_end":
        if (activeSession && msg.ctxId === activeSession.id) {
          setRunningAgentId(null);
        }
        break;
      case "handoff_pending":
        if (activeSession && msg.ctxId === activeSession.id) {
          setPendingHandoff(msg.handoff);
        }
        break;
      case "handoff_cancelled":
        if (activeSession && msg.ctxId === activeSession.id) {
          setPendingHandoff(null);
        }
        break;
      case "handoff":
        if (activeSession && msg.ctxId === activeSession.id) {
          setPendingHandoff(null);
        }
        break;
      case "context_loaded":
        if (activeSession && msg.context?.id === activeSession.id) {
          setMessages(msg.messages);
        }
        break;
      case "error":
        setError(msg.message);
        setTimeout(() => setError(null), 5000);
        break;
    }
  }, [activeSession]);

  const api = useServer(handleMsg);
  apiRef.current = api;

  // Determine agent ID from session or hash
  const getAgentId = useCallback(async (session?: TrainingSession) => {
    if (session?.agentId) return session.agentId;
    try {
      // Fetch individual session details to get agentId
      const resp = await fetch(`/api/training/sessions/${sessionId}`);
      if (resp.ok) {
        const s = await resp.json();
        if (s && s.agentId) return s.agentId;
      }
    } catch { /* ignore */ }
    return null;
  }, [sessionId]);

  // Load sessions when agent is known
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const agentId = await getAgentId();
        if (!agentId || cancelled) return;
        const sessList = await listTrainingSessions(agentId);
        if (!cancelled) {
          setSessions(sessList);
          // Find and activate the session matching hash
          const active = sessList.find((s) => s.id === sessionId);
          if (active) setActiveSession(active);
        }
      } catch (e) {
        if (!cancelled) setError(`Не удалось загрузить сессии: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [sessionId, getAgentId]);

  // Load messages for active session
  useEffect(() => {
    if (!activeSession) {
      setMessages([]);
      return;
    }
    apiRef.current?.send({ type: "load_context", ctxId: activeSession.id });
  }, [activeSession?.id]);

  // Close menu on outside click
  useEffect(() => {
    if (!menu) return;
    const handler = () => setMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menu]);

  // Handle context_loaded — moved into main handleMsg callback above

  const agentName = useCallback((id: string) => agents.find((a) => a.id === id)?.name ?? id, [agents]);

  const currentAgentId = activeSession?.agentId;
  const currentAgent = agents.find((a) => a.id === currentAgentId);

  // Create new session
  const handleCreateSession = async () => {
    if (!currentAgentId) return;
    try {
      const session = await createTrainingSession(currentAgentId);
      window.location.hash = `#/training/${session.id}`;
    } catch (e) {
      alert(`Ошибка создания сессии: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Select session
  const handleSelectSession = (s: TrainingSession) => {
    window.location.hash = `#/training/${s.id}`;
  };

  // Close session
  const [menuOpen, setMenuOpen] = useState(false);

  const handleCloseSession = async () => {
    if (!activeSession) return;
    try {
      await completeTrainingSession(activeSession.id);
      load();
    } catch (e) {
      console.error("Failed to complete session:", e);
    }
  };

  const handleDeleteSession = async () => {
    if (!activeSession) return;
    if (!confirm("Удалить обучающую сессию? История будет удалена.")) return;
    try {
      await deleteTrainingSession(activeSession.id);
      setSessions((s) => s.filter((x) => x.id !== activeSession.id));
      onBack(currentAgentId);
    } catch (e) {
      alert(`Ошибка завершения: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const contextMeta: ContextMeta | null = activeSession ? {
    id: activeSession.id,
    name: activeSession.title ?? `Обучение: ${agentName(currentAgentId!)}`,
    createdAt: activeSession.createdAt,
    activeAgentId: currentAgentId!,
    handoffs: [],
    lastMessageAt: activeSession.updatedAt ?? activeSession.createdAt,
  } : null;

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-3 sm:gap-3 sm:px-6">
        <button
          onClick={() => onBack(currentAgentId)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          ← Редактор агентов
        </button>
        {currentAgent && (
          <div className="flex items-center gap-2">
            <span className="hidden text-lg font-semibold sm:block">🎓 Обучение: {currentAgent.name}</span>
            <span className="text-sm text-slate-400">{runningAgentId ? "занят" : "свободен"}</span>
          </div>
        )}
        {error && <span className="ml-auto text-sm text-red-400">{error}</span>}
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: sessions list */}
        <aside className="w-72 shrink-0 border-r border-slate-800 bg-slate-900/50 p-3">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Сессии обучения ({sessions.length})
          </h2>
          <button
            onClick={handleCreateSession}
            disabled={!currentAgentId}
            className="mb-3 w-full rounded-lg border border-dashed border-emerald-600 bg-emerald-950/40 py-2 text-sm text-emerald-300 hover:bg-emerald-900/60 disabled:opacity-40"
          >
            + Новая сессия
          </button>
          <div className="space-y-1 overflow-y-auto">
            {sessions.map((s) => (
              <Fragment key={s.id}>
                <div
                  onClick={() => handleSelectSession(s)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenu({ sessionId: s.id, x: rect.right - 180, y: rect.bottom + 4 });
                  }}
                  className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                    activeSession?.id === s.id
                      ? "bg-slate-700/60 text-white"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 truncate font-medium text-xs">
                      {s.completed && <span title="Завершённая сессия">✅</span>}
                      <span className="truncate">
                        {s.title ?? `Сессия ${new Date(s.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                      </span>
                    </div>
                    <div className="truncate text-[10px] text-slate-500">
                      {new Date(s.createdAt).toLocaleDateString("ru-RU")}
                      {s.completed && " • завершена"}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMenu({ sessionId: s.id, x: rect.left - 180, y: rect.top });
                    }}
                    title="Действия"
                    className="shrink-0 rounded px-1.5 py-1 text-sm text-slate-500 hover:bg-slate-700 hover:text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    ⋮
                  </button>
                </div>
              </Fragment>
            ))}
          </div>

          {/* Context menu for training sessions */}
          {menu && createPortal(
            <div
              className="fixed z-50 w-[180px] rounded-lg border border-slate-700 bg-slate-900/95 shadow-xl backdrop-blur"
              style={{ left: menu.x, top: menu.y }}
            >
              <button
                onClick={async () => {
                  setMenu(null);
                  const s = sessions.find(x => x.id === menu.sessionId);
                  if (s) {
                    setActiveSession(s);
                    handleSelectSession(s);
                  }
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 first:rounded-t-lg"
              >
                Открыть
              </button>
              <button
                onClick={async () => {
                  setMenu(null);
                  const s = sessions.find(x => x.id === menu.sessionId);
                  if (s) {
                    setActiveSession(s);
                    try {
                      await completeTrainingSession(s.id);
                      load();
                    } catch (e) {
                      console.error("Failed to complete:", e);
                    }
                  }
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"
              >
                Завершить
              </button>
              <div className="h-px bg-slate-700 my-1" />
              <button
                onClick={async () => {
                  setMenu(null);
                  const s = sessions.find(x => x.id === menu.sessionId);
                  if (s && confirm("Удалить сессию? История будет удалена.")) {
                    await deleteTrainingSession(s.id);
                    setSessions(prev => prev.filter(x => x.id !== s.id));
                    if (activeSession?.id === s.id) {
                      const next = sessions.find(x => x.id !== s.id);
                      if (next) {
                        navigate(`/training/${next.id}`);
                      } else {
                        navigate("/agents");
                      }
                    }
                  }
                }}
                className="block w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-slate-700 last:rounded-b-lg"
              >
                Удалить сессию
              </button>
            </div>,
            document.body
          )}
        </aside>

        {/* Right: chat */}
        <main className="flex flex-1 flex-col min-w-0">
          {contextMeta ? (
            <ChatComponent
              ctxId={contextMeta.id}
              context={contextMeta}
              agents={agents}
              api={api}
              messages={messages}
              runningAgentId={runningAgentId}
              pending={pendingHandoff}
              skills={skills}
              appliedSkills={[]}
              input={input}
              onInputChange={setInput}
              sentText={sentText}
              setSentText={setSentText}
              attachedFiles={attachedFiles}
              setAttachedFiles={setAttachedFiles}
              onAddFiles={() => {}}
              onSend={(text, files) => {
                api.send({ type: "message", ctxId: contextMeta.id, text, files });
              }}
              onApplySkills={() => {}}
              onCancelHandoff={() => api.send({ type: "cancel_handoff", ctxId: contextMeta.id })}
              onAbort={() => api.send({ type: "abort", ctxId: contextMeta.id })}
              onClose={handleCloseSession}
              showAgentInfo={true}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-4">
              <p className="text-slate-500">Загрузка сессии…</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
