import { ORCHESTRATOR_ID, CHAIN_ROUTER_ID } from "./recovery.js";
import type { ContextStore, ContextMeta, Handoff, Message } from "./context-store";
import type { AgentRegistry } from "./registry";
import type { RecoveryEngine } from "./recovery.js";
import type { AgentSessionManager } from "./session-manager.js";
import type { Emit } from "./runner";

export class RecoveryManager {
  private lastEventByCtx = new Map<string, number>();

  constructor(
    private registry: AgentRegistry,
    private store: ContextStore,
    private sessionManager: AgentSessionManager,
    private recoveryEngine: RecoveryEngine,
    private activeByCtx: Map<string, string>,
    private stallTimeoutMs: number,
    private maxRecoveries: number,
    private recoveryMode: "router_agent" | "orchestrator_check",
    private emit: Emit,
  ) {}

  /** Установка тайм-аута watchdog. */
  setStallTimeout(ms: number) {
    this.stallTimeoutMs = ms;
  }

  /** Обновление максимума попыток восстановления. */
  setMaxRecoveries(max: number) {
    this.maxRecoveries = max;
  }

  /** Регистрация события активности сессии. */
  recordActivity(ctxId: string) {
    this.lastEventByCtx.set(ctxId, Date.now());
  }

  /** Проверка зависших сессий и отправка watchdog-событий. */
  checkStalledSessions() {
    for (const [ctxId, agentId] of this.activeByCtx) {
      const last = this.lastEventByCtx.get(ctxId);
      if (last === undefined || Date.now() - last < this.stallTimeoutMs) continue;
      console.error(`[ctxId:${ctxId}] [runner] сессия ${agentId} зависла (нет событий ${this.stallTimeoutMs / 1000}с), прерываю`);
      const err = { type: "agent_stalled", message: `Агент ${agentId} завис (${this.stallTimeoutMs / 1000}с без активности)` };
      this.emit({ type: "error", ctxId, message: err.message, error: err });
      this.lastEventByCtx.set(ctxId, Date.now());
      const session = this.sessionManager.getSessionByCtxAndAgent(ctxId, agentId);
      void session?.abort();
    }
  }

  /** Обработка обрыва цепочки после завершения хода агента. */
  async handleChainBreak(
    ctxId: string,
    ctx: ContextMeta,
    agentId: string,
    task: Handoff | undefined,
    doHandoff: (ctxId: string, ctx: ContextMeta, handoff: Handoff, prompt: string) => void,
  ): Promise<boolean> {
    if (!ctx.inChain || agentId === ORCHESTRATOR_ID || ctx.awaitingUser || ctx.aborted) return false;

    const recoveries = ctx.recoveryCount ?? 0;
    if (recoveries >= this.maxRecoveries) {
      const sysMsg: Message = { role: "system", text: `⚠️ Цепочка прервалась. Автоматическое восстановление остановлено (${recoveries}/${this.maxRecoveries}). Отправьте сообщение для продолжения.`, ts: Date.now() };
      this.store.appendMessage(ctxId, sysMsg);
      this.emit({ type: "message", ctxId, message: sysMsg });
      this.emit({ type: "recovery_completed", ctxId, success: false, count: recoveries, reason: `Лимит попыток восстановления (${this.maxRecoveries})` });
      return true;
    }

    const lastMsg = this.lastAssistantMessage(ctxId, agentId);

    // Notify: recovery started
    this.emit({ type: "recovery_started", ctxId, brokenAgent: agentId, attempt: recoveries + 1, maxAttempts: this.maxRecoveries });

    if (agentId === CHAIN_ROUTER_ID) {
      const decision = "router_fallback";
      console.log(`[runner] ${ctxId}/${agentId}: маршрутизатор не принял решение — автопередача оркестратору`);
      this.emit({ type: "recovery_decision", ctxId, decision, targetAgent: ORCHESTRATOR_ID, reason: "Маршрутизатор не принял решение" });
      const handoff: Handoff = { from: agentId, to: ORCHESTRATOR_ID, reason: "⚠️ Маршрутизатор не принял решение — автопередача", context: lastMsg ?? "(маршрутизатор не оставил завершённого сообщения)", ts: Date.now() };
      ctx.recoveryCount = recoveries + 1;
      doHandoff(ctxId, ctx, handoff, this.recoveryEngine.buildRouterFallbackPrompt(task, lastMsg));
      this.emit({ type: "recovery_completed", ctxId, success: true, count: ctx.recoveryCount });
      return true;
    }

    const incomplete = this.recoveryEngine.detectIncompleteTask(ctxId, agentId, task, ctxId);
    if (incomplete) {
      console.log(`[runner] ${ctxId}/${agentId}: незавершённая задача обнаружена, автоматически возвращаю агенту`);
      this.emit({ type: "recovery_decision", ctxId, decision: "auto_recover_incomplete", targetAgent: agentId, reason: "Задача не завершена (нет result-файла)" });
      const handoff: Handoff = { from: "system", to: agentId, reason: "⚠️ Автоматическое восстановление: задача не завершена (нет result-файла)", context: incomplete.context, ts: Date.now() };
      ctx.recoveryCount = recoveries + 1;
      doHandoff(ctxId, ctx, handoff, this.recoveryEngine.buildAutoRecoveryPrompt(agentId, task, lastMsg, incomplete));
      this.emit({ type: "recovery_completed", ctxId, success: true, count: ctx.recoveryCount });
      return true;
    }

    if (this.recoveryMode === "router_agent" && this.registry.get(CHAIN_ROUTER_ID)) {
      console.log(`[runner] ${ctxId}/${agentId}: цепочка прервалась — передача маршрутизатору`);
      this.emit({ type: "recovery_decision", ctxId, decision: "route_to_router", targetAgent: CHAIN_ROUTER_ID, reason: "Цепочка прервалась — разбор маршрута" });
      const handoff: Handoff = { from: agentId, to: CHAIN_ROUTER_ID, reason: "⚠️ Цепочка прервалась — разбор маршрута", context: lastMsg ?? "(агент не оставил завершённого сообщения)", ts: Date.now() };
      ctx.recoveryCount = recoveries + 1;
      doHandoff(ctxId, ctx, handoff, this.recoveryEngine.buildRouterPrompt(ctx, agentId, task, lastMsg, () => ""));
      this.emit({ type: "recovery_completed", ctxId, success: true, count: ctx.recoveryCount });
      return true;
    }

    console.log(`[runner] ${ctxId}/${agentId}: цепочка прервалась — автопроверка оркестратором`);
    this.emit({ type: "recovery_decision", ctxId, decision: "orchestrator_check", targetAgent: ORCHESTRATOR_ID, reason: "Цепочка прервалась — автопроверка" });
    const handoff: Handoff = { from: agentId, to: ORCHESTRATOR_ID, reason: "⚠️ Цепочка прервалась — автопроверка", context: lastMsg ?? "(агент не оставил завершённого сообщения)", ts: Date.now() };
    ctx.recoveryCount = recoveries + 1;
    doHandoff(ctxId, ctx, handoff, this.recoveryEngine.buildRecoveryPrompt(agentId, task, lastMsg));
    this.emit({ type: "recovery_completed", ctxId, success: true, count: ctx.recoveryCount });
    return true;
  }

  /** Поиск последнего завершённого сообщения агента. */
  private lastAssistantMessage(ctxId: string, agentId: string): string | undefined {
    const msgs = this.store.readMessages(ctxId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "assistant" && m.agentId === agentId && m.text.trim()) return m.text;
    }
    return undefined;
  }
}