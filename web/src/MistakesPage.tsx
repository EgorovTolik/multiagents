import { useState, useEffect } from "react";
import PageHeader from "./components/PageHeader";
import SimpleChat from "./components/SimpleChat";
import type { ClientApi, ContextMeta } from "./api";
import type { Message } from "./types";

interface MistakesPageProps {
  analyzedCtxId: string;
  api: ClientApi;
}

export default function MistakesPage({ analyzedCtxId, api }: MistakesPageProps) {
  const [analyzedCtx, setAnalyzedCtx] = useState<{ id: string; name: string } | null>(null);
  const [analyzedMessages, setAnalyzedMessages] = useState<Message[]>([]);

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
        const mapped = (data.messages || []).map((m: any) => ({
          role: m.role,
          agentId: m.agentId,
          text: m.text,
          thinking: m.thinking,
          ts: m.ts || Date.now(),
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
        <div className="flex h-full w-1/2 flex-col bg-slate-950">
          { /* Тут будет живой чат с агентом flow-manager */ }
        </div>
      </div>
    </div>
  );
}
