import { useCallback, useEffect, useState } from "react";
import type { AgentInfo, ClientApi, ContextMeta, Message, SkillInfo } from "./api";
import { useServer } from "./api";
import { SimpleChat } from "./components/SimpleChat";
import { fmtTime } from "./utils/format";

interface Props {
  analyzedCtxId: string;
  onBack: () => void;
}

export default function MistakesPage({ analyzedCtxId, onBack }: Props) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [analyzedCtx, setAnalyzedCtx] = useState<ContextMeta | null>(null);
  const [analyzedMessages, setAnalyzedMessages] = useState<Message[]>([]);
  const [loadingAnalyzed, setLoadingAnalyzed] = useState(true);

  // Загрузить агентов и навыки один раз
  useEffect(() => {
    (async () => {
      try {
        const [agentsResp, skillsResp] = await Promise.all([
          fetch("/api/agents"),
          fetch("/api/skills"),
        ]);
        if (agentsResp.ok) setAgents(await agentsResp.json());
        if (skillsResp.ok) setSkills(await skillsResp.json());
      } catch { /* ignore */ }
    })();
  }, []);

  // Загрузить анализируемый контекст и его сообщения
  useEffect(() => {
    (async () => {
      try {
        setLoadingAnalyzed(true);
        const ctxResp = await fetch(`/api/contexts/${analyzedCtxId}`);
        if (ctxResp.ok) {
          setAnalyzedCtx(await ctxResp.json());
        }
        const msgsResp = await fetch(`/api/contexts/${analyzedCtxId}/messages`);
        if (msgsResp.ok) {
          setAnalyzedMessages(await msgsResp.json());
        }
      } catch { /* ignore */ } finally {
        setLoadingAnalyzed(false);
      }
    })();
  }, [analyzedCtxId]);

  // Callback для SimpleChat — будет вызываться при получении сообщений
  const chatHandleMsg = useCallback((msg: ServerMsg) => {
    // SimpleChat обрабатывает все сообщения чата через этот callback
  }, []);
  const api = useServer(chatHandleMsg);

  // Создание сессии анализа через API
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch("/api/work-on-mistakes/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analyzedCtxId }),
        });
        if (resp.ok) {
          setSession(await resp.json());
        }
      } catch { /* ignore */ }
    })();
  }, [analyzedCtxId]);

  if (!session) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-slate-100">
        Создание сессии анализа...
      </div>
    );
  }

  const agentName = (id: string) => {
    const a = agents.find((x) => x.id === id);
    return a ? a.name : id;
  };

  // Левая панель: история анализируемого контекста
  const LeftPanel = () => (
    <div className="flex h-full flex-col border-r border-slate-800 bg-slate-950">
      <div className="border-b border-slate-800 p-3">
        <h2 className="text-sm font-bold text-slate-200">
          {loadingAnalyzed ? "Загрузка..." : `История: ${analyzedCtx?.name ?? analyzedCtxId}`}
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loadingAnalyzed ? (
          <p className="text-xs text-slate-500">Загрузка сообщений...</p>
        ) : analyzedMessages.length === 0 ? (
          <p className="text-xs text-slate-500">Нет сообщений</p>
        ) : (
          analyzedMessages.map((m, i) => (
            <div key={i} className="mb-3">
              <div className={`flex items-center gap-1.5 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role !== "user" && m.agentId && (
                  <span className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-400">
                    {agentName(m.agentId)}
                  </span>
                )}
                {m.role === "system" && (
                  <span className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[10px] text-slate-500">
                    система
                  </span>
                )}
              </div>
              <div className={`mt-1 rounded-lg border px-3 py-2 text-xs ${
                m.role === "user" ? "border-indigo-800 bg-indigo-950/40" :
                m.role === "system" ? "border-slate-800 bg-slate-900/60 text-slate-400" :
                "border-slate-700 bg-slate-900"
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-mono text-slate-500">msg-{i + 1}</span>
                  <span className="text-[9px] text-slate-500">{fmtTime(m.ts)}</span>
                </div>
                {m.thinking && (
                  <details className="mb-2 rounded border border-slate-800 bg-slate-950/60">
                    <summary className="cursor-pointer px-2 py-1 text-[10px] font-medium text-violet-400/70">💭 Размышления</summary>
                    <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-t border-slate-800 px-2 py-1 italic text-slate-500">{m.thinking}</div>
                  </details>
                )}
                <div className={`whitespace-pre-wrap break-words ${m.role === "system" ? "text-slate-400" : ""}`}>
                  {m.text}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  // Правая панель: чат с flow-manager
  const RightPanel = () => (
    <div className="flex h-full flex-col">
      <SimpleChat
        ctxId={session.id}
        api={api}
        agents={agents}
        agentName={agentName}
        onBack={onBack}
      />
    </div>
  );

  return (
    <div className="flex h-dvh bg-slate-950 text-slate-100">
      <div className="w-1/2 overflow-hidden">
        <LeftPanel />
      </div>
      <div className="w-1/2 overflow-hidden">
        <RightPanel />
      </div>
    </div>
  );
}