import { useEffect, useRef } from "react";
import type { Message } from "../types";
import { MessageRow } from "./MessageRow";

interface SimpleChatProps {
  messages: Message[];
  title?: string;
  agentName: (id: string) => string;
}

export default function SimpleChat({ messages, title, agentName }: SimpleChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Автоскролл вниз
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex min-h-0 h-full flex-col">
      {title && (
        <div className="border-b border-slate-800 p-3">
          <h2 className="text-sm font-bold text-slate-200">{title}</h2>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 ? (
          <p className="text-xs text-slate-500">Нет сообщений</p>
        ) : (
          messages.map((m, i) => (
            <MessageRow
              key={i}
              m={m}
              index={i}
              streaming={false}
              agentName={agentName}
              onImageClick={() => {}}
              onTruncate={() => {}}
              notify={() => {}}
            />
          ))
        )}
      </div>
    </div>
  );
}
