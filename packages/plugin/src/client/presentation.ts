import type { LocaleKey, Translate } from '../client-locale.js'
import type { RemoteConnectionProgress, RemoteStatus, RemoteTransportPreference } from './types.js'

const defaultPreferredTransports: readonly RemoteTransportPreference[] = ['lan', 'p2p', 'turn', 'relay']

function normalizedPreferredTransports(value: readonly RemoteTransportPreference[] | undefined): RemoteTransportPreference[] {
  return value === undefined || value.length === 0 ? [...defaultPreferredTransports] : [...value]
}

export function formatLocalTime(value: number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

export function formatByteSize(value: number): string {
  if (value < 1024) return `${value.toLocaleString()} B`
  const units = ['KiB', 'MiB', 'GiB']
  let amount = value
  let unit = 'B'
  for (const nextUnit of units) {
    amount /= 1024
    unit = nextUnit
    if (amount < 1024) break
  }
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`
}

export function formatBitrate(value: number): string {
  const units = ['bit/s', 'Kbit/s', 'Mbit/s', 'Gbit/s']
  let amount = value
  let unitIndex = 0
  while (amount >= 1000 && unitIndex < units.length - 1) {
    amount /= 1000
    unitIndex += 1
  }
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unitIndex]}`
}

export function shortDeviceId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
}

function serverHostname(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

export function transportLabel(value: RemoteTransportPreference, t: Translate): string {
  if (value === 'lan') return t('remoteNetworkLan')
  if (value === 'p2p') return t('remoteNetworkP2p')
  if (value === 'turn') return t('remoteNetworkTurn')
  return t('remoteNetworkRelay')
}

export function transportDiagnosticLabel(value: RemoteTransportPreference): string {
  if (value === 'lan') return 'LAN'
  if (value === 'p2p') return 'P2P'
  if (value === 'turn') return 'TURN'
  return 'Relay'
}

function transportProgressCopy(value: RemoteTransportPreference): { label: LocaleKey; detail: LocaleKey } {
  if (value === 'lan') return { label: 'remoteProgressProbeLan', detail: 'remoteProgressProbeLanDetail' }
  if (value === 'p2p') return { label: 'remoteProgressProbeP2p', detail: 'remoteProgressProbeP2pDetail' }
  if (value === 'turn') return { label: 'remoteProgressProbeTurn', detail: 'remoteProgressProbeTurnDetail' }
  return { label: 'remoteProgressProbeRelay', detail: 'remoteProgressProbeRelayDetail' }
}

function statusTransportPreference(status: RemoteStatus | undefined): RemoteTransportPreference | undefined {
  if (status?.transport === 'LAN') return 'lan'
  if (status?.transport === 'P2P') return 'p2p'
  if (status?.transport === 'TURN') return 'turn'
  if (status?.transport === 'Relay') return 'relay'
  return undefined
}

export function connectedProgress(status: RemoteStatus | undefined): RemoteConnectionProgress | undefined {
  const activeTransport = statusTransportPreference(status)
  if (activeTransport === undefined) return undefined
  return {
    label: 'remoteProgressReady',
    detail: 'remoteProgressReadyDetail',
    percent: 100,
    transports: normalizedPreferredTransports(status?.preferredTransports),
    activeTransports: [activeTransport],
    routeVerb: 'using',
  }
}

function loadingProgressPercent(elapsedMs: number): number {
  if (elapsedMs >= 6_800) return 96
  if (elapsedMs >= 3_800) return 93
  if (elapsedMs >= 1_600) return 89
  return 84
}

export function observedConnectionProgress(
  status: RemoteStatus,
  targetDeviceId: string,
  preferredTransports: readonly RemoteTransportPreference[] | undefined,
  connectedStep: Pick<RemoteConnectionProgress, 'label' | 'detail'>,
  connectedAt: number | undefined,
): RemoteConnectionProgress | undefined {
  const transports = normalizedPreferredTransports(status.preferredTransports ?? preferredTransports)
  const connection = status.connectionProgress
  if (connection?.targetDeviceId === targetDeviceId) {
    if (connection.phase === 'checking-host') {
      return { label: 'remoteProgressCheckingHost', detail: 'remoteProgressCheckingHostDetail', percent: 12 }
    }
    if (connection.phase === 'authorizing-peer') {
      return { label: 'remoteProgressAuthorizingPeer', detail: 'remoteProgressAuthorizingPeerDetail', percent: 30 }
    }
    const activeTransports = connection.activeTransports?.filter(transport => transports.includes(transport)) ?? []
    if (connection.phase === 'probing') {
      const activeIndex = Math.max(0, ...activeTransports.map(transport => transports.indexOf(transport)))
      const copy = activeTransports.length === 1
        ? transportProgressCopy(activeTransports[0]!)
        : { label: 'remoteProgressOpeningChannel' as const, detail: 'remoteProgressOpeningChannelDetail' as const }
      return {
        ...copy,
        percent: Math.min(76, 42 + activeIndex * 10),
        transports,
        activeTransports,
        routeVerb: 'trying',
      }
    }
    return {
      ...connectedStep,
      percent: loadingProgressPercent(connectedAt === undefined ? 0 : Date.now() - connectedAt),
      transports,
      activeTransports,
      routeVerb: 'using',
    }
  }
  if (status.connectedTargetDeviceId !== targetDeviceId) return undefined
  const activeTransport = statusTransportPreference(status)
  return {
    ...connectedStep,
    percent: loadingProgressPercent(connectedAt === undefined ? 0 : Date.now() - connectedAt),
    transports,
    ...(activeTransport === undefined ? {} : { activeTransports: [activeTransport], routeVerb: 'using' as const }),
  }
}

export function connectionErrorMessage(code: string, t: Translate): string {
  if (code === 'ACCOUNT_AUTH_REQUIRED') return t('hostSignInHint')
  if (code === 'AUTH_REQUIRED') return t('hostSignInHint')
  if (code === 'AUTH_INVALID' || code === 'TOKEN_EXPIRED') {
    return t('connectionAuthorizationExpired')
  }
  if (code === 'CONNECTION_REPLACED') return t('connectionReplaced')
  if (code === 'SERVER_CREDENTIALS_BUSY') return t('connectionCredentialsBusy')
  if (code === 'DEVICE_REVOKED') return t('connectionDeviceRevoked')
  if (code === 'DEVICE_OWNERSHIP_REQUIRED') return t('connectionOwnershipRequired')
  if (code === 'RATE_LIMITED') return t('connectionRateLimited')
  if (code === 'UNSUPPORTED_VERSION') return t('connectionVersionMismatch')
  if (code === 'INVALID_MESSAGE') return t('connectionInvalidResponse')
  if (code === 'CONNECTION_FAILED') return t('serverUnavailableError')
  if (code === 'SERVER_NOT_CONFIGURED') return t('connectionReachability')
  return t('connectionUnexpected')
}

export function connectionStatusLabel(status: RemoteStatus['host'] | undefined, t: Translate): string {
  if (status === undefined) return t('checkingConnection')
  if (status.online) return t('online')
  if (status.error !== undefined) return connectionErrorMessage(status.error, t)
  if (!status.reconnecting) return t('offline')
  return t(status.lastActiveAt === undefined ? 'connecting' : 'serverUnavailableShort')
}

export function connectionStatusClass(status: RemoteStatus['host'] | undefined): string {
  if (status?.online) return ' isOnline'
  if (status?.reconnecting) return ' isReconnecting'
  return status === undefined ? '' : ' isOffline'
}

export function startupErrorMessage(error: { code: string; message: string }, t: Translate): string {
  if (error.code === 'IDENTITY_INVALID') return t('identityCorrupted')
  if (error.code === 'SERVER_CREDENTIALS_INVALID') return t('credentialsCorrupted')
  if (error.code === 'IDENTITY_LOCKED') return t('identityLocked')
  if (error.code === 'STORAGE_CONFLICT') return t('storageConflict')
  if (error.code === 'SERVER_CREDENTIALS_BUSY') return t('connectionCredentialsBusy')
  return error.message || t('remoteStartupFailed')
}

export function messageOf(reason: unknown, t: Translate): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && typeof reason.code === 'string') {
    if (reason.code === 'CONNECTION_FAILED') return t('serverUnavailableError')
    if (reason.code === 'IDENTITY_INVALID') return t('identityCorrupted')
    if (reason.code === 'SERVER_CREDENTIALS_INVALID') return t('credentialsCorrupted')
    if (reason.code === 'IDENTITY_LOCKED') return t('identityLocked')
    if (reason.code === 'STORAGE_CONFLICT') return t('storageConflict')
    if (reason.code === 'SERVER_CREDENTIALS_BUSY') return t('connectionCredentialsBusy')
  }
  return reason instanceof Error ? reason.message : String(reason)
}

export function formatPlatform(value: string): string {
  const normalized = value.toLowerCase()
  if (normalized === 'darwin' || normalized === 'macos') return 'macOS'
  if (normalized === 'win32' || normalized === 'windows') return 'Windows'
  if (normalized === 'linux') return 'Linux'
  if (normalized === 'android') return 'Android'
  return value
}

export function connectedClientModeLabel(
  mode: 'LAN' | 'P2P' | 'TURN' | 'Relay' | undefined,
  t: Translate,
): string {
  if (mode === 'LAN') return t('remoteNetworkLan')
  if (mode === 'P2P') return t('remoteNetworkP2p')
  if (mode === 'TURN') return t('remoteNetworkTurn')
  if (mode === 'Relay') return t('remoteNetworkRelay')
  return t('connected')
}
