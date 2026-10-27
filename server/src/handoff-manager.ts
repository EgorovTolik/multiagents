import type { ContextStore, ContextMeta, Handoff, Message } from "./context-store";
import type { AgentRegistry } from "./registry";
import type { PromptBuilder } from "./prompt-builder";
import type { AgentSessionManager } from "./session-manager.js";
import type { Emit } from "./runner";

export class HandoffManager {
  constructor(
    private registry: AgentRegistry,
    private store: ContextStore,
    private sessionManager: AgentSessionManager,
    private promptBuilder: PromptBuilder,
    private emit: Emit,
  ) {}

  /** Отмена ожидающего handoff. */
  cancelHandoff(ctxId: string) {
    const ctx = this.store.get(ctxId);
    if (!ctx?.pendingHandoff) return;
    ctx.pendingHandoff = undefined;
    this.store.save(ctx);
    this.emit({ type: "handoff_cancelled", ctxId });
  }

  /** Выполнение передачи задачи агенту. */
  doHandoff(
    ctxId: string,
    ctx: ContextMeta,
    handoff: Handoff,
    prompt: string,
    runFn: (ctxId: string, text: string) => void,
  ) {
    ctx.activeAgentId = handoff.to;
    ctx.handoffs.push(handoff);
    ctx.inChain = true;
    this.store.save(ctx);

    const sysMsg: Message = { role: "system", text: `Передача: ${handoff.from} → ${handoff.to} — ${handoff.reason}`, ts: Date.now() };
    this.store.appendMessage(ctxId, sysMsg);
    this.emit({ type: "handoff", ctxId, handoff });
    this.emit({ type: "message", ctxId, message: sysMsg });

    // Забываем сессию предыдущего агента если он это требует
    if (handoff.to !== handoff.from) {
      const fromDef = this.registry.get(handoff.from);
      if (fromDef?.forgetSessionAfterStep) {
        const s = this.sessionManager.getSessionByCtxAndAgent(ctxId, handoff.from);
        if (s) {
          try { s.dispose(); } catch { /* ignore */ }
          this.sessionManager.deleteSession(ctxId, handoff.from);
        }
        if (ctx.deliveredSkills && ctx.deliveredSkills[handoff.from]?.length) {
          delete ctx.deliveredSkills[handoff.from];
          this.store.save(ctx);
        }
      }
    }

    runFn(ctxId, prompt);
  }
}