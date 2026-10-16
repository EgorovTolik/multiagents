// ─── Project Config Type ────────────────────────────────────────────────────

/** Формат config.json проекта multiagents. */
export interface ProjectConfig {
  model?: string;
  port?: number;
  providers?: Record<string, { url?: string; apiKey?: string }>;
  maxHandoffs?: number;
  maxRecoveries?: number;
  stallTimeoutMs?: number;
  maxUploadSizeMb?: number;
  recoveryMode?: "orchestrator_check" | "router_agent";
}

// ─── Request Body Types ─────────────────────────────────────────────────────

/** POST /api/training/sessions/:agentId — создание обучающей сессии (нет body) */
export type CreateTrainingSessionBody = void;

/** PUT /api/training/sessions/:sessionId/rename — переименование сессии */
export interface RenameContextBody {
  name: string;
}

/** POST/PUT /api/skills — создание или обновление навыка */
export interface SkillBody {
  name: string;
  description?: string;
  autoApply?: boolean;
  body: string;
  files?: { filename: string; content: string }[];
}

/** PUT /api/agents/:id — обновление агента */
export interface UpdateAgentBody {
  name?: string;
  description?: string;
  disabledTools?: string[];
  model?: string;
  thinkingLevel?: string;
  forgetSessionAfterStep?: boolean;
  systemPrompt?: string;
  rules?: { filename: string; content: string }[];
  skills?: { filename: string; content: string }[];
}

/** PUT /api/config — обновление конфигурации */
export interface UpdateConfigBody {
  model?: string;
  port?: number;
  providers?: Record<string, { url?: string; apiKey?: string }>;
  maxHandoffs?: number;
  maxRecoveries?: number;
  stallTimeoutMs?: number;
  maxUploadSizeMb?: number;
  recoveryMode?: "orchestrator_check" | "router_agent";
}

// ─── Query Params ──────────────────────────────────────────────────────────

/** GET /api/files — скачать файл из контекста */
export interface FilesQuery {
  ctx?: string;
  path?: string;
}

/** GET /api/archive — скачать архив контекста */
export interface ArchiveQuery {
  ctx?: string;
  file?: string;
}

// ─── Response Types ────────────────────────────────────────────────────────

/** Список агентов (GET /api/agents) */
export interface AgentListItem {
  id: string;
  name: string;
  description: string;
}

/** Детали агента (GET /api/agents/:id/detail) */
export interface AgentDetailResponse {
  id: string;
  name: string;
  description: string;
  disabledTools: string[];
  model: string | null;
  thinkingLevel: string | null;
  forgetSessionAfterStep: boolean;
  systemPrompt: string;
  rules: { filename: string; content: string }[];
  skills: { filename: string; content: string }[];
}

/** Список навыков (GET /api/skills) */
export interface SkillListItem {
  id: string;
  name: string;
  description: string;
  autoApply: boolean;
}

/** Детали навыка (GET /api/skills/:id/detail) */
export interface SkillDetailResponse {
  id: string;
  name: string;
  description: string;
  autoApply: boolean;
  body: string;
  files?: unknown[];
}

/** Информация о контексте (GET /api/contexts/:id) */
export interface ContextInfoResponse {
  id: string;
  name: string;
  createdAt: number;
}

/** Список сообщений контекста (GET /api/contexts/:id/messages) */
export interface ContextMessagesResponse {
  messages: {
    role: string;
    agentId?: string;
    text: string;
    thinking?: string;
    ts: number;
    streaming?: boolean;
  }[];
}

/** Сессия работы над ошибками (GET /api/work-on-mistakes/sessions/:analyzedCtxId) */
export interface MistakesSessionResponse {
  id: string;
  name: string;
  analyzedCtxId: string;
  activeAgentId: string;
  found: boolean;
}

/** Размеры контекстов (GET /api/context-sizes) */
export type ContextSizesResponse = Record<string, number>;

/** Список моделей провайдера (GET /api/providers/:id/models) */
export interface ModelsResponse {
  models: string[];
  cached: boolean;
  stale?: boolean;
  fetchedAt: number;
  error?: string;
}

/** Группы инструментов pi (GET /api/tools) */
export interface ToolsGroupsResponse {
  groups: Array<{
    name: string;
    tools: Array<{ name: string }>;
  }>;
  fetchedAt?: number | null;
}

/** Статус активных сессий (GET /api/sessions) */
export interface SessionsStatusResponse {
  busy: boolean;
  active: Array<{
    ctxId: string;
    agentId: string;
  }>;
}

/** Ответ сброса сессий (POST /api/sessions/reset) */
export interface ResetSessionsResponse {
  ok: boolean;
  sessions: number;
}

/** Успех операции (общий ответ) */
export interface SuccessResponse {
  ok: boolean;
}

/** Сообщение об ошибке (общий ответ) */
export interface ErrorResponse {
  error: string;
}

/** Создание/обновление обучающей сессии */
export interface TrainingSessionCreatedResponse {
  id: string;
  name: string;
}

/** Детали конкретной обучающей сессии */
export interface TrainingSessionDetailResponse {
  id: string;
  name: string;
  createdAt: number;
  agentId: string;
  completed: boolean;
}
