import { useCallback, useEffect, useRef, useState } from "react";
import "highlight.js/styles/atom-one-dark.css";
import type { AgentInfo, ClientApi, ContextMeta, Handoff, Message, ServerMsg, SkillInfo } from "./api";
import { useServer, fetchContextSizes } from "./api";
import AgentEditor from "./AgentEditor";
import SettingsPage from "./SettingsPage";
import SkillsPage from "./SkillsPage";
import LearningPage from "./LearningPage";
import MistakesPage from "./MistakesPage";
import { Sidebar } from "./components/Sidebar";
import { ChatComponent } from "./components/ChatComponent";
import { RecoveryHistoryModal, type RecoveryEntry } from "./components/RecoveryHistoryModal";
import { PlanEditorModal } from "./components/PlanEditorModal";
import type { Plan } from "./api";
import { Lightbox } from "./components/Lightbox";
import { ToastContainer, useToasts } from "./components/Toast";
import type { ArchiveInfo } from "./components/Sidebar";

// ─── Hash routing ────────────────────────────────────────────────────────────────
function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const fn = () => setHash(window.location.hash);
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  return hash;
}

// ─── Main App ────────────────────────────────────────────────────────────────────
export default function App() {
  const route = useHashRoute();

  // State
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [contexts, setContexts] = useState<ContextMeta[]>([]);
  const [activeCtx, setActiveCtx] = useState<ContextMeta | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  /** Активные цепочки: chatId → agentId. Разные чаты работают параллельно. */
  const [runnings, setRunnings] = useState<Record<string, string>>({});
  /** Чаты, ожидающие освобождения занятого агента: chatId → agentId. */
  const [waitingAgents, setWaitingAgents] = useState<Record<string, string>>({});
  /** Для компонентов, ожидающих «текущий» статус активного чата. */
  const running = activeCtx && runnings[activeCtx.id]
    ? { ctxId: activeCtx.id, agentId: runnings[activeCtx.id] }
    : null;
  const [pending, setPending] = useState<Handoff | null>(null);
  const [input, setInput] = useState("");
  const [renamingCtx, setRenamingCtx] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [sentText, setSentText] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; mediaType: string; data: string; size: number }[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [archiveStatus, setArchiveStatus] = useState<Record<string, ArchiveInfo>>({});
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [appliedSkills, setAppliedSkills] = useState<string[]>([]);
  const [contextSizes, setContextSizes] = useState<Record<string, number>>({});
  // Recovery counters: ctxId → count of completed recoveries
  const [recoveryCounts, setRecoveryCounts] = useState<Record<string, number>>({});
  // Recovery history: ctxId → array of recovery events
  const [recoveryHistories, setRecoveryHistories] = useState<Record<string, RecoveryEntry[]>>({});
  // Modal state
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);

  // Plan management state
  const [activePlans, setActivePlans] = useState<Record<string, Plan | null>>({});
  const [planEditorOpen, setPlanEditorOpen] = useState(false);

  const { toasts, notify, dismiss } = useToasts();

  // Refs
  const apiRef = useRef<ClientApi | null>(null);
  const contextsRef = useRef<ContextMeta[]>([]);
  contextsRef.current = contexts;
  const activeCtxIdRef = useRef<string | null>(null);
  activeCtxIdRef.current = activeCtx?.id ?? null;

  let lastType = "";
  // ─── WS message handler ────────────────────────────────────────────────────────
  const handle = useCallback(
    (msg: ServerMsg) => {
      if (msg.type != lastType) {
       lastType = msg.type;
       console.log(msg);
      }
      switch (msg.type) {
        case "agents":
          setAgents(msg.agents);
          break;
        case "skills":
          setSkills(msg.skills);
          break;
        case "skills_applied":
          if (msg.ctxId === activeCtx?.id) setAppliedSkills(msg.skills);
          break;
        case "contexts":
          setContexts(msg.contexts);
          // Инициализируем recoveryCounts из context.json
          const counts: Record<string, number> = {};
          for (const ctx of msg.contexts) {
            if (ctx.recoveryCount) counts[ctx.id] = ctx.recoveryCount;
          }
          setRecoveryCounts(counts);
          // Инициализируем activePlans из context.json
          const plans: Record<string, Plan | null> = {};
          for (const ctx of msg.contexts) {
            if (ctx.activePlanId) plans[ctx.id] = { id: ctx.activePlanId, title: "Загрузка...", status: "planning", steps: [], createdBy: "", createdAt: 0 };
          }
          setActivePlans(plans);
          if (!activeCtx && msg.contexts.length > 0) {
            const latest = msg.contexts.reduce((a: ContextMeta, b: ContextMeta) =>
              (b.lastMessageAt ?? 0) > (a.lastMessageAt ?? 0) ? b : a,
            );
            if (latest.lastMessageAt) {
              apiRef.current?.send({ type: "load_context", ctxId: latest.id });
            }
          }
          break;
        case "context_created":
          setContexts((c) => [msg.context, ...c]);
          setActiveCtx(msg.context);
          setMessages([]);
          setAppliedSkills(msg.context.skills ?? []);
          break;
        case "context_renamed":
          setContexts((cs) => cs.map((c) => (c.id === msg.ctxId ? { ...c, name: msg.name } : c)));
          setActiveCtx((c) => (c?.id === msg.ctxId ? { ...c, name: msg.name } : c));
          break;
        case "history_truncated":
          apiRef.current?.send({ type: "load_context", ctxId: msg.ctxId });
          break;
        case "context_loaded":
          if (msg.context) {
            setActiveCtx(msg.context);
            setMessages(msg.messages);
            setAppliedSkills(msg.context.skills ?? []);
            // Обновляем recoveryCount из загруженного контекста
            if (msg.context.recoveryCount != null) {
              setRecoveryCounts((rc) => ({ ...rc, [msg.context!.id]: msg.context!.recoveryCount! }));
            }
            // Загружаем активный план если есть activePlanId
            if (msg.context.activePlanId) {
              setActivePlans((ap) => ({ ...ap, [msg.context!.id]: { id: msg.context!.activePlanId!, title: "Загрузка...", status: "planning", steps: [], createdBy: "", createdAt: 0 } }));
              // Асинхронно загружаем данные плана
              fetch(`/api/contexts/${msg.context.id}/active-plan`).then(async (res) => {
                const data = await res.json();
                console.log('Plan loaded for context', msg.context.id, 'steps:', data.plan?.steps?.length);
                if (data.plan) {
                  setActivePlans((ap) => ({ ...ap, [msg.context!.id]: data.plan }));
                  console.log('Plan state updated for', msg.context.id);
                }
              }).catch((e) => console.error('Failed to load plan:', e));
            }
          } else {
            setAppliedSkills([]);
          }
          break;
        case "message":
          if (msg.ctxId !== activeCtx?.id) break;
          setMessages((m) => [...m, msg.message]);
          if (msg.message.role === "system") {
            setActiveCtx((c) => (c ? { ...c, activeAgentId: msg.message.agentId ?? c.activeAgentId } : c));
          }
          break;
        case "message_start":
          if (msg.ctxId !== activeCtx?.id) break;
          console.log(`[bubble] message_start msgId=${msg.msgId} creating new bubble`);
          setMessages((m) => {
            const newBubble: Message = { role: "assistant", agentId: msg.agentId, msgId: msg.msgId, text: "", ts: Date.now() };
            const newM = [...m, newBubble];
            console.log(`[bubble] created bubble, now ${newM.length} messages`);
            return newM;
          });
          break;
        case "thinking_delta":
          if (msg.ctxId !== activeCtx?.id) break;
          setMessages((m) => {
            const idx = m.findIndex(x => x.role === "assistant" && x.agentId === msg.agentId && x.msgId === msg.msgId);
            if (idx >= 0) {
              const copy = [...m];
              copy[idx] = { ...copy[idx], thinking: (copy[idx].thinking ?? "") + msg.text };
              return copy;
            }
            const newBubble: Message = { role: "assistant", agentId: msg.agentId, msgId: msg.msgId, text: "", thinking: msg.text, ts: Date.now() };
            return [...m, newBubble];
          });
          break;
        case "delta":
          if (msg.ctxId !== activeCtx?.id) break;
          setMessages((m) => {
            const idx = m.findIndex(x => x.role === "assistant" && x.agentId === msg.agentId && x.msgId === msg.msgId);
            if (idx >= 0) {
              const copy = [...m];
              copy[idx] = { ...copy[idx], text: copy[idx].text + msg.text };
              return copy;
            }
            const newBubble: Message = { role: "assistant", agentId: msg.agentId, msgId: msg.msgId, text: msg.text, ts: Date.now() };
            return [...m, newBubble];
          });
          break;
        case "assistant_end":
          if (msg.ctxId !== activeCtx?.id) break;
          setMessages((m) => {
            const idx = m.findIndex(x => x.role === "assistant" && x.agentId === msg.agentId && x.msgId === msg.msgId);
            console.log(`[bubble] assistant_end msgId=${msg.msgId} found at idx=${idx}, text=${msg.text?.length ?? 0}, thinking=${msg.thinking?.length ?? 0}`);
            if (idx >= 0) {
              const copy = [...m];
              copy[idx] = { role: "assistant", agentId: msg.agentId, msgId: msg.msgId, text: msg.text || copy[idx].text, thinking: msg.thinking || copy[idx].thinking || undefined, ts: Date.now() };
              console.log(`[bubble] updated bubble at idx=${idx}, new text=${copy[idx].text.length}, thinking=${copy[idx].thinking?.length ?? 0}`);
              return copy;
            }
            console.log(`[bubble] creating new bubble for msgId=${msg.msgId}`);
            const newBubble: Message = { role: "assistant", agentId: msg.agentId, msgId: msg.msgId, text: msg.text, thinking: msg.thinking || undefined, ts: Date.now() };
            return [...m, newBubble];
          });
          break;
        case "run_start":
          setRunnings((r) => ({ ...r, [msg.ctxId]: msg.agentId }));
          setWaitingAgents((w) => {
            if (!(msg.ctxId in w)) return w;
            const c = { ...w }; delete c[msg.ctxId]; return c;
          });
          break;
        case "run_end":
          setRunnings((r) => {
            if (!(msg.ctxId in r)) return r;
            const c = { ...r }; delete c[msg.ctxId]; return c;
          });
          setWaitingAgents((w) => {
            if (!(msg.ctxId in w)) return w;
            const c = { ...w }; delete c[msg.ctxId]; return c;
          });
          break;
        case "run_state":
          setRunnings(Object.fromEntries((msg.actives ?? []).map((a: any) => [a.ctxId, a.agentId])));
          break;
        case "chain_waiting":
          // Цепочка стоит: агент занят в другом чате
          setWaitingAgents((w) => ({ ...w, [msg.ctxId]: msg.agentId }));
          break;
        case "context_deleted":
          setContexts((c) => c.filter((x) => x.id !== msg.ctxId));
          setActiveCtx((c) => (c?.id === msg.ctxId ? null : c));
          if (msg.ctxId === activeCtx?.id) setMessages([]);
          break;
        case "handoff":
          setContexts((cs) => cs.map((c) =>
            c.id === msg.ctxId ? { ...c, activeAgentId: msg.handoff.to, handoffs: [...c.handoffs, msg.handoff] } : c,
          ));
          if (msg.ctxId !== activeCtx?.id) break;
          setActiveCtx((c) => (c ? { ...c, activeAgentId: msg.handoff.to, handoffs: [...c.handoffs, msg.handoff] } : c));
          setPending(null);
          break;
        case "handoff_pending":
          if (msg.ctxId !== activeCtx?.id) break;
          setPending(msg.handoff);
          break;
        case "handoff_cancelled":
          if (msg.ctxId !== activeCtx?.id) break;
          setPending(null);
          break;
        case "message_received":
          setSentText(null);
          setInput("");
          break;
        case "archive_status":
          setArchiveStatus((s) => ({
            ...s,
            [msg.ctxId]: { state: msg.state, url: msg.url, error: msg.error },
          }));
          if (msg.state === "ready" && msg.url) {
            const name = contextsRef.current.find((c) => c.id === msg.ctxId)?.name ?? msg.ctxId;
            notify(`Архив «${name}» готов`, {
              sticky: true,
              action: { label: "Скачать", onClick: () => downloadArchiveUrl(msg.url!) },
            });
          } else if (msg.state === "error") {
            notify(`Не удалось подготовить архив: ${msg.error ?? "ошибка"}`, { sticky: true });
          }
          break;
        case "recovery_started":
          setRecoveryHistories((h) => ({
            ...h,
            [msg.ctxId]: [
              ...(h[msg.ctxId] ?? []),
              {
                ts: Date.now(),
                event: "started",
                brokenAgent: msg.brokenAgent,
                attempt: msg.attempt,
                maxAttempts: msg.maxAttempts,
              },
            ],
          }));
          if (msg.ctxId === activeCtx?.id) {
            notify(`⚠️ Цепочка прервалась (${msg.brokenAgent}) — восстанавливаю (попытка ${msg.attempt}/${msg.maxAttempts})`, { sticky: false });
          }
          break;
        case "recovery_decision":
          setRecoveryHistories((h) => ({
            ...h,
            [msg.ctxId]: [
              ...(h[msg.ctxId] ?? []),
              {
                ts: Date.now(),
                event: "decision",
                decision: msg.decision,
                targetAgent: msg.targetAgent,
              },
            ],
          }));
          if (msg.ctxId === activeCtx?.id) {
            let decisionText = msg.decision;
            switch (msg.decision) {
              case "router_fallback": decisionText = "Маршрутизатор не принял решение — передача оркестратору"; break;
              case "auto_recover_incomplete": decisionText = "Задача не завершена — возврат агенту для продолжения"; break;
              case "route_to_router": decisionText = "Цепочка прервалась — разбор маршрута через chain-router"; break;
              case "orchestrator_check": decisionText = "Цепочка прервалась — автопроверка оркестратором"; break;
            }
            const agentNamesRef = agents;
            const targetName = msg.targetAgent ? (agentNamesRef.find((a) => a.id === msg.targetAgent)?.name ?? msg.targetAgent) : null;
            notify(`🔄 Решение: ${decisionText}${targetName ? ` → ${targetName}` : ""}`, { sticky: false });
          }
          break;
        case "recovery_completed":
          setRecoveryHistories((h) => ({
            ...h,
            [msg.ctxId]: [
              ...(h[msg.ctxId] ?? []),
              {
                ts: Date.now(),
                event: "completed",
                success: msg.success,
                reason: msg.reason,
              },
            ],
          }));
          if (msg.success) {
            setRecoveryCounts((prev) => ({ ...prev, [msg.ctxId]: msg.count }));
            if (msg.ctxId === activeCtx?.id) {
              notify(`✅ Восстановление цепочки завершено (всего: ${msg.count})`);
            }
          } else {
            if (msg.ctxId === activeCtx?.id) {
              notify(`❌ Восстановление не удалось: ${msg.reason ?? "лимит исчерпан"}`, { sticky: true });
            }
          }
          break;
        case "agent_notification":
          if (msg.ctxId === activeCtx?.id) {
            notify(msg.message, { sticky: msg.sticky });
          }
          break;
        case "plan_created":
          // Перезагружаем активный план при создании
          setActivePlans((ap) => ({ ...ap, [msg.ctxId]: null }));
          fetch(`/api/contexts/${msg.ctxId}/active-plan`).then(async (res) => {
            const data = await res.json();
            if (data.plan) {
              setActivePlans((ap) => ({ ...ap, [msg.ctxId]: data.plan }));
            }
          }).catch(() => {});
          break;
        case "plan_updated":
          // Перезагружаем активный план при изменении
          fetch(`/api/contexts/${msg.ctxId}/active-plan`).then(async (res) => {
            const data = await res.json();
            if (data.plan) {
              setActivePlans((ap) => ({ ...ap, [msg.ctxId]: data.plan }));
            }
          }).catch(() => {});
          break;
        case "plan_deleted":
          // Очищаем план при удалении
          setActivePlans((ap) => {
            const updated = { ...ap };
            delete updated[msg.ctxId];
            return updated;
          });
          break;
        case "error":
          setErrors((e) => [...e, msg.message]);
          setTimeout(() => setErrors((e) => e.slice(1)), 5000);
          break;
      }
    }, [activeCtx?.id, agents, notify]);

  const api = useServer(handle);
  apiRef.current = api;

  // ─── Размеры директорий контекстов (для тултипов в сайдбаре) ─────────────
  const ctxIdsKey = contexts.map((c) => c.id).join(",");
  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetchContextSizes().then((s) => { if (!cancelled) setContextSizes(s); });
    refresh();
    // файлы в контекстах растут во время работы агентов — обновляем раз в 10 сек
    const t = setInterval(refresh, 10000);
    return () => { cancelled = true; clearInterval(t); };
  }, [ctxIdsKey]);

  // ─── Actions ───────────────────────────────────────────────────────────────────
  const loadContext = (ctxId: string) => {
    api.send({ type: "load_context", ctxId });
    setSidebarOpen(false);
  };

  const addFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        setAttachedFiles((prev) => [...prev, { name: file.name, mediaType: file.type || "application/octet-stream", data: base64, size: file.size }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);



  const renameContext = () => {
    const name = renameValue.trim();
    if (renamingCtx && name) api.send({ type: "rename_context", ctxId: renamingCtx, name });
    setRenamingCtx(null);
  };

  // useCallback — чтобы memo(MessageRow) работал: идентичность колбэков стабильна
  const agentName = useCallback((id: string) => agents.find((a) => a.id === id)?.name ?? id, [agents]);

  // Calculate plan progress (done/total steps)
  function planProgress(plan: Plan | null) {
    if (!plan || !plan.steps) return null;
    let done = 0;
    let total = 0;
    const countSteps = (steps: any[]) => {
      for (const step of steps) {
        total++;
        if (step.status === 'done') done++;
        if (step.steps && step.steps.length > 0) countSteps(step.steps);
      }
    };
    countSteps(plan.steps);
    return { done, total, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  }

  // ─── Навыки ─────────────────────────────────────────────────────────────
  const applySkills = (ids: string[]) => {
    if (!activeCtx || ids.length === 0) return;
    api.send({ type: "apply_skills", ctxId: activeCtx.id, skills: ids });
  };

  // ─── Archive download ─────────────────────────────────────────────────────────
  const downloadArchiveUrl = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onPrepareArchive = (ctxId: string) => {
    const st = archiveStatus[ctxId];
    if (st?.state === "ready" && st.url) {
      downloadArchiveUrl(st.url);
    } else if (st?.state === "queued" || st?.state === "preparing") {
      notify("Архив уже готовится…");
    } else {
      apiRef.current?.send({ type: "prepare_archive", ctxId });
    }
  };

  const onDownloadArchive = (ctxId: string) => {
    const st = archiveStatus[ctxId];
    if (st?.state === "ready" && st.url) downloadArchiveUrl(st.url);
  };

  // ─── Agent Editor / Settings routes (after all hooks — Rules of Hooks) ─────────
  if (route === "#/agents") {
    return <AgentEditor onBack={() => { window.location.hash = ""; }} />;
  }
  if (route === "#/settings") {
    return <SettingsPage onBack={() => { window.location.hash = ""; }} busyCount={Object.keys(runnings).length} />;
  }
  if (route === "#/skills") {
    return <SkillsPage onBack={() => { window.location.hash = ""; }} />;
  }
  if (route.startsWith("#/training/")) {
    return (
      <LearningPage
        onBack={(agentId) => {
          window.location.hash = "#/agents";
        }}
      />
    );
  }
  if (route.startsWith("#/mistakes/")) {
    const analyzedCtxId = route.replace("#/mistakes/", "");
    return <MistakesPage analyzedCtxId={analyzedCtxId} api={api} agents={agents} />;
  }

  // ─── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-dvh bg-slate-950 text-slate-200">
      {/* Sidebar */}
      <Sidebar
        contexts={contexts}
        agents={agents}
        activeCtx={activeCtx}
        runningCtxIds={Object.keys(runnings)}
        renamingCtx={renamingCtx}
        renameValue={renameValue}
        sidebarOpen={sidebarOpen}
        archiveStatus={archiveStatus}
        contextSizes={contextSizes}
        onSidebarClose={() => setSidebarOpen(false)}
        onCreateContext={() => api.send({ type: "create_context", name: "Новый чат" })}
        onSelectContext={loadContext}
        onDeleteContext={(id) => { if (confirm(`Удалить контекст "${contexts.find(c => c.id === id)?.name}"?`)) api.send({ type: "delete_context", ctxId: id }); }}
        onRenameStart={(id) => { setRenamingCtx(id); setRenameValue(contexts.find(c => c.id === id)?.name ?? ""); }}
        onRenameChange={setRenameValue}
        onRenameConfirm={renameContext}
        onRenameCancel={() => setRenamingCtx(null)}
        onPrepareArchive={onPrepareArchive}
        onDownloadArchive={onDownloadArchive}
        agentName={agentName}
      />

      {/* Chat */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {activeCtx ? (
          <ChatComponent
            ctxId={activeCtx.id}
            context={activeCtx}
            agents={agents}
            api={api}
            messages={messages}
            runningAgentId={running?.agentId ?? null}
            pending={pending}
            waitingAgentId={waitingAgents[activeCtx.id] ?? null}
            recoveryCount={recoveryCounts[activeCtx.id] ?? 0}
            planProgress={planProgress(activePlans[activeCtx.id])}
            onOpenPlanEditor={() => setPlanEditorOpen(true)}
            skills={skills}
            appliedSkills={appliedSkills}
            input={input}
            onInputChange={setInput}
            sentText={sentText}
            setSentText={setSentText}
            attachedFiles={attachedFiles}
            setAttachedFiles={setAttachedFiles}
            onAddFiles={addFiles}
            onSend={(text, files) => {
              api.send({ type: "message", ctxId: activeCtx.id, text, files });
            }}
            onApplySkills={applySkills}
            onCancelHandoff={() => api.send({ type: "cancel_handoff", ctxId: activeCtx.id })}
            onAbort={() => api.send({ type: "abort", ctxId: activeCtx.id })}
            recoveryHistory={recoveryHistories[activeCtx.id] ?? []}
            onOpenRecoveryModal={() => setRecoveryModalOpen(true)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="text-center">
              <p className="text-3xl">🤖</p>
              <p className="mt-3 text-sm text-slate-400 sm:text-base">
                <span className="hidden sm:inline">Выбери контекст задачи слева или создай новый</span>
                <span className="sm:hidden">Открой меню ☰ и выбери контекст</span>
              </p>
              <button
                onClick={() => setSidebarOpen(true)}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 sm:hidden"
              >
                Открыть меню
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Recovery History Modal */}
      {activeCtx && (
        <RecoveryHistoryModal
          isOpen={recoveryModalOpen}
          onClose={() => setRecoveryModalOpen(false)}
          history={recoveryHistories[activeCtx.id] ?? []}
          agentName={agentName}
        />
      )}

      {/* Plan Editor Modal */}
      {activeCtx && (
        <PlanEditorModal
          isOpen={planEditorOpen}
          onClose={() => setPlanEditorOpen(false)}
          plan={activePlans[activeCtx.id]}
          onStatusChange={(stepId, status) => {
            // TODO: Implement API call to update step status
            console.log(`Update step ${stepId} to ${status}`);
          }}
        />
      )}

      {/* Lightbox */}
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}

      {/* Toasts */}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
