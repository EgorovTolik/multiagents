import { useCallback, useEffect, useState } from "react";
import type { AgentInfo, ClientApi, ContextMeta, Message, SkillInfo } from "./api";
import { useServer } from "./api";
import { SimpleChat } from "./components/SimpleChat";
import { MessageRow } from "./components/MessageRow";
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
            <MessageRow
              key={i}
              m={m}
              index={i}
              streaming={false}
              agentName={agentName}
              onImageClick={() => {}}
              onTruncate={() => {}}
            />
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