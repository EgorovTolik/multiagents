import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

import type { AgentDef } from "./registry.js";
import type { ContextStore } from "./context-store.js";
import { buildAgentTools } from "./agent-tools.js";

/**
 * Управляет Pi сессиями агентов: создание, кэширование, привязка инструментов.
 */
export class AgentSessionManager {
  private sessions = new Map<string, AgentSession>();
  private pendingThinking = new Map<string, string>();
  private pendingText = new Map<string, string>();
  private msgIdCounter = new Map<string, number>();

  constructor(
    private ctxStore: ContextStore,
    private getCtxDir: (ctxId: string) => string,
    private modelRuntime: any,
    private resolveModel: (id?: string) => any,
    private ensureModelRegistered: (runtime: any, spec: string) => Promise<void>,
    private buildTools: typeof buildAgentTools,
    private registry: any,
    private promptBuilder: any,
    private skillInjector: any,
    private onSessionEvent: (ctxId: string, agentId: string, ev: any) => void,
  ) {}

  /** Получить или создать сессию для агента. */
  async getSession(
    ctxId: string,
    agentId: string,
    def: AgentDef,
    emit: (msg: any) => void,
    sharedDir: string,
    agentsDir: string,
    maxHandoffs: number,
    defaultDisabledToolNames: () => Promise<string[]>,
  ): Promise<AgentSession> {
    const key = this.key(ctxId, agentId);
    if (this.sessions.has(key)) return this.sessions.get(key)!;

    const ctxDir = this.getCtxDir(ctxId);
    let excludeTools = def.disabledTools ?? [];
    try {
      const ctx = this.ctxStore.get(ctxId);
      if (ctx?.trainingAgentId) {
        excludeTools = excludeTools.filter((t: string) => !["read", "write", "edit", "bash"].includes(t));
      }
    } catch { /* ignore */ }

    const customTools = this.buildTools(
      ctxId, agentId, def,
      this.ctxStore, this.registry, emit,
      this.getCtxDir, sharedDir, agentsDir,
      maxHandoffs, defaultDisabledToolNames, this.skillInjector, () => key,
    );

    let model = this.resolveModel(def.model);
    if (def.model && !model) {
      await this.ensureModelRegistered(this.modelRuntime, def.model);
      model = this.resolveModel(def.model);
    }

    const loader = new DefaultResourceLoader({
      cwd: ctxDir,
      agentDir: getAgentDir(),
      systemPromptOverride: () => this.promptBuilder.buildSystemPrompt(def, ctxDir),
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: ctxDir,
      model,
      thinkingLevel: def.thinkingLevel as never,
      excludeTools: excludeTools.length > 0 ? excludeTools : undefined,
      customTools,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(ctxDir),
    });

    try {
      await session.bindExtensions({});
    } catch (e) {
      console.error(`[ctxId:${ctxId}] bindExtensions failed:`, e);
    }

    // Загрузить историю сообщений в сессию
    try {
      const history = this.ctxStore.readMessages(ctxId).filter((m) => m.role === "user" || m.role === "assistant");
      if (history.length > 0) {
        (session as any).agent.state.messages = history.map((m) => ({ role: m.role, content: [{ type: "text", text: m.text }] }));
      }
    } catch { /* ignore */ }

    session.subscribe((ev: any) => {
      this.onSessionEvent(ctxId, agentId, ev);
    });

    this.sessions.set(key, session);
    return session;
  }

  /** Закрыть сессию. */
  async closeSession(ctxId: string, agentId: string) {
    const key = this.key(ctxId, agentId);
    const session = this.sessions.get(key);
    if (session) {
      try { session.dispose(); } catch { /* ignore */ }
      this.sessions.delete(key);
    }
  }

  /** Закрыть все сессии. */
  async closeAll() {
    for (const [_key, session] of [...this.sessions]) {
      try { session.dispose(); } catch { /* ignore */ }
    }
    this.sessions.clear();
  }

  /** Получить pending thinking для сессии. */
  getPendingThinking(ctxId: string, agentId: string): string | undefined {
    return this.pendingThinking.get(this.key(ctxId, agentId));
  }

  setPendingThinking(ctxId: string, agentId: string, text: string) {
    this.pendingThinking.set(this.key(ctxId, agentId), text);
  }

  /** Получить pending text для сессии. */
  getPendingText(ctxId: string, agentId: string): string | undefined {
    return this.pendingText.get(this.key(ctxId, agentId));
  }

  setPendingText(ctxId: string, agentId: string, text: string) {
    this.pendingText.set(this.key(ctxId, agentId), text);
  }

  // Message ID management for logical event grouping
  private msgKey(ctxId: string, agentId: string): string {
    return `msg-${this.key(ctxId, agentId)}`;
  }

  incrementMsgId(ctxId: string, agentId: string): number {
    const k = this.msgKey(ctxId, agentId);
    const current = this.msgIdCounter.get(k) ?? 0;
    const next = current + 1;
    this.msgIdCounter.set(k, next);
    return next;
  }

  getMsgId(ctxId: string, agentId: string): number {
    return this.msgIdCounter.get(this.msgKey(ctxId, agentId)) ?? 0;
  }

  /** Получить сессию по ключу. */
  getSessionByCtxAndAgent(ctxId: string, agentId: string): AgentSession | undefined {
    return this.sessions.get(this.key(ctxId, agentId));
  }

  /** Проверить существует ли сессия. */
  hasSession(ctxId: string, agentId: string): boolean {
    return this.sessions.has(this.key(ctxId, agentId));
  }

  /** Получить все сессии. */
  getAllSessions(): MapIterator<AgentSession> {
    return this.sessions.values();
  }

  /** Удалить сессию без закрытия. */
  deleteSession(ctxId: string, agentId: string) {
    this.sessions.delete(this.key(ctxId, agentId));
  }

  private key(ctxId: string, agentId: string): string {
    return `${ctxId}/${agentId}`;
  }
}
