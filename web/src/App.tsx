import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/atom-one-dark.css";
import {
  AgentInfo,
  ClientApi,
  ContextMeta,
  Handoff,
  Message,
  ServerMsg,
  agentColor,
  useServer,
} from "./api";
import AgentEditor from "./AgentEditor";

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const fn = () => setHash(window.location.hash);
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  return hash;
}

export default function App() {
  const route = useHashRoute();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [contexts, setContexts] = useState<ContextMeta[]>([]);
  const [activeCtx, setActiveCtx] = useState<ContextMeta | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState<{ ctxId: string; agentId: string } | null>(null);
  const [pending, setPending] = useState<Handoff | null>(null);
  const [input, setInput] = useState("");
  const [renamingCtx, setRenamingCtx] = useState<string | null>(null); // id контекста в режиме переименования
  const [renameValue, setRenameValue] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [sentText, setSentText] = useState<string | null>(null); // текст, ожидающий подтверждения
  const [autoScroll, setAutoScroll] = useState(true); // авто-скролл включён?
  const [isAtBottom, setIsAtBottom] = useState(true); // пользователь внизу?
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; mediaType: string; data: string; size: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null); // URL изображения для lightbox
  const [sidebarOpen, setSidebarOpen] = useState(false); // мобильный сайдбар
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ClientApi | null>(null);

  // Автоувеличение поля ввода: минимум 3 строки (rows), максимум 12 (maxHeight).
  const autoExpand = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  const handle = useCallback(
    (msg: ServerMsg) => {
      switch (msg.type) {
        case "agents":
          setAgents(msg.agents);
          break;
        case "contexts":
          setContexts(msg.contexts);
          // При загрузке страницы — автоматически выбираем контекст с последним сообщением
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
          setContexts((cs) =>
            cs.map((c) => (c.id === msg.ctxId ? { ...c, name: msg.name } : c)),
          );
          setActiveCtx((c) => (c?.id === msg.ctxId ? { ...c, name: msg.name } : c));
          break;
        case "history_truncated":
          // Перезапрашиваем сообщения
          apiRef.current?.send({ type: "load_context", ctxId: msg.ctxId });
          break;
        case "context_loaded":
          if (msg.context) {
            setActiveCtx(msg.context);
            setMessages(msg.messages);
          }
          break;
        case "message":
          if (msg.ctxId !== activeCtx?.id) break;
          setMessages((m) => [...m, msg.message]);
          if (msg.message.role === "system") {
            // handoff — обновляем активного агента
            setActiveCtx((c) => (c ? { ...c, activeAgentId: msg.message.agentId ?? c.activeAgentId } : c));
          }
          break;
        case "delta":
          if (msg.ctxId !== activeCtx?.id) break;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role === "assistant" && last.agentId === msg.agentId && last.text.endsWith("…")) {
              const copy = [...m];
              // сохраняем маркер "…" — сообщение ещё стримится
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
          // обновляем и сайдбар, и активный контекст
          setContexts((cs) =>
            cs.map((c) =>
              c.id === msg.ctxId
                ? { ...c, activeAgentId: msg.handoff.to, handoffs: [...c.handoffs, msg.handoff] }
                : c,
            ),
          );
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
          // сервер подтвердил получение — очищаем поле ввода
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

  // Авто-скролл: только если пользователь внизу И авто-скролл включён.
  // Используем мгновенный скролл (scrollTop), а не smooth — иначе анимации
  // конфликтуют при быстром стриминге и чат «дёргается».
  useEffect(() => {
    if (autoScroll && isAtBottom) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, running, autoScroll, isAtBottom]);

  // Обработка скролла: определяем, внизу ли пользователь
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setIsAtBottom(atBottom);
    if (atBottom) setAutoScroll(true);
  }, []);

  // Кнопка «вниз»: скролл к последнему + включаем авто-скролл
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setAutoScroll(true);
    setIsAtBottom(true);
  }, []);

  const loadContext = (ctxId: string) => {
    api.send({ type: "load_context", ctxId });
    setSidebarOpen(false); // на мобильном закрываем сайдбар после выбора
  };

  const send = () => {
    const text = input.trim();
    if ((!text && attachedFiles.length === 0) || !activeCtx || sentText !== null) return;
    // Если WS не подключён — не отправляем, текст остаётся в поле
    if (api.status !== "connected") return;
    setSentText(text || "(файл)");
    api.send({ type: "message", ctxId: activeCtx.id, text: text || "Посмотри на файл", files: attachedFiles.length > 0 ? attachedFiles : undefined });
    setInput("");
    setAttachedFiles([]);
    // Сброс высоты textarea до минимальной
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) { el.style.height = "auto"; el.style.height = "3.5rem"; }
    });
  };

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    arr.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        setAttachedFiles((prev) => [...prev, { name: file.name, mediaType: file.type || "application/octet-stream", data: base64, size: file.size }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const renameContext = () => {
    const name = renameValue.trim();
    if (renamingCtx && name) {
      api.send({ type: "rename_context", ctxId: renamingCtx, name });
    }
    setRenamingCtx(null);
  };

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  // Страница редактора агентов (после всех хуков — Rules of Hooks)
  if (route === "#/agents") {
    return <AgentEditor onBack={() => { window.location.hash = ""; }} />;
  }

  return (
    <div className="flex h-dvh bg-slate-950 text-slate-200">
      {/* Мобильный оверлей */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Сайдбар: контексты задач */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-slate-800 p-4">
          <h1 className="text-lg font-semibold text-white">Multiagents</h1>
          <p className="mt-1 text-xs text-slate-500">мультиагентная система на pi</p>
          <a
            href="#/agents"
            className="mt-3 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
          >
            ⚙️ Редактор агентов
          </a>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Контексты задач
            </span>
            <button
              onClick={() => api.send({ type: "create_context", name: "Новый чат" })}
              className="rounded px-2 py-0.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              +
            </button>
          </div>
          {contexts.map((c) => (
            <div
              key={c.id}
              className={`group mb-1 flex items-center rounded-md pr-1 ${
                activeCtx?.id === c.id ? "bg-slate-800" : "hover:bg-slate-900"
              }`}
            >
              {renamingCtx === c.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") renameContext();
                    if (e.key === "Escape") setRenamingCtx(null);
                  }}
                  onBlur={renameContext}
                  className="w-full min-w-0 flex-1 rounded border border-indigo-500 bg-slate-900 px-2 py-1 text-sm text-white outline-none"
                />
              ) : (
                <button
                  onClick={() => loadContext(c.id)}
                  onDoubleClick={() => {
                    setRenamingCtx(c.id);
                    setRenameValue(c.name);
                  }}
                  className={`block w-full min-w-0 flex-1 px-3 py-2 text-left text-sm ${
                    activeCtx?.id === c.id ? "text-white" : "text-slate-400"
                  }`}
                >
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        activeCtx?.id === c.id && running?.ctxId === c.id ? "animate-pulse bg-emerald-400" : "bg-slate-600"
                      }`}
                    />
                    {agentName(c.activeAgentId)}
                    {c.handoffs.length > 0 && (
                      <span className="text-slate-600">· {c.handoffs.length} передач</span>
                    )}
                  </div>
                </button>
              )}
              <button
                onClick={() => {
                  if (confirm(`Удалить контекст "${c.name}"?`)) {
                    api.send({ type: "delete_context", ctxId: c.id });
                  }
                }}
                title="Удалить контекст"
                className="hidden shrink-0 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-rose-500/20 hover:text-rose-300 group-hover:block"
              >
                ✕
              </button>
            </div>
          ))}
          {contexts.length === 0 && (
            <p className="px-2 py-4 text-xs text-slate-600">
              Нет контекстов — создай первый, чтобы начать
            </p>
          )}
        </div>
        <div className="border-t border-slate-800 p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Агенты</span>
          <ul className="mt-2 space-y-1">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-xs text-slate-400" title={a.description}>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${agentColor(a.id)}`}
                >
                  {a.id}
                </span>
                <span className="truncate">{a.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Чат */}
      <main
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
      >
        {/* Overlay при drag-and-drop */}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-indigo-500/10 backdrop-blur-sm">
            <div className="rounded-xl border-2 border-dashed border-indigo-400 bg-slate-900/80 px-8 py-6 text-center">
              <p className="text-2xl">📎</p>
              <p className="mt-2 text-sm font-medium text-indigo-300">Отпустите файл изображения</p>
            </div>
          </div>
        )}
        {activeCtx ? (
          <>
            <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3">
              {/* Гамбургер — только на мобильных */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="-ml-1 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white md:hidden"
                aria-label="Меню"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              </button>
              <h2 className="min-w-0 truncate font-semibold text-white">{activeCtx.name}</h2>
              <span
                className={`rounded border px-2 py-0.5 text-xs ${agentColor(activeCtx.activeAgentId)}`}
              >
                {agentName(activeCtx.activeAgentId)}
              </span>
              {running?.ctxId === activeCtx.id && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  {agentName(running.agentId)} работает…
                </span>
              )}
              {/* Индикатор статуса WS */}
              <span
                className={`ml-auto h-2.5 w-2.5 shrink-0 rounded-full ${
                  api.status === "connected" ? "bg-emerald-400" : api.status === "connecting" ? "bg-amber-400 animate-pulse" : "bg-red-500"
                }`}
                title={api.status === "connected" ? "Подключено" : api.status === "connecting" ? "Подключение…" : "Отключено"}
              />
              <div className="flex shrink-0 gap-1.5 sm:gap-2">
                {pending && (
                  <button
                    onClick={() => api.send({ type: "cancel_handoff", ctxId: activeCtx.id })}
                    className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/20 sm:px-3"
                  >
                    <span className="hidden sm:inline">Отменить передачу → {agentName(pending.to)}</span>
                    <span className="sm:hidden">✕ {agentName(pending.to)}</span>
                  </button>
                )}
                {running && (
                  <button
                    onClick={() => api.send({ type: "abort" })}
                    className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20 sm:px-3"
                  >
                    <span className="hidden sm:inline">■ Остановить</span>
                    <span className="sm:hidden">■</span>
                  </button>
                )}
              </div>
            </header>

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
                  />
                ))}
                {messages.length === 0 && (
                  <div className="flex h-full items-center justify-center text-sm text-slate-600">
                    Напиши сообщение — диалог начнётся с оркестратора
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              {/* Кнопка «вниз» — зафиксирована над панелью ввода, fade in/out */}
              <button
                onClick={scrollToBottom}
                className={`absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-600 bg-slate-800/90 text-slate-300 shadow-lg backdrop-blur transition-all duration-300 hover:bg-slate-700 hover:text-white sm:right-5 ${
                  isAtBottom
                    ? "pointer-events-none translate-y-2 opacity-0"
                    : "translate-y-0 opacity-100"
                }`}
                title="К последнему сообщению"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
              </button>
            </div>

            <div className="border-t border-slate-800 p-3 sm:p-4">
              {errors.length > 0 && (
                <div className="mb-2 text-xs text-rose-400">{errors[errors.length - 1]}</div>
              )}
              {/* Превью прикреплённых файлов */}
              {attachedFiles.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {attachedFiles.map((f, i) => (
                    <div key={i} className="relative group">
                      {f.mediaType.startsWith("image/") ? (
                        <img
                          src={`data:${f.mediaType};base64,${f.data}`}
                          alt={f.name}
                          className="h-16 w-16 rounded-md border border-slate-700 object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-24 flex-col items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-1">
                          <span className="text-lg">📄</span>
                          <span className="w-full truncate text-center text-[10px] text-slate-400">{f.name}</span>
                          <span className="text-[9px] text-slate-500">{f.size < 1024 ? f.size + " Б" : f.size < 1048576 ? (f.size/1024).toFixed(1) + " КБ" : (f.size/1048576).toFixed(1) + " МБ"}</span>
                        </div>
                      )}
                      <button
                        onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-xs text-white opacity-0 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                {/* Кнопка вложения изображения */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="*/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="self-stretch rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm hover:bg-slate-700"
                  title="Прикрепить файл (или перетащите / вставьте)">
                  📎
                </button>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    autoExpand();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (items) {
                      const files: File[] = [];
                      for (const item of items) {
                        if (item.type.startsWith("image/")) {
                          const file = item.getAsFile();
                          if (file) files.push(file);
                        }
                      }
                      if (files.length > 0) {
                        e.preventDefault();
                        addFiles(files);
                      }
                    }
                  }}
                  rows={2}
                  placeholder={`Сообщение для: ${agentName(activeCtx.activeAgentId)}`}
                  style={{ minHeight: "3.5rem", maxHeight: "12rem" }}
                  className="flex-1 resize-none overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
                <button
                  onClick={send}
                  disabled={(input.trim() === "" && attachedFiles.length === 0) || sentText !== null || api.status !== "connected"}
                  className="self-stretch rounded-lg bg-indigo-600 px-4 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 sm:px-5"
                >
                  <span className="hidden sm:inline">{sentText !== null ? "Отправлено…" : "Отправить"}</span>
                  <span className="sm:hidden">➤</span>
                </button>
              </div>
            </div>
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

      {/* Lightbox — просмотр изображения на весь экран */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-3xl text-white/80 hover:text-white"
            onClick={() => setLightbox(null)}
            aria-label="Закрыть"
          >
            ✕
          </button>
          <div className="max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightbox}
              alt="Preview"
              className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
            />
            <div className="mt-3 flex justify-center">
              <a
                href={lightbox}
                download
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                ⬇ Скачать
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return `${hh}:${mm}`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mo}.${yyyy} ${hh}:${mm}`;
}

function MessageMenu({ onTruncate }: { onTruncate: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="group relative ml-1.5 inline-block align-middle">
      <button
        onClick={() => setOpen(!open)}
        className="flex h-5 w-5 items-center justify-center rounded-md border border-slate-700 bg-slate-800/80 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 hover:border-slate-600 hover:text-slate-300"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <circle cx="5" cy="2" r="1" />
          <circle cx="5" cy="5" r="1" />
          <circle cx="5" cy="8" r="1" />
        </svg>
      </button>
      {open && (
        <span className="absolute right-0 top-full z-50 mt-1 block w-36 rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl">
          <button
            onClick={() => { setOpen(false); onTruncate(); }}
            className="block w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-slate-700"
          >
            Удалить с этого сообщения
          </button>
        </span>
      )}
    </span>
  );
}

function MessageRow({
  m,
  index,
  agentName,
  onImageClick,
  onTruncate,
}: {
  m: Message;
  index: number;
  agentName: (id: string) => string;
  onImageClick: (url: string) => void;
  onTruncate: (index: number) => void;
}) {
  const menuBtn = <MessageMenu onTruncate={() => onTruncate(index)} />;

  if (m.role === "system") {
    return (
      <div className="group my-3 flex justify-center">
        <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-400">
          {m.text}
        </span>
        {menuBtn}
      </div>
    );
  }
  if (m.role === "user") {
    return (
      <div className="group mb-2 flex items-start justify-end sm:mb-3">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600/80 px-3 py-2 text-sm sm:max-w-[75%] sm:px-4">
          <div className="md-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                img: ({ src, alt }) => (
                  <img
                    src={src}
                    alt={alt ?? ""}
                    onClick={() => src && onImageClick(src)}
                  />
                ),
              }}
            >
              {m.text}
            </ReactMarkdown>
          </div>
          <div className="mt-1 text-right text-[10px] text-indigo-200/70">{fmtTime(m.ts)}</div>
        </div>
        {menuBtn}
      </div>
    );
  }
  return (
    <div className="group mb-2 flex items-start justify-start sm:mb-3">
      <div className="max-w-[85%] sm:max-w-[75%]">
        <span
          className={`mb-1 inline-block rounded border px-1.5 py-0.5 text-[10px] ${
            m.agentId ? agentColor(m.agentId) : "border-slate-700 text-slate-400"
          }`}
        >
          {m.agentId ? agentName(m.agentId) : "система"}
        </span>
        <div className="md-content rounded-2xl rounded-tl-sm border border-slate-800 bg-slate-900 px-4 py-2 text-sm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              img: ({ src, alt }) => (
                <img
                  src={src}
                  alt={alt ?? ""}
                  onClick={() => src && onImageClick(src)}
                />
              ),
            }}
          >
            {m.text}
          </ReactMarkdown>
          <div className="mt-1 text-left text-[10px] text-slate-500">{fmtTime(m.ts)}</div>
        </div>
      </div>
      {menuBtn}
    </div>
  );
}
