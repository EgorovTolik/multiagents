import { useState, useEffect } from "react";
import PageHeader from "./components/PageHeader";
import SimpleChat from "./components/SimpleChat";
import { FlowManagerChat } from "./components/FlowManagerChat";
import type { ClientApi, ContextMeta } from "./api";
import type { Message } from "./types";

interface MistakesPageProps {
  analyzedCtxId: string;
  api: ClientApi;
}

export default function MistakesPage({ analyzedCtxId, api }: MistakesPageProps) {
  const [analyzedCtx, setAnalyzedCtx] = useState<{ id: string; name: string } | null>(null);
  const [analyzedMessages, setAnalyzedMessages] = useState<Message[]>([]);

  // State для FlowManagerChat (пока заглушки)
  const [flowInput, setFlowInput] = useState("");
  const [flowSentText, setFlowSentText] = useState<string | null>(null);
  const [flowAttachedFiles, setFlowAttachedFiles] = useState([]);

  // Загрузить информацию об анализируемом контексте
  useEffect(() => {
    fetch(`/api/contexts/${analyzedCtxId}`)
      .then((r) => r.json())
      .then((data) => setAnalyzedCtx(data))
      .catch(() => {});
    
    // Загрузить историю сообщений анализируемого контекста
    fetch(`/api/contexts/${analyzedCtxId}/messages`)
      .then((r) => r.json())
      .then((data) => {
        // Map API response to Message format: { role, agentId, text }
        const mapped = (data.messages || []).map((m: any, i: number) => ({
          role: m.role,
          agentId: m.agentId,
          text: m.text,
          thinking: m.thinking,
          ts: m.ts || Date.now(),
          id: `msg-${i + 1}`,
        }));
        setAnalyzedMessages(mapped);
      })
      .catch(() => {});
  }, [analyzedCtxId]);

  const agentName = (id: string) => {
    return id; // Пока просто ID, позже можно маппить на имена
  };

  return (
    <div className="flex h-dvh flex-col bg-slate-900 text-slate-100">
      {/* Заголовок */}
      <PageHeader
        title="Работа над ошибками"
        onBack={() => { window.location.hash = ""; }}
      />

      {/* Основной контент */}
      <div className="flex flex-1 w-full overflow-hidden">
        {/* Левая панель: история анализируемого контекста */}
        <div className="flex min-h-0 h-full w-1/2 flex-col border-r border-slate-800 bg-slate-950">
          <SimpleChat
            messages={analyzedMessages}
            msgIds={analyzedMessages.map((m) => m.id)}
            agentName={agentName}
          />
          {/* Sticky bottom header */}
          <div className="border-t border-slate-800 bg-slate-950 p-3">
            <h2 className="text-sm font-bold text-slate-200">
              История: {analyzedCtx ? analyzedCtx.name : analyzedCtxId}
            </h2>
          </div>
        </div>

        {/* Правая панель: чат с flow-manager */}
        <div className="flex min-h-0 h-full w-1/2 flex-col bg-slate-950">
          <FlowManagerChat
            ctxId="flow-test"
            api={api}
            messages={[]}
            runningAgentId={null}
            skills={[]}
            appliedSkills={[]}
            input={flowInput}
            onInputChange={setFlowInput}
            sentText={flowSentText}
            setSentText={setFlowSentText}
            attachedFiles={flowAttachedFiles}
            setAttachedFiles={setFlowAttachedFiles}
            onAddFiles={() => {}}
            onSend={() => {}}
            onApplySkills={() => {}}
            onAbort={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
