import type { TransportStats } from '@dsh-remote/protocol'
import type { AdaptiveConnectionDetails } from '@dsh-remote/webrtc'
import { strings as zhCN } from './locales/i18n'

export type AgentBackend = 'harness' | 'codex'

export type ConnectionPhase =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'

export type ConnectionStage =
  | 'authenticating'
  | 'transport'
  | 'secure'
  | 'loading'
  | 'ready'

export type ConnectionProbeTransport = 'lan' | 'p2p' | 'turn' | 'relay'

export type LoginMethod = 'oauth' | 'github-oauth' | 'password'

export type RedirectLoginMethod = Extract<LoginMethod, 'oauth' | 'github-oauth'>

export interface ServerConfig {
  baseUrl: string
  account?: string
  loginMethod?: LoginMethod
}

export interface DeviceIdentity {
  deviceId: string
  name: string
  platform: 'android'
  publicKey: string
  privateKey: string
}

export interface DeviceCredentials {
  serverUrl: string
  deviceId: string
  authorizationMethod: 'account' | 'owned_device'
  account?: string
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
  refreshTokenExpiresAt: number
}

/** A Host visible through same-account membership, with its pinned identity key. */
export interface RemoteDevice {
  deviceId: string
  name: string
  platform: string
  /** Pinned Noise static X25519 public key; never replaced by a Server response. */
  identityKey: string
  membershipId: string
  online: boolean
  role?: 'host' | 'client'
  clientVersion?: string
  harnessVersion?: string
  lastSeenAt?: number
  fingerprint?: string
  trusted: boolean
}

export interface DevicePresence {
  deviceId: string
  online: boolean
  lastSeenAt?: number
}

export interface HostDescriptor {
  version: string
  cwd: string
  provider?: string
  model?: string
  attachedSessions: number
  canOpenPath: boolean
}

export interface WorkspaceView {
  workspaceId: string
  backend?: AgentBackend
  nativeId?: string
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

export interface WorkspaceList {
  items: WorkspaceView[]
  archivedSessionIds: string[]
}

export interface DirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

export interface DirectoryListing {
  path: string
  home: string
  crumbs: DirectoryEntry[]
  entries: DirectoryEntry[]
  truncated: boolean
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface ModelReasoning {
  efforts: ModelReasoningEffort[]
  defaultEffort?: string
}

export interface ModelCatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: ModelReasoning
}

export interface ModelProviderGroup {
  id: string
  name: string
  models: ModelCatalogModel[]
}

export interface ModelCatalogFailure {
  id: string
  name: string
  message: string
}

export interface SessionModels {
  current: ModelSelection
  routable: boolean
  groups: ModelProviderGroup[]
  failures: ModelCatalogFailure[]
}

/** Native ApiProxy session row projection (mirrors @deepseek-ai/dsh-host-apiproxy). */
export interface RemoteSession {
  sessionId: string
  backend?: AgentBackend
  nativeId?: string
  updatedAt: number
  running: boolean
  blank: boolean
  title?: string
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  agentPreset?: string
  projections?: {
    values?: Record<string, unknown>
  }
}

export interface PermissionPresetOption {
  value: string
  name: string
  description?: string
}

export interface PermissionSelect {
  currentValue: string
  options: PermissionPresetOption[]
}

export type CodexPermissionPreset = 'workspace-write' | 'danger-full-access'

export interface HistoryEntry {
  event: NativeSessionEvent
  view?: { for: 'call' | 'result'; view: unknown }
}

export interface SessionHistoryPage {
  events: HistoryEntry[]
  hasMore: boolean
  activeTurnId?: string
}

export interface ChatItemBase {
  id: string
  sessionId: string
  createdAt: number
}

export interface ChatMessage extends ChatItemBase {
  kind: 'message'
  role: 'user' | 'assistant' | 'system'
  text: string
  reasoning?: string
  images?: ChatImage[]
  streaming?: boolean
  streamingPhase?: 'reasoning' | 'text'
  /** Native session.prompt rpcId used to reconcile an optimistic user message. */
  requestRpcId?: string
}

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Temporary image bytes carried only in one native session.prompt request. */
export interface PromptImage {
  uri: string
  mediaType: ImageMediaType
  data: string
  bytes: number
  width: number
  height: number
  name?: string
}

/** Image presentation retained in the local optimistic chat row. */
export interface ChatImage {
  uri?: string
  name?: string
}

export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  maxImageDimension: number
  mediaTypes: readonly ImageMediaType[]
}

export interface ToolActivity extends ChatItemBase {
  kind: 'tool'
  toolName: string
  images?: ChatImage[]
  arguments?: string
  summary?: string
  callDetail?: ToolDisplayDetail
  resultDetail?: ToolDisplayDetail
  state: 'running' | 'finished' | 'failed'
}

export interface ToolDisplayDetail {
  text: string
  format: 'code' | 'markdown'
  truncated?: boolean
}

export interface ApprovalActivity extends ChatItemBase {
  kind: 'approval'
  approvalId: string
  toolName: string
  reason?: string
  frameRpcId?: string
  outcome?: ApprovalOutcome
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface QuestionActivity extends ChatItemBase {
  kind: 'question'
  frameRpcId?: string
  questions: AskUserQuestionItem[]
  outcome?: 'answered' | 'cancelled'
}

export type ChatItem = ChatMessage | ToolActivity | ApprovalActivity | QuestionActivity

/** Wire-safe question surface (mirrors @deepseek-ai/dsh-user-questions/types). */
export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: AskUserQuestionOption[]
  multiSelect?: boolean
  intent?: { kind: 'plan-review'; approve: string }
}

export interface AskUserQuestionAnswer {
  answers: Array<{ id: string; selected: string[]; custom?: string }>
}

/** Structural mirror of @deepseek-ai/dsh-session SessionEvent (wire subset used by chat). */
export interface NativeSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  sourceEventSeqs?: number[]
  surfaceOp?: 'append'
    | { op: 'replace'; start: number; end: number }
    | { op: 'replace'; startSeq: number; endSeq: number }
  ignorable?: true
}

export interface MuxFrame {
  type: string
  sessionId?: string
  event?: NativeSessionEvent
  view?: unknown
  lastSeq?: number
  approvalId?: string
  toolName?: string
  callId?: string
  reason?: string
  outcome?: string
  questions?: AskUserQuestionItem[]
  questionRpcId?: string
  error?: unknown
}

/** One mux stream frame with its native rpcId (needed to answer approvals/questions). */
export interface MuxStreamFrame {
  rpcId: string
  payload: MuxFrame
}

export interface HarnessApiFrame {
  streamId: string
  frame: { rpcId: string; payload: MuxFrame }
}

export interface ConnectionSnapshot {
  phase: ConnectionPhase
  stats: TransportStats
  error?: string
}

/** Diagnostics for the currently selected network path. Kept in memory only. */
export type ConnectionNetworkDetails = AdaptiveConnectionDetails

export interface PairLink {
  server?: string
}

/** Client-side transport routing preference (mirrors the Web Remote console). */
export type TransportPreference = 'auto' | 'turn' | 'relay'

export interface TransportPreferenceOption {
  value: TransportPreference
  name: string
  description: string
}

export function transportPreferenceOptions(): TransportPreferenceOption[] {
  return [
    { value: 'auto', name: zhCN.transport.auto, description: zhCN.transport.autoDescription },
    { value: 'turn', name: zhCN.transport.turn, description: zhCN.transport.turnDescription },
    { value: 'relay', name: zhCN.transport.relay, description: zhCN.transport.relayDescription },
  ]
}
