import {
  attentionTokenSchema,
  type AttentionMode,
} from '@dsh-remote/protocol'

const MAX_PARAM_LENGTH = 256
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/u

export type ParsedAttentionDeepLink =
  | {
      kind: 'attention'
      hostId: string
      token?: string
      rawUrl: string
    }
  | {
      kind: 'conversation'
      hostId: string
      sessionId: string
      mode: AttentionMode
      rawUrl: string
    }

function sanitizeParam(value: string | null): string | undefined {
  if (value === null) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_PARAM_LENGTH || CONTROL_CHAR_PATTERN.test(trimmed)) {
    return undefined
  }
  return trimmed
}

/**
 * Parses and validates `dshremote://attention` and `dshremote://conversation` deep links.
 * Any untrusted scheme, unknown host target, malformed token, or unsupported mode fails closed.
 */
export function parseAttentionDeepLink(url: string): ParsedAttentionDeepLink | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048 || CONTROL_CHAR_PATTERN.test(url)) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol.toLowerCase() !== 'dshremote:') return null

  const target = parsed.hostname.toLowerCase()
  const hostId = sanitizeParam(parsed.searchParams.get('host'))
  if (hostId === undefined) return null

  if (target === 'attention') {
    const rawToken = parsed.searchParams.get('token')
    if (rawToken !== null && rawToken.length > 0) {
      const tokenResult = attentionTokenSchema.safeParse(rawToken)
      if (!tokenResult.success) return null
      return {
        kind: 'attention',
        hostId,
        token: tokenResult.data,
        rawUrl: url,
      }
    }
    return {
      kind: 'attention',
      hostId,
      rawUrl: url,
    }
  }

  if (target === 'conversation') {
    const sessionId = sanitizeParam(parsed.searchParams.get('session'))
    if (sessionId === undefined) return null
    const rawMode = parsed.searchParams.get('mode')
    let mode: AttentionMode = 'agent'
    if (rawMode !== null && rawMode.length > 0) {
      if (rawMode !== 'agent' && rawMode !== 'bot') return null
      mode = rawMode
    }
    return {
      kind: 'conversation',
      hostId,
      sessionId,
      mode,
      rawUrl: url,
    }
  }

  return null
}

export function buildAttentionDeepLinkUrl(hostId: string, token?: string): string {
  const params = [`host=${encodeURIComponent(hostId)}`]
  if (token !== undefined && attentionTokenSchema.safeParse(token).success) {
    params.push(`token=${encodeURIComponent(token)}`)
  }
  return `dshremote://attention?${params.join('&')}`
}

export function buildConversationDeepLinkUrl(
  hostId: string,
  sessionId: string,
  mode: AttentionMode = 'agent',
): string {
  const params = [
    `host=${encodeURIComponent(hostId)}`,
    `session=${encodeURIComponent(sessionId)}`,
    `mode=${mode === 'bot' ? 'bot' : 'agent'}`,
  ]
  return `dshremote://conversation?${params.join('&')}`
}

/**
 * Cold-start deep link buffer matching the single-slot PushClickBuffer pattern:
 * holds the latest incoming validated deep link until auth, device directory,
 * and navigation bootstrap are ready, while deduplicating identical URLs delivered
 * by both `getInitialURL` and the live `Linking` event listener.
 */
export class AttentionDeepLinkBuffer {
  private pending: ParsedAttentionDeepLink | undefined
  private lastAcceptedUrl: string | undefined

  enqueueUrl(url: string): ParsedAttentionDeepLink | null {
    const parsed = parseAttentionDeepLink(url)
    if (parsed === null) return null
    if (this.lastAcceptedUrl === url && this.pending?.rawUrl === url) {
      return null
    }
    this.lastAcceptedUrl = url
    this.pending = parsed
    return parsed
  }

  peek(): ParsedAttentionDeepLink | undefined {
    return this.pending
  }

  take(): ParsedAttentionDeepLink | undefined {
    const current = this.pending
    this.pending = undefined
    return current
  }

  clear(): void {
    this.pending = undefined
    this.lastAcceptedUrl = undefined
  }
}
