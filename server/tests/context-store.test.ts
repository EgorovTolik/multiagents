import { describe, it, expect, beforeEach } from 'vitest';
import { ContextStore, Message } from '../src/context-store';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('ContextStore', () => {
  let storeRoot: string;
  let store: ContextStore;

  beforeEach(() => {
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-test-'));
    store = new ContextStore(storeRoot, 'default-agent');
  });

  it('should create a work context with proper structure', () => {
    const meta = store.create('Test Task', 'work');
    expect(meta.id).toBeDefined();
    expect(meta.name).toBe('Test Task');
    expect(meta.activeAgentId).toBe('default-agent');
    expect(meta.handoffs).toEqual([]);

    const dir = store.dir(meta.id);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'context.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'tasks'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'results'))).toBe(true);
  });

  it('should create a training context', () => {
    const meta = store.create('Training Session', 'training');
    expect(meta.id).toBeDefined();
    expect(store.isTrainingContext(meta.id)).toBe(true);

    const dir = store.trainingDir(meta.id);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('should save and retrieve context metadata', () => {
    const meta = store.create('Task to Retrieve');
    const retrieved = store.get(meta.id);

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(meta.id);
    expect(retrieved!.name).toBe('Task to Retrieve');
  });

  it('should list contexts', () => {
    store.create('First Task');
    store.create('Second Task');
    const contexts = store.list();
    expect(contexts.length).toBe(2);
  });

  it('should append and read messages (JSONL)', () => {
    const meta = store.create('Chat Task');

    const msg1: Message = { role: 'user', text: 'Hello', ts: Date.now() };
    const msg2: Message = { role: 'assistant', agentId: 'default-agent', text: 'Hi!', ts: Date.now() + 1 };
    const msg3: Message = { role: 'system', text: 'System note', thinking: 'Internal thought', ts: Date.now() + 2 };

    store.appendMessage(meta.id, msg1);
    store.appendMessage(meta.id, msg2);
    store.appendMessage(meta.id, msg3);

    const messages = store.readMessages(meta.id);
    expect(messages.length).toBe(3);
    expect(messages[0].role).toBe('user');
    expect(messages[0].text).toBe('Hello');
    expect(messages[1].agentId).toBe('default-agent');
    expect(messages[2].thinking).toBe('Internal thought');
  });

  it('should update context fields', () => {
    const meta = store.create('Updatable Task');
    const updated = store.get(meta.id)!;

    updated.name = 'Updated Name';
    updated.activeAgentId = 'other-agent';
    store.save(updated);

    const reloaded = store.get(meta.id);
    expect(reloaded!.name).toBe('Updated Name');
    expect(reloaded!.activeAgentId).toBe('other-agent');
  });

  it('should apply skills to context', () => {
    const meta = store.create('Skill Task');
    const updated = store.applySkills(meta.id, ['skill-a', 'skill-b']);

    expect(updated.skills).toEqual(['skill-a', 'skill-b']);

    const reloaded = store.get(meta.id);
    expect(reloaded!.skills).toContain('skill-a');
    expect(reloaded!.skills).toContain('skill-b');
  });

  it('should delete a context', () => {
    const meta = store.create('Delete Me');
    store.delete(meta.id);
    const retrieved = store.get(meta.id);
    expect(retrieved).toBeUndefined();
  });
});
