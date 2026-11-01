import type { ControlResult } from './control-result.js'
import { RemoteClientCore } from '@dsh-remote/client-core'
import type { CodexAppFrameData, CodexAppStreamClosedData, RemoteWorkspaceTypeDescription } from '@dsh-remote/protocol'
import type { RtcConnectionDiagnostics, RtcIceServer } from '@dsh-remote/webrtc'
import { AdaptiveTransport, stunOnlyIceServers } from '@dsh-remote/webrtc'
import type { ResolvedConfig } from './config.js'
import type { TrustedPeer } from './identity-store.js'
import type { AuthorizedPeerDevice, ServerHostDevice } from './server-api.js'

export interface ConnectedRemote {
  client: RemoteClientCore
  target: TrustedPeer
  transport: AdaptiveTransport
  features: RemoteHostFeatures
  progressRunId: number
  clientVersion?: string
  harnessVersion?: string
}

export interface RemoteHostFeatures {
  commandList: boolean
  fileViewer: boolean
  terminal: boolean
  remoteGateway: boolean
  sessionFormat?: 3
  codex: boolean
  cursor: boolean
  antigravity: boolean
  pi?: boolean
  opencode: boolean
  claude?: boolean
  hermes?: boolean
  acpModelLoadsSession?: boolean
  workspaceTypes?: readonly RemoteWorkspaceTypeDescription[]
  pluginRoute: boolean
}

export interface CodexLoopbackStream {
  target: { kind: 'remote'; client: RemoteClientCore } | { kind: 'local' }
  frames: Array<{ method: string; params: unknown }>
  closed?: string
  unsubscribe: () => void
  close: () => Promise<void>
  wake: () => void
}

export const DIRECT_WEBRTC_NEGOTIATE_TIMEOUT_MS = 12_000

export const DIRECT_LAN_PROGRESS_DISPLAY_MS = 1_400

export const HOST_AUTHORIZATION_ERRORS = new Set([
  'ACCOUNT_AUTH_REQUIRED',
  'AUTH_INVALID',
  'DEVICE_OWNERSHIP_REQUIRED',
  'DEVICE_REVOKED',
  'TOKEN_EXPIRED',
])

export type TransportAttempt = 'direct' | 'turn' | 'relay'

export interface ConnectionProgressState {
  runId: number
  targetDeviceId: string
  phase: 'checking-host' | 'authorizing-peer' | 'probing' | 'connected'
  activeTransports?: Array<'lan' | 'p2p' | 'turn' | 'relay'>
}

export interface RemoteDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

export interface RemoteDirectoryListing {
  path: string
  home: string
  crumbs: RemoteDirectoryEntry[]
  entries: RemoteDirectoryEntry[]
  truncated: boolean
}

export interface RemoteWorkspaceView {
  workspaceId: string
  path: string
  title: string
}

export interface RemoteWorkspaceSelection {
  targetDeviceId: string
  workspaceId: string
  backend?: 'harness' | 'codex' | 'cursor' | 'antigravity' | 'pi' | 'opencode' | 'claude' | 'hermes'
  sessionId?: string
}

export interface RemoteDeviceView {
  deviceId: string
  name: string
  platform: string
  membershipId: string
  online: boolean
  lastSeenAt?: number
  clientVersion?: string
  harnessVersion?: string
}

export interface HostConnectionRpc {
  handle(
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ControlResult<unknown>>,
    options: { authority: 'loopback' | 'trusted-host' },
  ): () => Promise<void>
}

export interface HostConnectionHandle {
  requestRejection?(request: { headers: Record<string, string | string[] | undefined> }): number | undefined
  rpc: HostConnectionRpc
}

export interface HostAuthorizationControl {
  setAgentBackends?(config: ResolvedConfig): Promise<void>
  setTerminalEnabled?(enabled: boolean): void
  setLoopbackPorts?(ports: readonly number[]): void
  hostStatus(): {
    deviceId?: string
    configured: boolean
    online: boolean
    reconnecting: boolean
    lastActiveAt?: number
    error?: string
    account?: string
    authorized: boolean
    accountRequired: boolean
    connectedClients?: Array<{
      deviceId: string
      name: string
      platform?: string
      mode?: 'LAN' | 'P2P' | 'TURN' | 'Relay'
    }>
  }
  hasStoredAuthorization?(): Promise<boolean>
  reconnectHost(): void
  clearHostAuthorization(): Promise<void>
  localHarnessVersion?(): string | undefined
  authorizeHostAsOwned(accessToken: string, account?: string): Promise<unknown>
  authorizeHostWithAccount(email: string, password: string): Promise<unknown>
  authorizeHostWithCode(code: string): Promise<unknown>
  codexStatus?(): { available: boolean }
  codexCall?(input: unknown, signal?: AbortSignal): Promise<unknown>
  codexRespond?(input: unknown, signal?: AbortSignal): Promise<{ resolved: true }>
  codexOpenStream?(
    input: unknown,
    publish: (event: 'codex.app.frame' | 'codex.app.stream.closed', data: CodexAppFrameData | CodexAppStreamClosedData) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<unknown>
  codexCloseStream?(input: unknown): Promise<unknown>
}

export class ClientModeError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) { super(message) }
}

export function assertAuthorizedHost(listed: ServerHostDevice, descriptor: AuthorizedPeerDevice): void {
  if (descriptor.role !== 'host' || descriptor.deviceId !== listed.deviceId
    || descriptor.membershipId !== listed.membershipId) {
    throw new ClientModeError('PEER_IDENTITY_MISMATCH', 'Server Host details do not match the authorized device list.')
  }
}

export function websocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws/v1/connect`
  return url.toString()
}

export function webrtcDiagnosticsLogFields(diagnostics: RtcConnectionDiagnostics | undefined): Record<string, unknown> {
  if (diagnostics === undefined) return {}
  return {
    rtcConnectionState: diagnostics.connectionState,
    rtcIceConnectionState: diagnostics.iceConnectionState,
    rtcIceGatheringState: diagnostics.iceGatheringState,
    rtcLocalCandidates: diagnostics.localCandidates,
    rtcRemoteCandidates: diagnostics.remoteCandidates,
    rtcCandidatePairs: diagnostics.candidatePairs,
    rtcFilteredLocalCandidates: diagnostics.filteredLocalCandidates,
    rtcFilteredCandidatePairs: diagnostics.filteredCandidatePairs,
    ...(diagnostics.selectedPath === undefined ? {} : { rtcSelectedPath: diagnostics.selectedPath }),
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ClientModeError('INVALID_MESSAGE', 'The control request payload is invalid.')
  }
  return value as Record<string, unknown>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function ok(value: unknown): ControlResult<unknown> { return { ok: true, value } }

export function fail(error: unknown): ControlResult<unknown> {
  const source = error instanceof Error ? error : undefined
  const remoteCode = source !== undefined && 'code' in source && typeof source.code === 'string'
    ? source.code
    : source instanceof ClientModeError ? source.code : undefined
  const retryable = source !== undefined && 'retryable' in source && typeof source.retryable === 'boolean'
    ? source.retryable
    : source instanceof ClientModeError ? source.retryable : false
  return {
    ok: false,
    error: {
      code: 'internal',
      message: source?.message ?? 'The remote-mode operation failed.',
      details: remoteCode === undefined ? {} : { remoteCode, retryable },
    },
  }
}

export function shortId(value: string): string { return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}` }

export async function waitForCodexFrames(stream: CodexLoopbackStream, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new ClientModeError('RPC_ABORTED', 'The Codex event poll was cancelled.')
  await new Promise<void>((resolve, reject) => {
    const previousWake = stream.wake
    const timer = setTimeout(done, 25_000)
    const onAbort = () => {
      cleanup()
      reject(new ClientModeError('RPC_ABORTED', 'The Codex event poll was cancelled.'))
    }
    function cleanup() {
      clearTimeout(timer)
      stream.wake = previousWake
      signal?.removeEventListener('abort', onAbort)
    }
    function done() {
      cleanup()
      resolve()
    }
    stream.wake = () => {
      previousWake()
      done()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function diagnosticReason(error: Error): string {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  const message = error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 240)
  return code === undefined ? message : `${code}: ${message}`
}

export function preferredTransportsForAttempt(attempt: TransportAttempt): Array<'lan' | 'p2p' | 'turn' | 'relay'> {
  if (attempt === 'direct') return ['lan', 'p2p', 'relay']
  if (attempt === 'turn') return ['turn', 'relay']
  return ['relay']
}

export function transportPreferenceForMode(
  mode: 'LAN' | 'P2P' | 'TURN' | 'Relay' | 'Disconnected',
): 'lan' | 'p2p' | 'turn' | 'relay' | undefined {
  if (mode === 'LAN') return 'lan'
  if (mode === 'P2P') return 'p2p'
  if (mode === 'TURN') return 'turn'
  if (mode === 'Relay') return 'relay'
  return undefined
}

export function iceServersForAttempt(attempt: TransportAttempt, iceServers: RtcIceServer[]): RtcIceServer[] {
  return attempt === 'direct' ? stunOnlyIceServers(iceServers) : iceServers
}
