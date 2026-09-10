import { z } from 'zod'

export const PROTOCOL_VERSION = 1
export const MAX_CONTROL_FRAME_BYTES = 64 * 1024
export const MAX_RELAY_FRAME_BYTES = 1024 * 1024
export const SECURE_FRAGMENT_CHUNK_BYTES = 48 * 1024
export const MAX_SECURE_MESSAGE_BYTES = 4 * 1024 * 1024
/** Decoded bytes carried by one authenticated Harness business transfer chunk. */
export const HARNESS_API_TRANSFER_CHUNK_BYTES = 512 * 1024
/** Decoded bytes carried by one authenticated Codex domain transfer chunk. */
export const CODEX_APP_TRANSFER_CHUNK_BYTES = 512 * 1024
/**
 * Bounded transfer size for Harness image prompts. The upstream default admits
 * up to 200 MiB of source images; their base64 JSON envelope needs roughly
 * 267 MiB, so 288 MiB leaves room for the native request structure.
 */
export const MAX_HARNESS_API_TRANSFER_BYTES = 288 * 1024 * 1024
export const MAX_CODEX_APP_TRANSFER_BYTES = 288 * 1024 * 1024
export const MAX_DEVICE_NAME_LENGTH = 128
export const MAX_DEVICE_PLATFORM_LENGTH = 64
export const MAX_DEVICE_VERSION_LENGTH = 64
export const MAX_AUTH_TOKEN_LENGTH = 8 * 1024

// ────────────────────────────────────────────────────────────────────────────
// §24 Default limits
// ────────────────────────────────────────────────────────────────────────────

/** Hello frame must arrive within this timeout after WebSocket open. */
export const HELLO_TIMEOUT_MS = 5_000
/** Host registration code time-to-live. */
export const HOST_REGISTRATION_CODE_TTL_MS = 10 * 60_000
/** Default control channel heartbeat interval. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000
/** Disconnection threshold: no valid pong within this window. */
export const HEARTBEAT_DISCONNECT_MS = 75_000
/** Maximum in-flight RPC requests per connection. */
export const MAX_PENDING_RPC_PER_CONNECTION = 128
/** Maximum pending permission requests per session. */
export const MAX_PENDING_PERMISSION_PER_SESSION = 16
/** Maximum ICE candidates收集 per connection. */
export const MAX_ICE_CANDIDATES_PER_CONNECTION = 256
/** Maximum active transfers per direction per connection. */
export const MAX_ACTIVE_TRANSFERS_PER_DIRECTION = 2
/** Transfer idle timeout before automatic cleanup. */
export const TRANSFER_IDLE_MS = 2 * 60_000
/** Maximum RPC text input size. */
export const MAX_RPC_TEXT_INPUT_BYTES = 64 * 1024
/** Maximum File Viewer range per RPC call. */
export const MAX_FILEVIEWER_RANGE_BYTES = 512 * 1024
/** Maximum directory entries returned by File Viewer per RPC. */
export const MAX_FILEVIEWER_DIRECTORY_ENTRIES = 1_000
/** Minimum event replay window by event count. */
export const MIN_REPLAY_WINDOW_EVENTS = 10_000
/** Minimum event replay window by time. */
export const MIN_REPLAY_WINDOW_MS = 15 * 60_000
/** Maximum concurrent alpha streams per connection. */
export const MAX_ALPHA_STREAMS_PER_CONNECTION = 16

const SECURE_FRAGMENT_MAGIC = new Uint8Array([0x44, 0x53, 0x48, 0x46]) // DSHF
const SECURE_FRAGMENT_VERSION = 1
const SECURE_FRAGMENT_HEADER_BYTES = 17
const MAX_IN_FLIGHT_SECURE_MESSAGES = 8

export const messageTypes = [
  'rpc.request',
  'rpc.response',
  'rpc.error',
  'event',
] as const

export const controlFrameTypes = [
  'hello',
  'hello.ack',
  'connect.request',
  'connect.incoming',
  'connect.accepted',
  'connect.rejected',
  'secure.handshake',
  'relay',
  'signal.offer',
  'signal.answer',
  'signal.ice',
  'transport.selected',
  'ping',
  'pong',
  'error',
] as const

export const rpcMethods = [
  'harness.transport.describe',
  'harness.api.call',
  'harness.api.transfer.open',
  'harness.api.transfer.chunk',
  'harness.api.transfer.commit',
  'harness.api.transfer.read',
  'harness.api.transfer.close',
  'harness.api.respond',
  'harness.api.stream.open',
  'harness.api.stream.close',
  'harness.remote.call',
  'harness.remote.transfer.open',
  'harness.remote.transfer.chunk',
  'harness.remote.transfer.commit',
  'harness.remote.transfer.read',
  'harness.remote.transfer.close',
  'harness.remote.stream.open',
  'harness.remote.stream.close',
  'fileviewer.call',
  'codex.app.call',
  'codex.app.respond',
  'codex.app.stream.open',
  'codex.app.stream.close',
  'codex.app.transfer.open',
  'codex.app.transfer.chunk',
  'codex.app.transfer.commit',
  'codex.app.transfer.read',
  'codex.app.transfer.close',
] as const

export const remoteEvents = [
  'harness.api.frame',
  'harness.api.stream.closed',
  'harness.remote.frame',
  'harness.remote.stream.closed',
  'codex.app.frame',
  'codex.app.stream.closed',
] as const

export const errorCodes = [
  // Protocol / Version
  'INVALID_MESSAGE',
  'UNSUPPORTED_VERSION',
  'CAPABILITY_NOT_SUPPORTED',
  'METHOD_NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'REQUEST_CONFLICT',
  'FRAME_TOO_LARGE',
  'RATE_LIMITED',
  // Auth / Device
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'ACCOUNT_AUTH_REQUIRED',
  'TOKEN_EXPIRED',
  'DEVICE_NOT_FOUND',
  'DEVICE_REVOKED',
  'DEVICE_OWNERSHIP_REQUIRED',
  'MEMBERSHIP_REQUIRED',
  'PEER_IDENTITY_MISMATCH',
  'HOST_REGISTRATION_CODE_NOT_FOUND',
  'HOST_REGISTRATION_CODE_EXPIRED',
  'HOST_REGISTRATION_CODE_CONSUMED',
  // Connection / Transport
  'HOST_OFFLINE',
  'CONNECTION_NOT_FOUND',
  'CONNECTION_FAILED',
  'CONNECTION_REPLACED',
  'P2P_FAILED',
  'TURN_UNAVAILABLE',
  'RELAY_UNAVAILABLE',
  'SLOW_CONSUMER',
  'SECURE_CHANNEL_FAILED',
  // Harness
  'HARNESS_UNAVAILABLE',
  'HARNESS_VERSION_INCOMPATIBLE',
  'RESPONSE_TOO_LARGE',
  'SESSION_NOT_FOUND',
  'SESSION_NOT_READY',
  'AGENT_BUSY',
  'PERMISSION_DENIED',
  'PERMISSION_NOT_PENDING',
  'RPC_TIMEOUT',
  'FULL_RESYNC_REQUIRED',
  'INTERNAL_ERROR',
] as const

/**
 * Known wire-protocol error codes from §23, §17 (HARNESS_VERSION_INCOMPATIBLE),
 * and the transfer protocol (RESPONSE_TOO_LARGE — Client must retry via chunked path).
 *
 * This is the authoritative reference set; callers should prefer these codes but
 * the wire format accepts any string to allow subsystem-specific extensions
 * (e.g. CODEX_*, FILE_VIEWER_*) without a protocol version bump.
 */
export type ErrorCode = typeof errorCodes[number]

export type MessageType = typeof messageTypes[number]
export type ControlFrameType = typeof controlFrameTypes[number]
export type RpcMethod = typeof rpcMethods[number]
export type RemoteEventName = typeof remoteEvents[number]

export interface HostDeviceDescriptor {
  deviceId: string
  name: string
  role: 'host'
  platform: string
  identityKey: string
  clientVersion: string
  harnessVersion?: string
}

export interface ClientDeviceDescriptor {
  deviceId: string
  name: string
  role: 'client'
  platform: string
  identityKey: string
  clientVersion: string
}

export type AccountDeviceDescriptor = HostDeviceDescriptor | ClientDeviceDescriptor

export interface DeviceRegistrationRequest {
  v: typeof PROTOCOL_VERSION
  device: AccountDeviceDescriptor
}

export interface HostRegistrationCodeRequest {
  v: typeof PROTOCOL_VERSION
  code: string
  device: HostDeviceDescriptor
}

export interface DeviceRefreshRequest {
  deviceId: string
  refreshToken: string
}

export interface DeviceTokenPair {
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
  refreshTokenExpiresAt: number
}

export interface BrowserAuthorizationExchangeRequest {
  v: typeof PROTOCOL_VERSION
  device: ClientDeviceDescriptor & { platform: 'browser' }
}

export interface BrowserAuthorizationExchangeResponse extends DeviceTokenPair {
  account: string
}

export interface ControlFrame<TPayload = unknown> {
  v: typeof PROTOCOL_VERSION
  id: string
  type: ControlFrameType
  timestamp: number
  payload: TPayload
}

export interface ControlFrameByteLimits {
  maxControlFrameBytes?: number
  maxRelayFrameBytes?: number
}

export interface HelloPayload {
  role: 'host' | 'client'
  deviceId: string
  accessToken: string
  protocols: number[]
  capabilities: string[]
  /** Version of the Client/Plugin software reporting in; symmetric to ``HelloAckPayload.serverVersion``. */
  clientVersion?: string
  /** Host Harness version; sent on first hello to refresh the device record. */
  harnessVersion?: string
}

export interface HelloAckPayload {
  protocol: typeof PROTOCOL_VERSION
  serverVersion: string
  connectionSessionId: string
  heartbeatIntervalMs: number
  maxControlFrameBytes: number
  maxRelayFrameBytes: number
  capabilities?: string[]
  webrtcEnabled?: boolean
  webrtcFallbackTimeoutMs?: number
}

export interface ConnectRequestPayload {
  hostDeviceId: string
  preferredTransports: Array<'lan' | 'p2p' | 'turn' | 'relay'>
}

export interface ConnectIncomingPayload {
  connectionId: string
  clientDeviceId: string
  clientIdentityKey: string
  authorization: 'account'
  preferredTransports: Array<'lan' | 'p2p' | 'turn' | 'relay'>
}

export interface ConnectAcceptedPayload {
  connectionId: string
}

export interface ConnectRejectedPayload {
  connectionId: string
  code?: string
  message?: string
}

export interface SecureHandshakePayload {
  connectionId: string
  targetDeviceId: string
  step: number
  data: string
}

export interface ControlErrorPayload {
  /** Known wire-protocol codes from §23/§17. */
  code: ErrorCode | (string & {})
  message: string
  retryable?: boolean
  connectionId?: string
}

export interface RelayPayload {
  connectionId: string
  targetDeviceId: string
  counter: number
  ciphertext: string
}

export const selectedTransports = ['lan', 'p2p', 'turn', 'relay'] as const
export type SelectedTransport = typeof selectedTransports[number]

export interface SignalPayload {
  connectionId: string
  targetDeviceId: string
  sdp: string
}

export interface IceCandidatePayload {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export interface SignalIcePayload {
  connectionId: string
  targetDeviceId: string
  candidate: IceCandidatePayload
}

export function normalizeSdpMLineIndex(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return value
}

export interface TransportSelectedPayload {
  connectionId: string
  targetDeviceId: string
  transport: SelectedTransport
}

/** Capabilities both ends announce in ``hello`` to negotiate the data plane. */
export const transportCapabilities = [
  'transport.lan',
  'transport.p2p',
  'transport.turn',
  'transport.relay',
] as const

export function selectProtocolVersion(
  offered: readonly number[],
  supported: readonly number[] = [PROTOCOL_VERSION],
): number | undefined {
  const supportedVersions = new Set(supported)
  return [...offered]
    .filter(version => supportedVersions.has(version))
    .sort((left, right) => right - left)[0]
}

export function selectCapabilities(
  offered: readonly string[],
  supported: readonly string[],
): string[] {
  const offeredCapabilities = new Set(offered)
  return [...new Set(supported)].filter(capability => offeredCapabilities.has(capability))
}

export function acceptNegotiatedCapabilities(
  offered: readonly string[],
  negotiated: readonly string[] | undefined,
): string[] {
  const accepted = negotiated ?? ['transport.relay']
  if (selectCapabilities(accepted, offered).length !== accepted.length) {
    throw new Error('Server selected a capability that the peer did not offer.')
  }
  return [...accepted]
}

export interface RemoteMessage<TPayload = unknown> {
  v: typeof PROTOCOL_VERSION
  id: string
  type: MessageType
  timestamp: number
  payload: TPayload
}

export interface RpcRequestPayload<TParams = unknown> {
  method: RpcMethod
  params: TParams
}

export interface RpcResponsePayload<TResult = unknown> {
  requestId: string
  result: TResult
}

export interface RpcErrorPayload {
  requestId: string
  /** Known wire-protocol codes from §23/§17; subsystem extensions (CODEX_*, FILE_VIEWER_*, etc.) are also valid. */
  code: ErrorCode | (string & {})
  message: string
  retryable?: boolean
  details?: unknown
}

export interface EventPayload<TData = unknown> {
  seq?: number
  event: RemoteEventName
  sessionId?: string
  data: TData
}

export interface DeviceDescriptor {
  deviceId: string
  name: string
  role: 'host' | 'client'
  platform: string
  identityKey: string
  clientVersion: string
  harnessVersion?: string
}

export interface TransportStats {
  mode: 'LAN' | 'P2P' | 'TURN' | 'Relay' | 'Disconnected'
  connected: boolean
  rttMs?: number
  bytesSent?: number
  bytesReceived?: number
}

/** Native Harness API request tunneled inside the authenticated business channel. */
export interface HarnessApiCallParams {
  method: string
  rpcId: string
  payload: unknown
}

export interface HarnessApiTransferOpenParams {
  transferId: string
  totalBytes: number
  totalChunks: number
}

export interface HarnessApiTransferChunkParams {
  transferId: string
  index: number
  data: string
}

export interface HarnessApiTransferCommitParams {
  transferId: string
}

export interface HarnessApiTransferReadParams {
  transferId: string
  index: number
}

export interface HarnessApiTransferCloseParams {
  transferId: string
}

export type HarnessApiTransferCommitResult =
  | { kind: 'inline'; response: unknown }
  | { kind: 'chunked'; transferId: string; totalBytes: number; totalChunks: number }

export interface HarnessApiTransferReadResult {
  transferId: string
  index: number
  data: string
}

/** Response to an answerable native Harness server request (approval/question). */
export interface HarnessApiRespondParams {
  message: {
    type: 'client-response'
    rpcId: string
    result: unknown
  }
}

export interface HarnessApiStreamOpenParams {
  streamId: string
  stream: 'mux' | 'host'
  rpcId: string
  payload: {
    /** Optional mux focus: only forward frames for this session. */
    sessionId?: string
  }
}

export interface HarnessApiStreamCloseParams {
  streamId: string
}

export interface HarnessApiFrameData {
  streamId: string
  frame: {
    rpcId: string
    payload: unknown
  }
}

export interface HarnessApiStreamClosedData {
  streamId: string
  reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected'
}

/** Alpha Typert Remote carrier request after the local Gateway encoded it. */
export interface HarnessRemoteCallParams {
  endpoint: string
  payload: unknown
}

export interface HarnessRemoteStreamOpenParams {
  streamId: string
  endpoint: string
  payload: unknown
}

export interface HarnessRemoteStreamCloseParams {
  streamId: string
}

export interface HarnessRemoteFrameData {
  streamId: string
  hasValue: true
  value?: unknown
}

export interface HarnessRemoteStreamClosedData {
  streamId: string
  reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected'
  failure?: {
    code: string
    message: string
    details: Record<string, unknown>
  }
}

export interface HarnessTransportDescription {
  capabilities: string[]
}

export type CodexPermissionPreset = 'workspace-write' | 'danger-full-access'

/** Optional dsh/sessionHistory metadata; null means the Host has no confirmed preset. */
export interface CodexPermissionSnapshot {
  permissionPreset?: CodexPermissionPreset | null
}

/** Fixed allowlisted Codex App Server call carried inside Remote. */
export interface CodexAppCallParams {
  method: string
  params: unknown
}

export interface CodexAppRespondParams {
  requestHandle: string
  decision: 'accept' | 'decline' | 'cancel'
}

export interface CodexAppStreamOpenParams {
  streamId: string
  threadId: string
}

export interface CodexAppStreamCloseParams {
  streamId: string
}

export interface CodexAppFrameData {
  streamId: string
  frame: {
    method: string
    params: unknown
  }
}

export interface CodexAppStreamClosedData {
  streamId: string
  reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected'
}

export interface CodexAppTransferOpenParams {
  transferId: string
  totalBytes: number
  totalChunks: number
}

export interface CodexAppTransferChunkParams {
  transferId: string
  index: number
  data: string
}

export interface CodexAppTransferCommitParams { transferId: string }
export interface CodexAppTransferReadParams { transferId: string; index: number }
export interface CodexAppTransferCloseParams { transferId: string }

export type CodexAppTransferCommitResult =
  | { kind: 'inline'; response: unknown }
  | { kind: 'chunked'; transferId: string; totalBytes: number; totalChunks: number }

export interface CodexAppTransferReadResult {
  transferId: string
  index: number
  data: string
}

const rpcMethodSchema = z.enum(rpcMethods)
const messageTypeSchema = z.enum(messageTypes)
const controlFrameTypeSchema = z.enum(controlFrameTypes)
export const errorCodeSchema = z.enum(errorCodes)
const uniqueStrings = (values: string[]): boolean => new Set(values).size === values.length
const uniqueNumbers = (values: number[]): boolean => new Set(values).size === values.length
const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength
const boundedUtf8Schema = (minimum: number, maximum: number): z.ZodType<string> => z.string()
  .refine(value => utf8Length(value) >= minimum && utf8Length(value) <= maximum)

const deviceIdSchema = z.string().refine(value => (
  /^[0-9A-HJKMNP-TV-Z]{26}$/iu.test(value)
  || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
), 'Device ID must be a ULID or UUID.')
const deviceNameSchema = boundedUtf8Schema(1, MAX_DEVICE_NAME_LENGTH)
  .refine(value => value.trim().length > 0, 'Device name must contain visible text.')
const devicePlatformSchema = z.string().min(1).max(MAX_DEVICE_PLATFORM_LENGTH)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u)
const identityKeySchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u)
const deviceVersionSchema = boundedUtf8Schema(1, MAX_DEVICE_VERSION_LENGTH)
const authTokenSchema = boundedUtf8Schema(16, MAX_AUTH_TOKEN_LENGTH)
const expiresAtSchema = z.number().int().positive().safe()

export const hostDeviceDescriptorSchema: z.ZodType<HostDeviceDescriptor> = z.object({
  deviceId: deviceIdSchema,
  name: deviceNameSchema,
  role: z.literal('host'),
  platform: devicePlatformSchema,
  identityKey: identityKeySchema,
  clientVersion: deviceVersionSchema,
  harnessVersion: deviceVersionSchema.optional(),
}).strict()

export const clientDeviceDescriptorSchema: z.ZodType<ClientDeviceDescriptor> = z.object({
  deviceId: deviceIdSchema,
  name: deviceNameSchema,
  role: z.literal('client'),
  platform: devicePlatformSchema,
  identityKey: identityKeySchema,
  clientVersion: deviceVersionSchema,
}).strict()

export const accountDeviceDescriptorSchema: z.ZodType<AccountDeviceDescriptor> = z.union([
  hostDeviceDescriptorSchema,
  clientDeviceDescriptorSchema,
])

export const deviceRegistrationRequestSchema: z.ZodType<DeviceRegistrationRequest> = z.object({
  v: z.literal(PROTOCOL_VERSION),
  device: accountDeviceDescriptorSchema,
}).strict()

export const hostRegistrationCodeRequestSchema: z.ZodType<HostRegistrationCodeRequest> = z.object({
  v: z.literal(PROTOCOL_VERSION),
  code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/u),
  device: hostDeviceDescriptorSchema,
}).strict()

/** §8.1.2 Register a new opposite-role device using an existing device access token. */
export interface RegisterOwnedRoleRequest {
  v: typeof PROTOCOL_VERSION
  device: AccountDeviceDescriptor
}

export const registerOwnedRoleRequestSchema: z.ZodType<RegisterOwnedRoleRequest> = z.object({
  v: z.literal(PROTOCOL_VERSION),
  device: accountDeviceDescriptorSchema,
}).strict()

export const deviceRefreshRequestSchema: z.ZodType<DeviceRefreshRequest> = z.object({
  deviceId: deviceIdSchema,
  refreshToken: authTokenSchema,
}).strict()

export const deviceTokenPairSchema: z.ZodType<DeviceTokenPair> = z.object({
  accessToken: authTokenSchema,
  accessTokenExpiresAt: expiresAtSchema,
  refreshToken: authTokenSchema,
  refreshTokenExpiresAt: expiresAtSchema,
}).strict()

export const browserAuthorizationExchangeRequestSchema: z.ZodType<BrowserAuthorizationExchangeRequest> = z.object({
  v: z.literal(PROTOCOL_VERSION),
  device: z.object({
    deviceId: deviceIdSchema,
    name: deviceNameSchema,
    role: z.literal('client'),
    platform: z.literal('browser'),
    identityKey: identityKeySchema,
    clientVersion: deviceVersionSchema,
  }).strict(),
}).strict()

export const browserAuthorizationExchangeResponseSchema: z.ZodType<BrowserAuthorizationExchangeResponse> = z.object({
  accessToken: authTokenSchema,
  accessTokenExpiresAt: expiresAtSchema,
  refreshToken: authTokenSchema,
  refreshTokenExpiresAt: expiresAtSchema,
  account: boundedUtf8Schema(1, 254).refine(value => value.trim().length > 0),
}).strict()

export const remoteMessageSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  type: messageTypeSchema,
  timestamp: z.number().int().positive(),
  payload: z.unknown(),
}) as unknown as z.ZodType<RemoteMessage>

export const controlFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  type: controlFrameTypeSchema,
  timestamp: z.number().int().positive(),
  payload: z.unknown(),
}).strict() as unknown as z.ZodType<ControlFrame>

// ────────────────────────────────────────────────────────────────────────────
// Control frame payload schemas (protocol.md §10-§23)
// ────────────────────────────────────────────────────────────────────────────

const transportEnum = z.enum(['lan', 'p2p', 'turn', 'relay'])
const selectedTransportEnum = z.enum(selectedTransports)

export const helloPayloadSchema = z.object({
  role: z.enum(['host', 'client']),
  deviceId: z.string().min(1),
  accessToken: z.string().min(1),
  protocols: z.array(z.number().int().nonnegative().safe()).min(1).refine(uniqueNumbers),
  capabilities: z.array(z.string().min(1)).refine(uniqueStrings),
  clientVersion: z.string().optional(),
  harnessVersion: z.string().optional(),
})

export const helloAckPayloadSchema = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  serverVersion: z.string().min(1),
  connectionSessionId: z.string().min(1),
  heartbeatIntervalMs: z.number().int().positive(),
  maxControlFrameBytes: z.number().int().positive().max(MAX_CONTROL_FRAME_BYTES),
  maxRelayFrameBytes: z.number().int().positive().max(MAX_RELAY_FRAME_BYTES),
  capabilities: z.array(z.string().min(1)).refine(uniqueStrings).optional(),
  webrtcEnabled: z.boolean().optional(),
  webrtcFallbackTimeoutMs: z.number().int().positive().optional(),
})

export const connectRequestPayloadSchema = z.object({
  hostDeviceId: z.string().min(1),
  preferredTransports: z.array(transportEnum).min(1),
})

export const connectIncomingPayloadSchema = z.object({
  connectionId: z.string().min(1),
  clientDeviceId: z.string().min(1),
  clientIdentityKey: z.string().min(1),
  authorization: z.literal('account'),
  preferredTransports: z.array(transportEnum).min(1),
})

export const connectAcceptedPayloadSchema = z.object({
  connectionId: z.string().min(1),
})

export const connectRejectedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  code: z.string().optional(),
  message: z.string().optional(),
})

export const secureHandshakePayloadSchema = z.object({
  connectionId: z.string().min(1),
  targetDeviceId: z.string().min(1),
  step: z.number().int().positive(),
  data: z.string().min(1),
})

export const relayPayloadSchema = z.object({
  connectionId: z.string().min(1),
  targetDeviceId: z.string().min(1),
  counter: z.number().int().nonnegative().safe(),
  ciphertext: z.string().min(1),
})

export const signalPayloadSchema = z.object({
  connectionId: z.string().min(1),
  targetDeviceId: z.string().min(1),
  sdp: z.string().min(1),
})

export const signalIcePayloadSchema = z.object({
  connectionId: z.string().min(1),
  targetDeviceId: z.string().min(1),
  candidate: z.object({
    candidate: z.string().optional(),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.preprocess(normalizeSdpMLineIndex, z.number().int().nonnegative().nullable().optional()),
    usernameFragment: z.string().nullable().optional(),
  }),
})

export const transportSelectedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  targetDeviceId: z.string().min(1),
  transport: selectedTransportEnum,
})

export const pingPongPayloadSchema = z.object({
  nonce: z.string().min(1),
})

export const controlErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
  connectionId: z.string().min(1).optional(),
})

const controlFramePayloadSchemas: Record<ControlFrameType, z.ZodType> = {
  'hello': helloPayloadSchema,
  'hello.ack': helloAckPayloadSchema,
  'connect.request': connectRequestPayloadSchema,
  'connect.incoming': connectIncomingPayloadSchema,
  'connect.accepted': connectAcceptedPayloadSchema,
  'connect.rejected': connectRejectedPayloadSchema,
  'secure.handshake': secureHandshakePayloadSchema,
  'relay': relayPayloadSchema,
  'signal.offer': signalPayloadSchema,
  'signal.answer': signalPayloadSchema,
  'signal.ice': signalIcePayloadSchema,
  'transport.selected': transportSelectedPayloadSchema,
  'ping': pingPongPayloadSchema,
  'pong': pingPongPayloadSchema,
  'error': controlErrorPayloadSchema,
}

export const rpcRequestPayloadSchema = z.object({
  method: rpcMethodSchema,
  params: z.unknown(),
}) as unknown as z.ZodType<RpcRequestPayload>

export const rpcResponsePayloadSchema = z.object({
  requestId: z.string().min(1),
  result: z.unknown(),
}) as unknown as z.ZodType<RpcResponsePayload>

export const rpcErrorPayloadSchema: z.ZodType<RpcErrorPayload> = z.object({
  requestId: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
  details: z.unknown().optional(),
})

export function createMessage<TPayload>(
  type: MessageType,
  payload: TPayload,
  id = cryptoRandomId(),
): RemoteMessage<TPayload> {
  return {
    v: PROTOCOL_VERSION,
    id,
    type,
    timestamp: Date.now(),
    payload,
  }
}

export function createControlFrame<TPayload>(
  type: ControlFrameType,
  payload: TPayload,
  id = cryptoRandomId(),
): ControlFrame<TPayload> {
  return {
    v: PROTOCOL_VERSION,
    id,
    type,
    timestamp: Date.now(),
    payload,
  }
}

export function createRpcRequest<TParams>(
  method: RpcMethod,
  params: TParams,
  id?: string,
): RemoteMessage<RpcRequestPayload<TParams>> {
  return createMessage('rpc.request', { method, params }, id)
}

export function createRpcResponse<TResult>(
  requestId: string,
  result: TResult,
): RemoteMessage<RpcResponsePayload<TResult>> {
  return createMessage('rpc.response', { requestId, result })
}

export function createRpcError(
  requestId: string,
  code: ErrorCode | (string & {}),
  message: string,
  details?: unknown,
  retryable?: boolean,
): RemoteMessage<RpcErrorPayload> {
  return createMessage('rpc.error', { requestId, code, message, details, retryable })
}

export function createEvent<TData>(
  event: RemoteEventName,
  data: TData,
  options: { seq?: number; sessionId?: string } = {},
): RemoteMessage<EventPayload<TData>> {
  return createMessage('event', { event, data, ...options })
}

export function parseRemoteMessage(input: unknown): RemoteMessage {
  return remoteMessageSchema.parse(input)
}

export function parseControlFrame(input: unknown): ControlFrame {
  const frame = controlFrameSchema.parse(input)
  const payloadSchema = controlFramePayloadSchemas[frame.type]
  if (payloadSchema) {
    return { ...frame, payload: payloadSchema.parse(frame.payload) }
  }
  return frame
}

export function encodeControlFrame(frame: ControlFrame, limits: ControlFrameByteLimits = {}): string {
  const parsed = parseControlFrame(frame)
  const encoded = JSON.stringify(parsed)
  assertControlFrameSize(new TextEncoder().encode(encoded).byteLength, parsed.type, limits)
  return encoded
}

export function decodeControlFrame(data: Uint8Array | string, limits: ControlFrameByteLimits = {}): ControlFrame {
  const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data
  if (encoded.byteLength > MAX_RELAY_FRAME_BYTES) throw new Error('Control frame exceeds the Relay frame limit.')
  const text = typeof data === 'string' ? data : new TextDecoder('utf-8', { fatal: true }).decode(data)
  const frame = parseControlFrame(JSON.parse(text))
  assertControlFrameSize(encoded.byteLength, frame.type, limits)
  return frame
}

export function encodeMessage(message: RemoteMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message))
}

export function decodeMessage(data: Uint8Array | string): RemoteMessage {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
  return parseRemoteMessage(JSON.parse(text))
}

interface FragmentAssembly {
  total: number
  totalBytes: number
  receivedBytes: number
  chunks: Uint8Array[]
}

/**
 * Splits application plaintext before Noise encryption and reassembles it
 * after decryption. Noise transport messages have a 65,535-byte ceiling, so
 * large native ApiProxy responses cannot be encrypted as one message.
 */
export class SecureMessageCodec {
  private nextMessageId = 1
  private readonly assemblies = new Map<number, FragmentAssembly>()

  encode(message: Uint8Array): Uint8Array[] {
    if (message.byteLength > MAX_SECURE_MESSAGE_BYTES) {
      throw new Error('Secure message exceeds the reassembly limit.')
    }
    if (message.byteLength <= SECURE_FRAGMENT_CHUNK_BYTES) return [message]

    const messageId = this.nextMessageId
    this.nextMessageId = messageId === 0xffff_ffff ? 1 : messageId + 1
    const total = Math.ceil(message.byteLength / SECURE_FRAGMENT_CHUNK_BYTES)
    const frames: Uint8Array[] = []
    for (let index = 0; index < total; index += 1) {
      const start = index * SECURE_FRAGMENT_CHUNK_BYTES
      const chunk = message.subarray(start, Math.min(message.byteLength, start + SECURE_FRAGMENT_CHUNK_BYTES))
      const frame = new Uint8Array(SECURE_FRAGMENT_HEADER_BYTES + chunk.byteLength)
      frame.set(SECURE_FRAGMENT_MAGIC)
      frame[4] = SECURE_FRAGMENT_VERSION
      const view = new DataView(frame.buffer)
      view.setUint32(5, messageId)
      view.setUint16(9, index)
      view.setUint16(11, total)
      view.setUint32(13, message.byteLength)
      frame.set(chunk, SECURE_FRAGMENT_HEADER_BYTES)
      frames.push(frame)
    }
    return frames
  }

  decode(frame: Uint8Array): Uint8Array | undefined {
    if (!isSecureFragment(frame)) return frame
    if (frame.byteLength < SECURE_FRAGMENT_HEADER_BYTES || frame[4] !== SECURE_FRAGMENT_VERSION) {
      throw new Error('Secure fragment header is invalid.')
    }
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    const messageId = view.getUint32(5)
    const index = view.getUint16(9)
    const total = view.getUint16(11)
    const totalBytes = view.getUint32(13)
    if (messageId === 0 || total < 2 || index >= total || totalBytes <= SECURE_FRAGMENT_CHUNK_BYTES
      || totalBytes > MAX_SECURE_MESSAGE_BYTES
      || total !== Math.ceil(totalBytes / SECURE_FRAGMENT_CHUNK_BYTES)) {
      throw new Error('Secure fragment metadata is invalid.')
    }
    const expectedChunkBytes = Math.min(
      SECURE_FRAGMENT_CHUNK_BYTES,
      totalBytes - index * SECURE_FRAGMENT_CHUNK_BYTES,
    )
    const chunk = frame.subarray(SECURE_FRAGMENT_HEADER_BYTES)
    if (chunk.byteLength !== expectedChunkBytes) throw new Error('Secure fragment length is invalid.')

    let assembly = this.assemblies.get(messageId)
    if (assembly === undefined) {
      if (index !== 0 || this.assemblies.size >= MAX_IN_FLIGHT_SECURE_MESSAGES) {
        throw new Error('Secure fragment sequence is invalid.')
      }
      assembly = { total, totalBytes, receivedBytes: 0, chunks: [] }
      this.assemblies.set(messageId, assembly)
    }
    if (assembly.total !== total || assembly.totalBytes !== totalBytes || index !== assembly.chunks.length) {
      this.assemblies.delete(messageId)
      throw new Error('Secure fragment sequence is invalid.')
    }
    assembly.chunks.push(Uint8Array.from(chunk))
    assembly.receivedBytes += chunk.byteLength
    if (assembly.chunks.length < total) return undefined
    this.assemblies.delete(messageId)
    if (assembly.receivedBytes !== totalBytes) throw new Error('Secure message length is invalid.')
    const message = new Uint8Array(totalBytes)
    let offset = 0
    for (const part of assembly.chunks) {
      message.set(part, offset)
      offset += part.byteLength
    }
    return message
  }

  reset(): void {
    this.nextMessageId = 1
    this.assemblies.clear()
  }
}

function isSecureFragment(frame: Uint8Array): boolean {
  if (frame.byteLength < SECURE_FRAGMENT_MAGIC.byteLength) return false
  for (let index = 0; index < SECURE_FRAGMENT_MAGIC.byteLength; index += 1) {
    if (frame[index] !== SECURE_FRAGMENT_MAGIC[index]) return false
  }
  return true
}

function assertControlFrameSize(bytes: number, type: ControlFrameType, limits: ControlFrameByteLimits): void {
  const configured = type === 'relay' ? limits.maxRelayFrameBytes : limits.maxControlFrameBytes
  const protocolMaximum = type === 'relay' ? MAX_RELAY_FRAME_BYTES : MAX_CONTROL_FRAME_BYTES
  const maximum = configured === undefined ? protocolMaximum : Math.min(protocolMaximum, configured)
  if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error('Control frame limit is invalid.')
  if (bytes > maximum) throw new Error(`${type === 'relay' ? 'Relay' : 'Control'} frame exceeds its limit.`)
}

function cryptoRandomId(): string {
  const g = globalThis.crypto
  if (g?.randomUUID) return g.randomUUID()
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}
