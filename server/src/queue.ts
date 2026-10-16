/** Очередь handoff-задач: сообщения, ожидающие выполнения. */
export interface QueuedTask {
  ctxId: string;
  text: string;
  files?: any[]; // FileAttachment[] — тип из runner.ts
}

/**
 * Управляет очередью задач между контекстами.
 * Один экземпляр на сервер, общий для всех чатов.
 */
export class QueueManager {
  private queue: QueuedTask[] = [];

  constructor() {}

  /** Добавить задачу в конец очереди. */
  push(ctxId: string, text: string, files?: any[]) {
    this.queue.push({ ctxId, text, files });
  }

  /** Есть ли задачи в очереди. */
  hasQueued(): boolean {
    return this.queue.length > 0;
  }

  /** Количество задач для конкретного контекста (для UI: «N в очереди»). */
  countForCtx(ctxId: string): number {
    return this.queue.filter((q) => q.ctxId === ctxId).length;
  }

  /** Найти индекс следующей задачи, чей чат свободен. Возвращает -1 если все заняты. */
  findNextAvailable(activeByCtx: Map<string, string>): number {
    return this.queue.findIndex((q) => !activeByCtx.has(q.ctxId));
  }

  /** Извлечь задачу по индексу и вернуть её (используется вместе с findNextAvailable). */
  pop(index: number): QueuedTask | undefined {
    if (index < 0 || index >= this.queue.length) return undefined;
    const [task] = this.queue.splice(index, 1);
    return task;
  }

  /** Очистить всю очередь. */
  clear() {
    this.queue = [];
  }
}