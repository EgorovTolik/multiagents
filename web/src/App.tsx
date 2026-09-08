import { useCallback, useEffect, useRef, useState } from "react";
import "highlight.js/styles/atom-one-dark.css";
import type { AgentInfo, ClientApi, ContextMeta, Handoff, Message, ServerMsg } from "./api";
import { useServer } from "./api";
import AgentEditor from "./AgentEditor";
import SettingsPage from "./SettingsPage";
import { Sidebar } from "./components/Sidebar";
import { ChatHeader } from "./components/ChatHeader";
import { MessageRow } from "./components/MessageRow";
import { InputArea, type AttachedFile } from "./components/InputArea";
import { Lightbox } from "./components/Lightbox";
import { ToastContainer, useToasts } from "./components/Toast";

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
  const [running, setRunning] = useState<{ ctxId: string; agentId: string } | null>(null);
  const [pending, setPending] = useState<Handoff | null>(null);
  const [input, setInput] = useState("");
  const [renamingCtx, setRenamingCtx] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [sentText, setSentText] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toasts, notify } = useToasts();

  // Refs
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ClientApi | null>(null);

  // ─── WS message handler ────────────────────────────────────────────────────────
  const handle = useCallback(
    (msg: ServerMsg) => {
      switch (msg.type) {
        case "agents":
          setAgents(msg.agents);
          break;
        case "contexts":
          setContexts(msg.contexts);
          if (!activeCtx && msg.contexts.length > 0) {
            const latest = msg.contexts.reduce((a, b) =>
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
          break;
        case "context_renamed":
          setContexts((cs) => cs.map((c) => (c.id === msg.ctxId ? { ...c, name: msg.name } : c)));
          setActiveCtx((c) => (c?.id === msg.ctxId ? { ...c, name: msg.name } : c));
          break;
        case "history_truncated":
          apiRef.current?.send({ type: "load_context", ctxId: msg.ctxId });
          break;
        case "context_loaded":
          if (msg.context) { setActiveCtx(msg.context); setMessages(msg.messages); }
          break;
        case "message":
          if (msg.ctxId !== activeCtx?.id) break;
          setMessages((m) => [...m, msg.message]);
          if (msg.message.role === "system") {
            setActiveCtx((c) => (c ? { ...c, activeAgentId: msg.message.agentId ?? c.activeAgentId } : c));
          }
          break;
        case "delta":
          if (msg.ctxId !== activeCtx?.id) break;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role === "assistant" && last.agentId === msg.agentId && last.text.endsWith("…")) {
              const copy = [...m];
              copy[m.length - 1] = { ...last, text: last.text.slice(0, -1) + msg.text + "…" };
              return copy;
            }
            return [...m, { role: "assistant", agentId: msg.agentId, text: msg.text + "…", ts: Date.now() }];
          });
          break;
        case "assistant_end":
          if (msg.ctxId !== activeCtx?.id) break;
          setMessages((m) => {
            const i = [...m].reverse().findIndex((x) => x.role === "assistant" && x.agentId === msg.agentId);
            if (i < 0) return m;
            const idx = m.length - 1 - i;
            const copy = [...m];
            copy[idx] = { role: "assistant", agentId: msg.agentId, text: msg.text, ts: Date.now() };
            return copy;
          });
          break;
        case "run_start":
          setRunning({ ctxId: msg.ctxId, agentId: msg.agentId });
          break;
        case "run_end":
          setRunning(null);
          break;
        case "run_state":
          setRunning(msg.running);
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
        case "error":
          setErrors((e) => [...e, msg.message]);
          setTimeout(() => setErrors((e) => e.slice(1)), 5000);
          break;
      }
    },
    [activeCtx?.id],
  );

  const api = useServer(handle);
  apiRef.current = api;

  // ─── Scroll logic ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && isAtBottom) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, running, autoScroll, isAtBottom]);

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

  // ─── Actions ───────────────────────────────────────────────────────────────────
  const loadContext = (ctxId: string) => {
    api.send({ type: "load_context", ctxId });
    setSidebarOpen(false);
  };

  const send = () => {
    const text = input.trim();
    if ((!text && attachedFiles.length === 0) || !activeCtx || sentText !== null) return;
    if (api.status !== "connected") return;
    setSentText(text || "(файл)");
    api.send({ type: "message", ctxId: activeCtx.id, text: text || "Посмотри на файл", files: attachedFiles.length > 0 ? attachedFiles : undefined });
    setInput("");
    setAttachedFiles([]);
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

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  // ─── Agent Editor / Settings routes (after all hooks — Rules of Hooks) ─────────
  if (route === "#/agents") {
    return <AgentEditor onBack={() => { window.location.hash = ""; }} />;
  }
  if (route === "#/settings") {
    return <SettingsPage onBack={() => { window.location.hash = ""; }} />;
  }

  // ─── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-dvh bg-slate-950 text-slate-200">
      {/* Sidebar */}
      <Sidebar
        contexts={contexts}
        agents={agents}
        activeCtx={activeCtx}
        running={running}
        renamingCtx={renamingCtx}
        renameValue={renameValue}
        sidebarOpen={sidebarOpen}
        onSidebarClose={() => setSidebarOpen(false)}
        onCreateContext={() => api.send({ type: "create_context", name: "Новый чат" })}
        onSelectContext={loadContext}
        onDeleteContext={(id) => { if (confirm(`Удалить контекст "${contexts.find(c => c.id === id)?.name}"?`)) api.send({ type: "delete_context", ctxId: id }); }}
        onRenameStart={(id) => { setRenamingCtx(id); setRenameValue(contexts.find(c => c.id === id)?.name ?? ""); }}
        onRenameChange={setRenameValue}
        onRenameConfirm={renameContext}
        onRenameCancel={() => setRenamingCtx(null)}
        agentName={agentName}
      />

      {/* Chat */}
      <main
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-indigo-500/10 backdrop-blur-sm">
            <div className="rounded-xl border-2 border-dashed border-indigo-400 bg-slate-900/80 px-8 py-6 text-center">
              <p className="text-2xl">📎</p>
              <p className="mt-2 text-sm font-medium text-indigo-300">Отпустите файл</p>
            </div>
          </div>
        )}

        {activeCtx ? (
          <>
            <ChatHeader
              ctx={activeCtx}
              running={running}
              pending={pending}
              wsStatus={api.status}
              onOpenSidebar={() => setSidebarOpen(true)}
              onCancelHandoff={() => api.send({ type: "cancel_handoff", ctxId: activeCtx.id })}
              onAbort={() => api.send({ type: "abort" })}
              agentName={agentName}
            />

            {pending && (
              <div className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs text-amber-300">
                ⏳ Запланирована передача: {agentName(pending.from)} → {agentName(pending.to)} — {pending.reason}
              </div>
            )}

            <div className="relative flex-1 min-h-0">
              <div className="h-full overflow-y-auto px-3 py-3 sm:px-5 sm:py-4" ref={scrollRef} onScroll={onScroll}>
                {messages.map((m, i) => (
                  <MessageRow
                    key={i}
                    m={m}
                    index={i}
                    agentName={agentName}
                    onImageClick={setLightbox}
                    onTruncate={(idx) => {
                      if (!confirm("Удалить историю начиная с этого сообщения?")) return;
                      apiRef.current?.send({ type: "truncate_history", ctxId: activeCtx!.id, fromIndex: idx });
                    }}
                    notify={notify}
                  />
                ))}
                {messages.length === 0 && (
                  <div className="flex h-full items-center justify-center text-sm text-slate-600">
                    Напиши сообщение — диалог начнётся с оркестратора
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
              </button>
            </div>

            {/* Input */}
            {errors.length > 0 && (
              <div className="border-t border-slate-800 px-3 py-1 text-xs text-rose-400 sm:px-4">{errors[errors.length - 1]}</div>
            )}
            <InputArea
              input={input}
              onInputChange={setInput}
              onSend={send}
              onAddFiles={addFiles}
              attachedFiles={attachedFiles}
              onRemoveFile={(i) => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
              placeholder={`Сообщение для: ${agentName(activeCtx.activeAgentId)}`}
              disabled={(input.trim() === "" && attachedFiles.length === 0) || sentText !== null || api.status !== "connected"}
              sentText={sentText}
            />
          </>
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

      {/* Lightbox */}
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}

      {/* Toasts */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}
