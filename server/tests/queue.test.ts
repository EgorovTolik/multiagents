import { describe, it, expect } from 'vitest';
import { QueueManager } from '../src/queue';

describe('QueueManager', () => {
  let queue: QueueManager;

  beforeEach(() => {
    queue = new QueueManager();
  });

  it('should add messages to queue when agent is busy', () => {
    queue.push('ctx-1', 'task A');
    queue.push('ctx-2', 'task B');
    queue.push('ctx-1', 'task C');

    expect(queue.hasQueued()).toBe(true);
    expect(queue.countForCtx('ctx-1')).toBe(2);
    expect(queue.countForCtx('ctx-2')).toBe(1);
  });

  it('should find next available message from free context', () => {
    queue.push('ctx-1', 'task A');
    queue.push('ctx-2', 'task B');
    queue.push('ctx-1', 'task C');

    // ctx-1 is busy, ctx-2 is free
    const activeByCtx = new Map<string, string>();
    activeByCtx.set('ctx-1', 'agent-1');

    const idx = queue.findNextAvailable(activeByCtx);
    expect(idx).toBe(1); // task B from ctx-2

    const task = queue.pop(idx);
    expect(task?.text).toBe('task B');
    expect(task?.ctxId).toBe('ctx-2');
  });

  it('should return -1 when all contexts are busy', () => {
    queue.push('ctx-1', 'task A');
    queue.push('ctx-2', 'task B');

    const activeByCtx = new Map<string, string>();
    activeByCtx.set('ctx-1', 'agent-1');
    activeByCtx.set('ctx-2', 'agent-2');

    expect(queue.findNextAvailable(activeByCtx)).toBe(-1);
  });

  it('should dispatch first available message after context frees up', () => {
    queue.push('ctx-1', 'task A');
    queue.push('ctx-1', 'task B');
    queue.push('ctx-2', 'task C');

    // Initially ctx-1 is busy
    let activeByCtx = new Map<string, string>();
    activeByCtx.set('ctx-1', 'agent-1');

    expect(queue.findNextAvailable(activeByCtx)).toBe(2); // task C

    // ctx-1 finishes, becomes free
    activeByCtx = new Map();
    expect(queue.findNextAvailable(activeByCtx)).toBe(0); // task A now first

    queue.pop(0);
    expect(queue.countForCtx('ctx-1')).toBe(1);
  });

  it('should not block other contexts when one is busy', () => {
    queue.push('ctx-1', 'task A');
    queue.push('ctx-2', 'task B');
    queue.push('ctx-3', 'task C');

    // Only ctx-1 is busy — others should be accessible
    const activeByCtx = new Map<string, string>();
    activeByCtx.set('ctx-1', 'agent-1');

    let idx = queue.findNextAvailable(activeByCtx);
    expect(idx).toBe(1); // task B from ctx-2

    queue.pop(idx);

    idx = queue.findNextAvailable(activeByCtx);
    expect(idx).toBe(1); // task C from ctx-3 (now at index 1)
  });

  it('should clear entire queue', () => {
    queue.push('ctx-1', 'task A');
    queue.push('ctx-2', 'task B');

    expect(queue.hasQueued()).toBe(true);

    queue.clear();
    expect(queue.hasQueued()).toBe(false);
    expect(queue.countForCtx('ctx-1')).toBe(0);
  });

  it('should handle empty queue gracefully', () => {
    expect(queue.hasQueued()).toBe(false);
    expect(queue.findNextAvailable(new Map())).toBe(-1);
    expect(queue.pop(0)).toBeUndefined();
  });
});
