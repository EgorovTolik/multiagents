import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentInfo, ClientApi, ContextMeta, Handoff, Message, ServerMsg, SkillInfo } from "./api";
import { useServer, fetchContextSizes, createTrainingSession, listTrainingSessions, completeTrainingSession, renameTrainingSession, deleteTrainingSession, TrainingSession } from "./api";
import { ChatComponent } from "./components/ChatComponent";
import { fmtDay, formatBytes } from "./utils/format";

interface Props {
  onBack: (agentId?: string) => void;
}

export default function LearningPage({ onBack }: Props) {
  const hash = window.location.hash; // #/training/:agentId or #/training/:agentId/:sessionId
  const parts = hash.replace("#/training/", "").split("/");
  const urlAgentIdPart = parts[0]; // agentId or empty
  const urlSessionId = parts.length > 1 ? parts[1] : null;

  // State
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [menu, setMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [activeSession, setActiveSession] = useState<TrainingSession | null>(null);
  const [urlAgentId, setUrlAgentId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [pendingHandoff, setPendingHandoff] = useState<Handoff | null>(null);
  const [input, setInput] = useState("");
  const [sentText, setSentText] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; mediaType: string; data: string; size: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Размер директорий сессий: { [sessionId]: number } */
  const [sessionSizes, setSessionSizes] = useState<Record<string, number>>({});

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
            // Проверяем: сообщение уже стримится (оканчивается на …) или это возобновление после перезагрузки
            const isStreaming = last?.role === "assistant" && last.agentId === msg.agentId && (last.text.endsWith("…") || last.streaming);
            if (isStreaming) {
              const copy = [...m];
              // Если это возобновление после перезагрузки — удаляем флаг streaming
              const baseText = last.text.endsWith("…") ? last.text.slice(0, -1) : last.text;
              copy[m.length - 1] = { ...last, text: baseText + msg.text + "…", streaming: false };
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
            // Проверяем: сообщение уже стримится или это возобновление после перезагрузки
            const isStreaming = last?.role === "assistant" && last.agentId === msg.agentId && (last.text.endsWith("…") || last.streaming || (last.text === "" && !!last.thinking));
            if (isStreaming) {
              const copy = [...m];
              copy[m.length - 1] = { ...last, thinking: (last.thinking ?? "") + msg.text, streaming: false };
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
      case "run_state":
        // Синхронизация статуса агентов при подключении нового клиента
        if (!activeSession) break;
        const isActive = (msg.actives ?? []).some((a: any) => a.ctxId === activeSession.id);
        if (isActive && !runningAgentId) {
          // Агент занят, но мы не получили run_start — устанавливаем статус
          setRunningAgentId(activeSession.agentId);
        } else if (!isActive && runningAgentId) {
          // Агент свободен, но мы не получили run_end — сбрасываем статус
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
      case "training_session_reopened":
        // Сессия переоткрыта — обновляем список
        loadSessions();
        break;
      case "error":
        setError(msg.message);
        setTimeout(() => setError(null), 5000);
        break;
    }
  }, [activeSession]);

  const api = useServer(handleMsg);
  apiRef.current = api;

  // Determine agent ID and target session from URL
  const resolveUrl = useCallback(async () => {
    console.log("[resolveUrl] urlAgentIdPart:", urlAgentIdPart, "urlSessionId:", urlSessionId);
    const result = { agentId: null as string | null, targetSessionId: null as string | null };
    
    // Check if urlAgentIdPart is an agent ID
    if (urlAgentIdPart) {
      try {
        const agentsResp = await fetch('/api/agents');
        if (agentsResp.ok) {
          const agentList = await agentsResp.json();
          if (agentList && Array.isArray(agentList)) {
            const found = agentList.find((a: { id: string }) => a.id === urlAgentIdPart);
            if (found) {
              result.agentId = urlAgentIdPart;
              // If there's also a session ID, validate it
              if (urlSessionId) {
                try {
                  const resp = await fetch(`/api/training/sessions/${urlSessionId}`);
                  if (resp.ok) {
                    const s = await resp.json();
                    if (s && s.agentId === urlAgentIdPart) {
                      result.targetSessionId = urlSessionId;
                    }
                  }
                } catch { /* ignore */ }
              }
              return result;
            }
          }
        }
      } catch { /* ignore */ }
    }
    
    // If not an agent ID in URL, try to treat urlAgentIdPart as a session ID and find its agent
    if (urlAgentIdPart && !result.agentId) {
      try {
        const resp = await fetch(`/api/training/sessions/${urlAgentIdPart}`);
        if (resp.ok) {
          const s = await resp.json();
          if (s && s.agentId) {
            result.agentId = s.agentId;
            result.targetSessionId = urlAgentIdPart;
            return result;
          }
        }
      } catch { /* ignore */ }
    }
    
    return result;
  }, [urlAgentIdPart, urlSessionId]);

  // Load sessions when agent is known
  const loadSessions = useCallback(async () => {
    try {
      const { agentId, targetSessionId } = await resolveUrl();
      if (!agentId) return;
      
      setUrlAgentId(agentId);
      setActiveSession(null); // Reset when loading a different agent
      const sessList = await listTrainingSessions(agentId);
      setSessions(sessList);
      // Запросить размеры директорий сессий (они — контексты, API то же)
      fetchContextSizes().then((s) => setSessionSizes(s));
      
      // Selection priority:
      // 1. If URL specifies a session ID, select it
      // 2. Otherwise, select first open (non-completed) session
      // 3. Otherwise, select most recent session by last activity
      if (targetSessionId) {
        const target = sessList.find((s) => s.id === targetSessionId);
        if (target) setActiveSession(target);
      } else {
        // Find first open session (not completed)
        const openSession = sessList.find((s) => s.status !== "completed");
        if (openSession) {
          setActiveSession(openSession);
        } else if (sessList.length > 0) {
          // No open sessions — pick most recent by createdAt
          const sorted = [...sessList].sort((a, b) => b.createdAt - a.createdAt);
          setActiveSession(sorted[0]);
        }
      }
    } catch (e) {
      setError(`Не удалось загрузить сессии: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [urlAgentIdPart, urlSessionId, resolveUrl]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

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

  const currentAgentId = activeSession?.agentId ?? urlAgentId;
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
      // Reload sessions list to reflect completion status
      loadSessions();
    } catch (e) {
      console.error("Failed to complete session:", e);
    }
  };

  // Select next session after deletion — prefer open, then any remaining
  const selectNextSession = useCallback((deletedId: string) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== deletedId);
      if (remaining.length === 0) {
        // No sessions left — reset to empty state
        setActiveSession(null);
        return [];
      }
      // Prefer open sessions, then any remaining
      const openSession = remaining.find((s) => s.status !== "completed");
      if (openSession) {
        setActiveSession(openSession);
      } else {
        // All completed — pick the first one
        setActiveSession(remaining[0]);
      }
      return remaining;
    });
  }, []);

  const handleDeleteSession = async () => {
    if (!activeSession) return;
    if (!confirm("Удалить обучающую сессию? История будет удалена.")) return;
    try {
      await deleteTrainingSession(activeSession.id);
      selectNextSession(activeSession.id);
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
        <aside className="relative flex w-72 flex-col shrink-0 border-r border-slate-800 bg-slate-900/50" style={{ height: '100%' }}>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Сессии обучения ({sessions.length})
          </h2>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {(() => {
              let lastDay = "";
              return sessions.map((s) => {
                const dayKey = new Date(s.createdAt).toDateString();
                const dayHeader = dayKey !== lastDay;
                lastDay = dayKey;
                return (
                  <Fragment key={s.id}>
                    {dayHeader && (
                      <div className="my-3 px-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        {fmtDay(s.createdAt)}
                      </div>
                    )}
                <div
                  title={sessionSizes[s.id] != null
                    ? `sessions/${s.id} (${formatBytes(sessionSizes[s.id])})`
                    : `sessions/${s.id}`}
                  onClick={() => handleSelectSession(s)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenamingSessionId(s.id);
                    setRenameValue(s.name ?? "");
                  }}
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
                  <div className="min-w-0 flex-1">
                    {renamingSessionId === s.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            const name = renameValue.trim();
                            if (name) {
                              try {
                                await renameTrainingSession(s.id, name);
                                loadSessions();
                              } catch (err) {
                                console.error("Rename failed:", err);
                              }
                            }
                            setRenamingSessionId(null);
                          }
                          if (e.key === "Escape") {
                            setRenamingSessionId(null);
                          }
                        }}
                        onBlur={async () => {
                          const name = renameValue.trim();
                          if (name) {
                            try {
                              await renameTrainingSession(s.id, name);
                              loadSessions();
                            } catch (err) {
                              console.error("Rename failed:", err);
                            }
                          }
                          setRenamingSessionId(null);
                        }}
                        className="w-full min-w-0 flex-1 rounded border border-indigo-500 bg-slate-900 px-2 py-1 text-sm text-white outline-none"
                      />
                    ) : (
                      <div className="flex items-center gap-1 truncate font-medium text-xs">
                        {s.completed && <span title="Завершённая сессия">✅</span>}
                        <span className="truncate">
                          {s.name ?? `Сессия ${new Date(s.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                        </span>
                      </div>
                    )}
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
                );
              });
            })()}
          </div>
          <div className="absolute bottom-0 left-0 right-0 border-t border-slate-800 p-3">
            <button
              onClick={(e) => { e.stopPropagation(); handleCreateSession(); }}
              disabled={!currentAgentId}
              className="w-full rounded-lg border border-dashed border-slate-600 py-2 text-sm text-slate-300 hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-40"
            >
              + Новая сессия
            </button>
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
                onClick={() => {
                  setMenu(null);
                  const s = sessions.find(x => x.id === menu.sessionId);
                  if (s) {
                    setRenamingSessionId(s.id);
                    setRenameValue(s.name ?? "");
                  }
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"
              >
                Переименовать
              </button>
              <button
                onClick={async () => {
                  setMenu(null);
                  const s = sessions.find(x => x.id === menu.sessionId);
                  if (s) {
                    setActiveSession(s);
                    try {
                      await completeTrainingSession(s.id);
                      loadSessions();
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
                    // Use same selection logic as handleDeleteSession
                    setSessions((prev) => {
                      const remaining = prev.filter((x) => x.id !== s.id);
                      if (remaining.length === 0) {
                        setActiveSession(null);
                        window.location.hash = `#/training/${currentAgentId}`;
                        return [];
                      }
                      const openSession = remaining.find((x) => x.status !== "completed");
                      if (openSession) {
                        setActiveSession(openSession);
                        window.location.hash = `#/training/${openSession.id}`;
                      } else {
                        setActiveSession(remaining[0]);
                        window.location.hash = `#/training/${remaining[0].id}`;
                      }
                      return remaining;
                    });
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
          ) : sessions.length > 0 ? (
            <div className="flex flex-1 items-center justify-center p-4">
              <p className="text-slate-500">Выберите сессию обучения слева или создайте новую</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
              <p className="text-lg font-medium text-slate-300">У агента пока нет обучающих сессий</p>
              <p className="text-sm text-slate-500">Создайте первую сессию, чтобы начать обучение через диалог</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
