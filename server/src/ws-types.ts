/** Типизация WebSocket-сообщений между клиентом и сервером multiagents. */

// === Сообщения от клиента к серверу ===

export interface WsMsgListContexts {
  type: "list_contexts";
}

export interface WsMsgCreateContext {
  type: "create_context";
  name?: string;
}

export interface WsMsgDeleteContext {
  type: "delete_context";
  ctxId: string;
}

export interface WsMsgLoadContext {
  type: "load_context";
  ctxId: string;
}

export interface WsMsgRenameContext {
  type: "rename_context";
  ctxId: string;
  name?: string;
}

export interface WsMsgTruncateHistory {
  type: "truncate_history";
  ctxId: string;
  fromIndex?: number;
}

export interface WsFileMeta {
  filename: string;
  content: string;
}

export interface WsMsgMessage {
  type: "message";
  ctxId: string;
  text: string;
  files?: WsFileMeta[];
}

export interface WsMsgPrepareArchive {
  type: "prepare_archive";
  ctxId: string;
}

export interface WsMsgAbort {
  type: "abort";
  ctxId?: string;
}

export interface WsMsgCancelHandoff {
  type: "cancel_handoff";
  ctxId: string;
}

export interface WsMsgApplySkills {
  type: "apply_skills";
  ctxId?: string;
  skills: string[];
}

/** Любое сообщение от клиента. */
export type ClientToServerMessage =
  | WsMsgListContexts
  | WsMsgCreateContext
  | WsMsgDeleteContext
  | WsMsgLoadContext
  | WsMsgRenameContext
  | WsMsgTruncateHistory
  | WsMsgMessage
  | WsMsgPrepareArchive
  | WsMsgAbort
  | WsMsgCancelHandoff
  | WsMsgApplySkills;

// === Сообщения от сервера к клиенту ===

export interface AgentDef {
  id: string;
  name: string;
  description?: string;
}

export interface WsMsgAgents {
  type: "agents";
  agents: AgentDef[];
}

export interface SkillDef {
  id: string;
  name: string;
  description?: string;
  autoApply?: boolean;
}

export interface WsMsgSkills {
  type: "skills";
  skills: SkillDef[];
}

export interface ContextInfo {
  id: string;
  name: string;
  createdAt: number;
}

export interface WsMsgContexts {
  type: "contexts";
  contexts: ContextInfo[];
}

export interface ActiveSession {
  ctxId: string;
  agentId: string;
}

export interface WsMsgRunState {
  type: "run_state";
  actives: ActiveSession[];
}

export interface WsMsgMessageReceived {
  type: "message_received";
  ctxId: string;
}

export interface WsMsgContextCreated {
  type: "context_created";
  context: ContextInfo;
}

export interface WsMsgContextDeleted {
  type: "context_deleted";
  ctxId: string;
}

export interface ChatMessage {
  role: string;
  agentId?: string;
  text: string;
  thinking?: string;
  ts?: number;
  streaming?: boolean;
}

export interface WsMsgContextLoaded {
  type: "context_loaded";
  context?: ContextInfo;
  messages: ChatMessage[];
}

export interface WsMsgContextRenamed {
  type: "context_renamed";
  ctxId: string;
  name: string;
}

export interface WsMsgHistoryTruncated {
  type: "history_truncated";
  ctxId: string;
}

export type ArchiveState = "queued" | "preparing" | "ready" | "error";

export interface WsMsgArchiveStatus {
  type: "archive_status";
  ctxId: string;
  state: ArchiveState;
  url?: string;
  error?: string;
}

export interface WsMsgTrainingSessionReopened {
  type: "training_session_reopened";
  sessionId: string;
}

export interface WsMsgError {
  type: "error";
  message: string;
  ctxId?: string;
  error?: object;
}

export interface WsMsgHandoffCancelled {
  type: "handoff_cancelled";
  ctxId: string;
}

import type { Message } from "./context-store";

export interface WsMsgSystemMessage {
  type: "message";
  ctxId: string;
  message: string | Message;
}

export interface WsMsgQueued {
  type: "queued";
  ctxId: string;
  count: number;
}

export interface WsMsgRunStart {
  type: "run_start";
  ctxId: string;
  agentId: string;
}

export interface WsMsgRunEnd {
  type: "run_end";
  ctxId: string;
  agentId: string;
}

export interface WsMsgDelta {
  type: "delta";
  ctxId: string;
  agentId: string;
  text: string;
}

export interface WsMsgThinkingDelta {
  type: "thinking_delta";
  ctxId: string;
  agentId: string;
  text: string;
}

export interface WsMsgAssistantEnd {
  type: "assistant_end";
  ctxId: string;
  agentId: string;
  text: string;
  thinking?: string;
}

export interface WsMsgHandoff {
  type: "handoff";
  ctxId: string;
  handoff: object;
}

// === Handoff / Agent interaction messages ===

export interface WsMsgHandoffPending {
  type: "handoff_pending";
  ctxId: string;
  handoff: object;
}

export interface WsMsgChainWaiting {
  type: "chain_waiting";
  ctxId: string;
  agentId: string;
}

export interface WsMsgAskUser {
  type: "ask_user";
  ctxId: string;
  agentId: string;
  question: string;
}

export interface WsMsgAgentNotification {
  type: "agent_notification";
  ctxId: string;
  message: string;
  sticky?: boolean;
}

// === Plan messages ===

export interface WsMsgPlanCreated {
  type: "plan_created";
  ctxId: string;
  planId: string;
}

export interface WsMsgPlanUpdated {
  type: "plan_updated";
  ctxId: string;
  planId: string;
}

export interface WsMsgPlanDeleted {
  type: "plan_deleted";
  ctxId: string;
}

export interface WsMsgSystemNotice {
  type: "system_notice";
  text: string;
}

// === Recovery messages ===

export interface WsMsgRecoveryStarted {
  type: "recovery_started";
  ctxId: string;
  brokenAgent: string;
  attempt: number;
  maxAttempts: number;
}

export interface WsMsgRecoveryCompleted {
  type: "recovery_completed";
  ctxId: string;
  success: boolean;
  count: number;
  reason?: string;
}

export interface WsMsgRecoveryDecision {
  type: "recovery_decision";
  ctxId: string;
  decision: string;
  targetAgent: string;
  reason: string;
}

// === Other messages ===

export interface WsMsgSkillsApplied {
  type: "skills_applied";
  ctxId: string;
  skills: string[];
}

export interface WsMsgApiKey {
  type: "api_key";
  key: string;
  label?: string;
}

export interface WsMsgImage {
  type: "image";
  ctxId: string;
  filename: string;
  url: string;
}

export interface WsMsgText {
  type: "text";
  text: string;
}

/** Любое сообщение от сервера. */
export type ServerToClientMessage =
  | WsMsgAgents
  | WsMsgSkills
  | WsMsgContexts
  | WsMsgRunState
  | WsMsgMessageReceived
  | WsMsgContextCreated
  | WsMsgContextDeleted
  | WsMsgContextLoaded
  | WsMsgContextRenamed
  | WsMsgHistoryTruncated
  | WsMsgArchiveStatus
  | WsMsgTrainingSessionReopened
  | WsMsgError
  | WsMsgHandoffCancelled
  | WsMsgSystemMessage
  | WsMsgQueued
  | WsMsgRunStart
  | WsMsgRunEnd
  | WsMsgDelta
  | WsMsgThinkingDelta
  | WsMsgAssistantEnd
  | WsMsgHandoff
  | WsMsgHandoffPending
  | WsMsgChainWaiting
  | WsMsgAskUser
  | WsMsgAgentNotification
  | WsMsgPlanCreated
  | WsMsgPlanUpdated
  | WsMsgPlanDeleted
  | WsMsgSystemNotice
  | WsMsgRecoveryStarted
  | WsMsgRecoveryCompleted
  | WsMsgRecoveryDecision
  | WsMsgSkillsApplied
  | WsMsgApiKey
  | WsMsgImage
  | WsMsgText;
