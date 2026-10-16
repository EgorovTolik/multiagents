import fs from "node:fs";
import path from "node:path";
import { parseModelList } from "./utils";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

type ModelRuntimeInstance = Awaited<ReturnType<typeof ModelRuntime.create>>;

export interface ProviderConfig {
  url?: string;
  apiKey?: string;
}

interface AgentWithModel {
  id: string;
  model?: string | null;
}

export class ProviderRegistry {
  private knownModelIds = new Map<string, Set<string>>();

  constructor(
    private providers: Record<string, ProviderConfig>,
    private defaultModel: string | undefined,
    private registry: { list(): AgentWithModel[]; reload(): void },
    private agentsDir: string,
  ) {}

  /** Обновить список провайдеров и перерегистрировать их. */
  updateProviders(providers: Record<string, ProviderConfig>) {
    this.providers = providers;
  }

  /** Обновить модель по умолчанию. */
  updateDefaultModel(model: string | undefined) {
    this.defaultModel = model;
  }

  /** Запросить список моделей провайдера (OpenAI- и llama.cpp-native форматы). */
  private async fetchProviderModels(baseUrl: string, apiKey?: string): Promise<string[]> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey ?? ""}` },
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!resp.ok) return [];
      const data: any = await resp.json();
      return parseModelList(data);
    } catch {
      return [];
    }
  }

  /** Сбросить модель агента, записав null в config.json и перезагрузив реестр. */
  private resetAgentModel(agentId: string) {
    try {
      const agentDir = path.join(this.agentsDir, agentId);
      const configPath = path.join(agentDir, "config.json");
      if (!fs.existsSync(configPath)) return;

      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      config.model = null;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
      this.registry.reload();
    } catch (e) {
      console.log(`[providers] ошибка сброса модели агента ${agentId}:`, e);
    }
  }

  /** Register провайдеры config.json в ModelRuntime со списком моделей с сервера. */
  async registerProjectProviders(runtime: ModelRuntimeInstance | null) {
    if (!runtime) return;
    for (const [id, cfg] of Object.entries(this.providers)) {
      if (!cfg?.url) continue;
      const baseUrl = cfg.url.replace(/\/$/, "");
      // Живой список с сервера + fallback: модели, упомянутые в config.json
      // (глобальная default и per-agent), чтобы резолв работал даже при недоступном сервере.
      const live = await this.fetchProviderModels(baseUrl, cfg.apiKey);
      const referenced = [this.defaultModel, ...this.registry.list().map((a) => a.model)]
        .filter((s): s is string => !!s && s.startsWith(id + "/"))
        .map((s) => s.slice(id.length + 1));
      const allIds = [...new Set([...live, ...referenced])];
      if (allIds.length === 0) continue;
      this.registerProviderModels(runtime, id, allIds);
      // В knownModelIds сохраняем только live модели — для коррекции моделей агентов
      this.knownModelIds.set(id, new Set(live));
      console.log(`[providers] провайдер ${id} зарегистрирован в pi SDK: ${allIds.length} моделей${live.length === 0 ? " (сервер недоступен — из config.json)" : ""}`);
    }
  }

  /** Регистрирует провайдера в ModelRuntime с указанным списком моделей. */
  private registerProviderModels(runtime: ModelRuntimeInstance | null, providerId: string, ids: string[]): void {
    const cfg = this.providers[providerId];
    if (!runtime || !cfg?.url) return;
    const baseUrl = cfg.url.replace(/\/$/, "");
    runtime.registerProvider(providerId, {
      name: providerId,
      baseUrl,
      apiKey: cfg.apiKey,
      api: "openai-completions",
      models: ids.map((mid) => ({
        id: mid,
        name: mid.replace(/\.gguf$/, ""),
        reasoning: false,
        input: ["text", "image"] as ("text" | "image")[],
        contextWindow: 262144,
        maxTokens: 32768,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })),
    });
  }

  /** Гарантирует, что модель из конфига агента есть в ModelRuntime. */
  async ensureModelRegistered(runtime: ModelRuntimeInstance | null, spec: string): Promise<boolean> {
    if (!runtime) return false;
    const slash = spec.indexOf("/");
    if (slash < 0) return false;
    const providerId = spec.slice(0, slash);
    const modelId = spec.slice(slash + 1);
    if (runtime.getModel(providerId, modelId)) return true;
    const pcfg = this.providers[providerId];
    if (!pcfg?.url) {
      console.warn(`[providers] провайдер «${providerId}» не найден в config.json — модель ${spec} недоступна`);
      return false;
    }
    const live = await this.fetchProviderModels(pcfg.url.replace(/\/$/, ""), pcfg.apiKey);
    const known = this.knownModelIds.get(providerId) ?? new Set<string>();
    const ids = [...new Set([...known, ...live, modelId])];
    this.registerProviderModels(runtime, providerId, ids);
    console.log(`[providers] провайдер ${providerId} обновлён: ${ids.length} моделей (добавлена «${modelId}»)`);
    return !!runtime.getModel(providerId, modelId);
  }

  /** Коррекция моделей агентов: если указанная модель недоступна — сбросить или выбрать единственную. */
  correctAgentModels(): number {
    let corrected = 0;
    for (const agent of this.registry.list()) {
      if (!agent.model) continue; // глобальная — ок
      const slash = agent.model.indexOf("/");
      if (slash < 0) continue; // формат не provider/model — пропустить
      const providerId = agent.model.slice(0, slash);
      const modelId = agent.model.slice(slash + 1);

      const available = this.knownModelIds.get(providerId);
      if (!available || available.size === 0) {
        // Провайдер не зарегистрирован или список пуст — сбросить
        console.log(`[providers] агент ${agent.id}: провайдер ${providerId} недоступен, модель сброшена`);
        this.resetAgentModel(agent.id);
        corrected++;
        continue;
      }

      if (available.has(modelId)) {
        continue; // модель доступна — ок
      }

      // Модель указана, но недоступна у провайдера
      const cfgPath = path.join(this.agentsDir, agent.id, "config.json");
      let cfg: { model?: string | null } = {};
      try {
        cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      } catch { /* ignore */ }

      if (available.size === 1) {
        const onlyModel = [...available][0];
        console.log(`[providers] агент ${agent.id}: модель «${modelId}» недоступна, выбрана единственная доступная «${onlyModel}»`);
        cfg.model = `${providerId}/${onlyModel}`;
      } else {
        console.log(`[providers] агент ${agent.id}: модель «${modelId}» недоступна (сервер вернул ${available.size} моделей), сброшено в null`);
        cfg.model = null;
      }
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      this.registry.reload();
      corrected++;
    }
    return corrected;
  }
}
