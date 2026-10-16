/**
 * Глобальный мьютекс агентов: в любой момент времени один агент выполняет ход только в одном чате.
 * Другие сообщения от этого агента — в очередь с ожиданием (FIFO).
 */
export type AgentEmit = (msg: unknown) => void;

interface Waiter {
  ctxId: string;
  resolve: () => void;
}

export class MutexManager {
  /** Чат → агент: агент выполняет ход (жёсткий лимит 1 на агента по всем чатам). */
  private acquiredAgents = new Map<string, string>();
  /** Очередь ждущих на каждого агента. */
  private agentWaiters = new Map<string, Waiter[]>();

  constructor(private emit: AgentEmit) {}

  /** Забрать очередь на агента. Если агент занят в другом чате — ждём (FIFO на агента). */
  acquireAgent(agentId: string, ctxId: string): Promise<void> {
    if (!this.acquiredAgents.has(agentId)) {
      this.acquiredAgents.set(agentId, ctxId);
      return Promise.resolve();
    }
    const waiters = this.agentWaiters.get(agentId) ?? [];
    this.agentWaiters.set(agentId, waiters);
    return new Promise<void>((resolve) => {
      // Цепочка стоит: агент занят в другом чате — показываем ожидание в UI
      this.emit({ type: "chain_waiting", ctxId, agentId });
      waiters.push({ ctxId, resolve });
    });
  }

  /** Освободить агента: передать владение следующему ждущему или снять полностью. */
  releaseAgent(agentId: string): void {
    const waiters = this.agentWaiters.get(agentId) ?? [];
    if (waiters.length > 0) {
      const next = waiters.shift()!;
      this.acquiredAgents.set(agentId, next.ctxId);
      next.resolve();
    } else {
      this.acquiredAgents.delete(agentId);
    }
  }

  /** Какие агенты сейчас заняты (для диагностики). */
  getAcquiredAgents(): Map<string, string> {
    return new Map(this.acquiredAgents);
  }
}