import { useState, useEffect, useCallback } from "react";
import PageHeader from "./components/PageHeader";
import SimpleChat from "./components/SimpleChat";
import { FlowManagerChat } from "./components/FlowManagerChat";
import type { AgentInfo, ClientApi, ContextMeta, Message } from "./api";
import { useFlowManagerApi } from "./hooks/useFlowManagerApi";
import type { AttachedFile } from "./components/InputArea";

interface MistakesPageProps {
  analyzedCtxId: string;
  api: ClientApi;
  agents: AgentInfo[];
}

export default function MistakesPage({ analyzedCtxId, api, agents }: MistakesPageProps) {
  const [analyzedCtx, setAnalyzedCtx] = useState<{ id: string; name: string } | null>(null);
  const [analyzedMessages, setAnalyzedMessages] = useState<Message[]>([]);

  // Hook для flow-manager коммуникации (отдельный WebSocket + state)
  const flowManagerApi = useFlowManagerApi({ api, analyzedCtxId });

  // State для FlowManagerChat UI
  const [flowInput, setFlowInput] = useState("");
  const [flowSentText, setFlowSentText] = useState<string | null>(null);
  const [flowAttachedFiles, setFlowAttachedFiles] = useState<AttachedFile[]>([]);

  // Сбрасываем sentText когда агент завершил ответ (на основе WebSocket событий)
  useEffect(() => {
    if (!flowManagerApi.isFlowRunning() && flowSentText !== null) {
      setFlowSentText(null);
    }
  }, [flowManagerApi, flowSentText]);

  // Загрузить информацию об анализируемом контексте и восстановить/создать mistakes сессию
  useEffect(() => {
    fetch(`/api/contexts/${analyzedCtxId}`)
      .then((r) => r.json())
      .then((data) => setAnalyzedCtx(data))
      .catch((e) => console.warn("Failed to load analyzed context info:", e));
    
    // Загрузить историю сообщений анализируемого контекста
    // Фильтруем flow-manager сообщения — они не должны отображаться в истории задачи
    fetch(`/api/contexts/${analyzedCtxId}/messages`)
      .then((r) => r.json())
      .then((data) => {
        const mapped = (data.messages || [])
          .filter((m: any) => m.agentId !== "flow-manager")
          .map((m: any, i: number) => ({
            role: m.role,
            agentId: m.agentId,
            text: m.text,
            thinking: m.thinking,
            ts: m.ts || Date.now(),
            id: `msg-${i + 1}`,
          }));
        setAnalyzedMessages(mapped);
      })
      .catch((e) => console.warn("Failed to load analyzed context messages:", e));

    // Восстановить существующую mistakes сессию или создать новую
    // Вызывается один раз при монтировании и изменении analyzedCtxId
    flowManagerApi.loadExistingSession().catch((e) => console.warn("Failed to load/create mistakes session:", e));
  }, [analyzedCtxId]);

  const agentName = useCallback((id: string) => agents.find((a) => a.id === id)?.name ?? id, [agents]);

  // Отправка сообщения flow-manager (создаёт сессию при первом сообщении)
  const handleFlowSend = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setFlowSentText(text);
    setFlowInput("");

    let sessionId = flowManagerApi.getSessionId();
    // Если сессия ещё не создана — создаём её сейчас и используем возвращённый ID
    if (!sessionId) {
      sessionId = await flowManagerApi.createSession();
    }
    if (!sessionId) return;

    // Отправить сообщение через WebSocket
    flowManagerApi.send({ type: "message", ctxId: sessionId, text });
  }, [analyzedCtxId, flowManagerApi]);

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
            msgIds={analyzedMessages.map((m, i) => m.id ?? `msg-${i}`)}
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
            ctxId={flowManagerApi.getSessionId() || analyzedCtxId}
            api={api}
            messages={flowManagerApi.getFlowMessages()}
            runningAgentId={flowManagerApi.isFlowRunning() ? "flow-manager" : null}
            agentName={agentName}
            skills={[]}
            appliedSkills={[]}
            input={flowInput}
            onInputChange={setFlowInput}
            sentText={flowSentText}
            setSentText={setFlowSentText}
            attachedFiles={flowAttachedFiles}
            setAttachedFiles={setFlowAttachedFiles}
            onAddFiles={() => {}}
            onSend={(text, files) => handleFlowSend(text)}
            onApplySkills={() => {}}
            onAbort={() => flowManagerApi.send({ type: "abort", ctxId: flowManagerApi.getSessionId() ?? analyzedCtxId })}
          />
        </div>
      </div>
    </div>
  );
}
