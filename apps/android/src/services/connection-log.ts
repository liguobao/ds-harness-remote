/** Payload-free diagnostics for the current app process, bounded to 500 events. */
const entries: string[] = []
const limit = 500
const allowed = new Set(['attempt', 'forceRelay', 'phase', 'reason', 'closeCode', 'transport',
  'connectionState', 'iceConnectionState', 'localCandidates', 'remoteCandidates',
  'protocol', 'localCandidateType', 'remoteCandidateType', 'status', 'durationMs', 'method', 'request', 'stage', 'errorName',
  'listed', 'resolved', 'unpinned', 'keyMismatch', 'lookupFailed', 'missingTrusted'])
const safeWords = new Set(['auto', 'lan', 'p2p', 'turn', 'relay', 'starting', 'secure', 'ready', 'failed',
  'closed', 'new', 'connecting', 'connected', 'disconnected', 'checking', 'completed',
  'gathering', 'complete', 'host', 'srflx', 'prflx', 'GET', 'POST', 'PATCH', 'DELETE',
  'tcp', 'udp', 'reassembly', 'message-handler', 'control-closed', 'webrtc-closed', 'timeout', 'network', 'control-close', 'control-error', 'invalid-control-frame',
  'transport-close', 'data-channel-close', 'decrypt', 'decode', 'dispatch', 'unknown',
  'auth', 'devices', 'account', 'turn', 'other', 'authorization', 'handshake', 'unavailable', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'ZodError'])

// Never stringify arbitrary errors, URLs, server responses, SDP or business data.
function safeValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value
  if (typeof value === 'string') return safeWords.has(value) ? value : '[redacted]'
  if (depth < 2 && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => ['host', 'srflx', 'prflx', 'relay'].includes(key))
      .map(([key, child]) => [key, safeValue(child, depth + 1)]))
  }
  return '[redacted]'
}

type ConnectionLogListener = (line: string) => void
const listeners = new Set<ConnectionLogListener>()

/** Copy of the bounded in-process diagnostics buffer. */
export function connectionLogEntries(): readonly string[] {
  return [...entries]
}

/** Subscribe to new diagnostic lines; returns an unsubscribe function. */
export function subscribeConnectionLog(listener: ConnectionLogListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function connectionLog(
  event: 'connect' | 'handshake' | 'disconnect' | 'fallback' | 'selected-path' | 'stream-failed'
    | 'health-failed' | 'secure-send-failed' | 'secure-receive-failed' | 'http' | 'devices',
  fields: Record<string, unknown> = {},
): void {
  const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.has(key)).map(([key, value]) => [key, safeValue(value)]))
  const line = `${new Date().toISOString()} ${event} ${JSON.stringify(safe)}`
  entries.push(line)
  if (entries.length > limit) entries.splice(0, entries.length - limit)
  try { console.info(`[ds-harness-remote] ${line}`) } catch { /* Diagnostics must not break connections. */ }
  for (const listener of [...listeners]) {
    try { listener(line) } catch { /* Diagnostics must not break connections. */ }
  }
}

export function connectionLogText(version: string): string {
  return `DSH Remote connection diagnostics\nApp version: ${version.replace(/[^a-zA-Z0-9.+-]/g, '').slice(0, 80)}\nExported: ${new Date().toISOString()}\nCurrent app process; latest ${limit} events. Credentials and conversation content excluded.\n\n${entries.join('\n')}\n`
}

/** Categorize failure without retaining arbitrary messages from the network. */
export function connectionFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (/timed? ?out|timeout/.test(message)) return 'timeout'
  if (/unauthor|forbidden|credential|token|401|403/.test(message)) return 'authorization'
  if (/noise|handshake|identity|trust|key/.test(message)) return 'handshake'
  if (/unsupported|unavailable|no supported/.test(message)) return 'unavailable'
  return 'network'
}
