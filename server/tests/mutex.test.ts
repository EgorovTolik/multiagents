import { describe, it, expect, vi } from 'vitest';
import { MutexManager } from '../src/mutex';

describe('MutexManager', () => {
  let emit: ReturnType<typeof vi.fn>;
  let mutex: MutexManager;

  beforeEach(() => {
    emit = vi.fn();
    mutex = new MutexManager(emit);
  });

  it('should acquire agent when free', async () => {
    await mutex.acquireAgent('agent-1', 'ctx-1');
    const acquired = mutex.getAcquiredAgents();
    expect(acquired.has('agent-1')).toBe(true);
    expect(acquired.get('agent-1')).toBe('ctx-1');
  });

  it('should block agent when busy in another context', async () => {
    await mutex.acquireAgent('agent-1', 'ctx-1');

    let resolved = false;
    const p = mutex.acquireAgent('agent-1', 'ctx-2').then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    expect(emit).toHaveBeenCalledWith({
      type: 'chain_waiting',
      ctxId: 'ctx-2',
      agentId: 'agent-1'
    });

    await mutex.releaseAgent('agent-1');
    await p;
    expect(resolved).toBe(true);
  });

  it('should maintain FIFO queue for multiple waiters', async () => {
    await mutex.acquireAgent('agent-1', 'ctx-1');

    const order: string[] = [];
    const p1 = mutex.acquireAgent('agent-1', 'ctx-2').then(() => {
      order.push('ctx-2');
    });
    const p2 = mutex.acquireAgent('agent-1', 'ctx-3').then(() => {
      order.push('ctx-3');
    });

    expect(emit).toHaveBeenCalledTimes(2);

    await mutex.releaseAgent('agent-1');
    await p1;
    expect(order).toEqual(['ctx-2']);
    expect(mutex.getAcquiredAgents().get('agent-1')).toBe('ctx-2');

    await mutex.releaseAgent('agent-1');
    await p2;
    expect(order).toEqual(['ctx-2', 'ctx-3']);
  });

  it('should release agent when no waiters', async () => {
    await mutex.acquireAgent('agent-1', 'ctx-1');
    expect(mutex.getAcquiredAgents().has('agent-1')).toBe(true);

    mutex.releaseAgent('agent-1');
    expect(mutex.getAcquiredAgents().has('agent-1')).toBe(false);
  });

  it('should handle parallel acquires for different agents', async () => {
    const p1 = mutex.acquireAgent('agent-1', 'ctx-1');
    const p2 = mutex.acquireAgent('agent-2', 'ctx-2');

    await Promise.all([p1, p2]);

    const acquired = mutex.getAcquiredAgents();
    expect(acquired.has('agent-1')).toBe(true);
    expect(acquired.has('agent-2')).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it('should chain release to next waiter automatically', async () => {
    await mutex.acquireAgent('agent-1', 'ctx-1');

    let ctx2Resolved = false;
    const p2 = mutex.acquireAgent('agent-1', 'ctx-2').then(() => {
      ctx2Resolved = true;
    });

    let ctx3Resolved = false;
    const p3 = mutex.acquireAgent('agent-1', 'ctx-3').then(() => {
      ctx3Resolved = true;
    });

    expect(ctx2Resolved).toBe(false);
    expect(ctx3Resolved).toBe(false);

    mutex.releaseAgent('agent-1');
    await p2;
    expect(ctx2Resolved).toBe(true);
    expect(ctx3Resolved).toBe(false);
    expect(mutex.getAcquiredAgents().get('agent-1')).toBe('ctx-2');

    mutex.releaseAgent('agent-1');
    await p3;
    expect(ctx3Resolved).toBe(true);
  });
});
