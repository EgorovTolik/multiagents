import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ProviderRegistry } from '../src/providers';

// Mock ModelRuntime with stateful model registry
const registeredProviders = new Map<string, Set<string>>();

const mockRegisterProvider = vi.fn((providerId: string, config: any) => {
  const ids = new Set(config.models.map((m: any) => m.id));
  registeredProviders.set(providerId, ids);
});

const mockGetModel = vi.fn((providerId: string, modelId: string) => {
  const ids = registeredProviders.get(providerId);
  if (ids && ids.has(modelId)) {
    return { id: modelId };
  }
  return null;
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: {
    create: async (opts: any) => ({
      registerProvider: mockRegisterProvider,
      getModel: mockGetModel,
      listAvailableModels: opts.listAvailableModels ?? (() => []),
    }),
  },
}));

// Mock fs operations
let mockExistsSync = true;
let mockReadFiles: Map<string, string> = new Map();
const mockWriteCalls: Array<{ path: string; content: string }> = [];

vi.mock('node:fs', () => {
  const existsSync = vi.fn((p: string) => {
    return mockExistsSync && mockReadFiles.has(String(p));
  });
  const readFileSync = vi.fn((p: string) => {
    const content = mockReadFiles.get(String(p));
    if (content === undefined) throw new Error(`File not found: ${p}`);
    return content;
  });
  const writeFileSync = vi.fn((p: string, content: string) => {
    mockWriteCalls.push({ path: String(p), content });
  });
  const mod = { existsSync, readFileSync, writeFileSync };
  return { ...mod, default: mod };
});

describe('ProviderRegistry', () => {
  let emit: ReturnType<typeof vi.fn>;
  let registryList: Array<{ id: string; model?: string | null }>;
  let registryReload: ReturnType<typeof vi.fn>;
  let agentsDir = '/tmp/test-agents';

  beforeEach(() => {
    vi.clearAllMocks();
    registeredProviders.clear();
    emit = vi.fn();
    registryList = [];
    registryReload = vi.fn();
    mockExistsSync = true;
    mockReadFiles = new Map([
      ['/tmp/test-agents/agent-1/config.json', JSON.stringify({ model: 'provider1/model-a' })],
    ]);
    mockWriteCalls.length = 0;
  });

  describe('registerProjectProviders', () => {
    it('should register provider with live models from API', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'model-a' }, { id: 'model-b' }] }),
      }));

      const registry = new ProviderRegistry(
        { provider1: { url: 'http://localhost:8080', apiKey: 'key' } },
        undefined,
        { list: () => registryList, reload: registryReload },
        agentsDir,
      );

      const runtime = await import('@earendil-works/pi-coding-agent').then(
        (m) => m.ModelRuntime.create({ listAvailableModels: () => [] })
      );
      await registry.registerProjectProviders(runtime);

      expect(mockRegisterProvider).toHaveBeenCalledWith('provider1', {
        name: 'provider1',
        baseUrl: 'http://localhost:8080',
        apiKey: 'key',
        api: 'openai-completions',
        models: expect.arrayContaining([
          expect.objectContaining({ id: 'model-a' }),
          expect.objectContaining({ id: 'model-b' }),
        ]),
      });

      vi.unstubAllGlobals();
    });

    it('should fallback to config.json models when server is unavailable', async () => {
      // Mock fetch to fail (server unavailable)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

      registryList = [{ id: 'agent-1', model: 'provider1/model-from-config' }];

      const registry = new ProviderRegistry(
        { provider1: { url: 'http://localhost:8080', apiKey: 'key' } },
        undefined,
        { list: () => registryList, reload: registryReload },
        agentsDir,
      );

      const runtime = await import('@earendil-works/pi-coding-agent').then(
        (m) => m.ModelRuntime.create({ listAvailableModels: () => [] })
      );
      await registry.registerProjectProviders(runtime);

      // Should register with the model referenced in agent config even though server is down
      expect(mockRegisterProvider).toHaveBeenCalledWith('provider1', {
        name: 'provider1',
        baseUrl: 'http://localhost:8080',
        apiKey: 'key',
        api: 'openai-completions',
        models: expect.arrayContaining([
          expect.objectContaining({ id: 'model-from-config' }),
        ]),
      });

      vi.unstubAllGlobals();
    });

    it('should handle provider with no url gracefully', async () => {
      const registry = new ProviderRegistry(
        { provider1: {} },
        undefined,
        { list: () => registryList, reload: registryReload },
        agentsDir,
      );

      const runtime = await import('@earendil-works/pi-coding-agent').then(
        (m) => m.ModelRuntime.create({ listAvailableModels: () => [] })
      );
      await registry.registerProjectProviders(runtime);

      expect(mockRegisterProvider).not.toHaveBeenCalled();
    });
  });

  describe('correctAgentModels', () => {
    it('should reset agent model when provider is unavailable', async () => {
      // Simulate server returning empty list (unavailable)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      registryList = [{ id: 'agent-1', model: 'provider1/bad-model' }];

      const registry = new ProviderRegistry(
        { provider1: { url: 'http://localhost:8080', apiKey: 'key' } },
        undefined,
        { list: () => registryList, reload: registryReload },
        agentsDir,
      );

      // First register to populate knownModelIds (will be empty due to failed fetch)
      const runtime = await import('@earendil-works/pi-coding-agent').then(
        (m) => m.ModelRuntime.create({ listAvailableModels: () => [] })
      );
      await registry.registerProjectProviders(runtime);

      // Now correct — should reset the agent model since provider is unavailable
      const corrected = registry.correctAgentModels();
      expect(corrected).toBe(1);
      const writeCall = mockWriteCalls.find(c => c.path.includes('agent-1'));
      expect(writeCall).toBeDefined();
      expect(JSON.parse(writeCall!.content)).toEqual({ model: null });

      vi.unstubAllGlobals();
    });

    it('should pick the only available model when specified model is missing', async () => {
      // Server returns only one model
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'only-model' }] }),
      }));

      registryList = [{ id: 'agent-1', model: 'provider1/wrong-model' }];

      const registry = new ProviderRegistry(
        { provider1: { url: 'http://localhost:8080', apiKey: 'key' } },
        undefined,
        { list: () => registryList, reload: registryReload },
        agentsDir,
      );

      // First register to populate knownModelIds
      const runtime = await import('@earendil-works/pi-coding-agent').then(
        (m) => m.ModelRuntime.create({ listAvailableModels: () => [] })
      );
      await registry.registerProjectProviders(runtime);

      // Now correct — should pick the only available model
      const corrected = registry.correctAgentModels();
      expect(corrected).toBe(1);
      const writeCall = mockWriteCalls.find(c => c.path.includes('agent-1'));
      expect(writeCall).toBeDefined();
      expect(JSON.parse(writeCall!.content)).toEqual({ model: 'provider1/only-model' });

      vi.unstubAllGlobals();
    });

    it('should not correct agent when specified model is available', async () => {
      // Server returns the model the agent already has
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'good-model' }] }),
      }));

      registryList = [{ id: 'agent-1', model: 'provider1/good-model' }];

      const registry = new ProviderRegistry(
        { provider1: { url: 'http://localhost:8080', apiKey: 'key' } },
        undefined,
        { list: () => registryList, reload: registryReload },
        agentsDir,
      );

      const runtime = await import('@earendil-works/pi-coding-agent').then(
        (m) => m.ModelRuntime.create({ listAvailableModels: () => [] })
      );
      await registry.registerProjectProviders(runtime);

      // Correct — should not change anything since model is available
      const corrected = registry.correctAgentModels();
      expect(corrected).toBe(0);
      expect(mockWriteCalls.length).toBe(0);

      vi.unstubAllGlobals();
    });
  });

  describe('ensureModelRegistered', () => {
    it('should pre-register a new model from agent config change', async () => {
      // Server returns some models but not the new one we want to register
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'existing-model' }] }),
      }));

      const registry = new ProviderRegistry(
        { provider1: { url: 'http://localhost:8080', apiKey: 'key' } },
        undefined,
        { list: () => registryList, reload: registryReload },
        agentsDir,
      );

      // First initial registration with existing model
      const runtime = await import('@earendil-works/pi-coding-agent').then(
        (m) => m.ModelRuntime.create({ listAvailableModels: () => [] })
      );
      await registry.registerProjectProviders(runtime);

      // Now ensure a new model is registered
      mockRegisterProvider.mockClear();
      const ok = await registry.ensureModelRegistered(runtime, 'provider1/new-model');
      expect(ok).toBe(true);
      expect(mockRegisterProvider).toHaveBeenCalledWith('provider1', {
        name: 'provider1',
        baseUrl: 'http://localhost:8080',
        apiKey: 'key',
        api: 'openai-completions',
        models: expect.arrayContaining([
          expect.objectContaining({ id: 'existing-model' }),
          expect.objectContaining({ id: 'new-model' }),
        ]),
      });

      vi.unstubAllGlobals();
    });

    it('should return false when provider is not in config', async () => {
      const registry = new ProviderRegistry(
        {},
        undefined,
        { list: () => registryList, reload: registryReload },
        agentsDir,
      );

      const runtime = await import('@earendil-works/pi-coding-agent').then(
        (m) => m.ModelRuntime.create({ listAvailableModels: () => [] })
      );
      const ok = await registry.ensureModelRegistered(runtime, 'unknown-provider/model');
      expect(ok).toBe(false);
    });
  });

  describe('updateProviders / updateDefaultModel', () => {
    it('should allow updating providers and default model', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      // Agent references provider2 model — will be used as fallback when server is down
      registryList = [{ id: 'agent-1', model: 'provider2/model-x' }];

      const registry = new ProviderRegistry(
        { provider1: { url: 'http://localhost:8080' } },
        undefined,
        { list: () => registryList, reload: registryReload },
        agentsDir,
      );

      // Update providers
      registry.updateProviders({ provider2: { url: 'http://localhost:9090', apiKey: 'key2' } });

      // Re-register should use new config (with fallback model from agent config)
      const runtime = await import('@earendil-works/pi-coding-agent').then(
        (m) => m.ModelRuntime.create({ listAvailableModels: () => [] })
      );
      mockRegisterProvider.mockClear();
      await registry.registerProjectProviders(runtime);

      expect(mockRegisterProvider).toHaveBeenCalledWith('provider2', {
        name: 'provider2',
        baseUrl: 'http://localhost:9090',
        apiKey: 'key2',
        api: 'openai-completions',
        models: expect.arrayContaining([
          expect.objectContaining({ id: 'model-x' }),
        ]),
      });

      vi.unstubAllGlobals();
    });
  });
});
