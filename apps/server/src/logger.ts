/**
 * Structured, single-line JSON logging with defensive redaction.
 *
 * Two invariants hold for everything in this module:
 *  1. Secrets never reach the sink: credential-looking keys, URL query
 *     parameters, JSON string fields and Bearer/Basic headers are redacted at
 *     any nesting depth.
 *  2. Logging never throws. A hostile `meta` object (throwing getter, proxy,
 *     BigInt, circular graph, throwing `toJSON`) must not be able to break a
 *     request or a WebSocket frame handler.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
}

/** Normalized (lowercase, separators stripped) key suffixes treated as secret. */
export const SENSITIVE_KEYS: readonly string[] = [
  'accesstoken',
  'refreshtoken',
  'token',
  'password',
  'passwd',
  'secret',
  'sdp',
  'ciphertext',
  'authorization',
  'cookie',
  'apikey',
]

export function isSensitiveKey(key: string): boolean {
  if (typeof key !== 'string' || key === '') return false
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '')
  return SENSITIVE_KEYS.some(sensitive => normalized === sensitive || normalized.endsWith(sensitive))
}

const REDACTED = '[REDACTED]'
const CIRCULAR = '[CIRCULAR]'
const DEPTH_LIMIT = '[DEPTH_LIMIT]'
const UNSERIALIZABLE = '[UNSERIALIZABLE]'
const MAX_DEPTH = 8

// Key vocabulary shared by every string pattern below: snake_case, kebab-case
// and camelCase spellings all match, while substrings of longer identifiers
// ("tokens", "mytokenizer") do not.
const KEY_VOCABULARY = 'access[_-]?token|refresh[_-]?token|token|password|passwd|secret|sdp|ciphertext|authorization|cookie|api[_-]?key'
const KEY_START = '(?<![A-Za-z0-9])'
const KEY_END = '(?![A-Za-z0-9])'

// Value fragments are real regex literals composed through `.source`, so no
// pattern depends on string-escape doubling. \x5C is a literal backslash,
// which keeps the JSON-escape handling explicit and readable.
const JSON_VALUE = /"(?:[^"\x5C]|\x5C.)*"/
const SINGLE_QUOTED_VALUE = /'(?:[^'\x5C]|\x5C.)*'/
const BARE_VALUE = /[^\s,;&}"']+/
const URL_VALUE = /[^&#\s"']*/
const JSON_KEY_SEPARATOR = /\s*:\s*/
const KEY_VALUE_SEPARATOR = /\s*[=:]\s*/

/** `?access_token=...` or `&token=...` in URLs. */
const URL_PARAM = new RegExp(`([?&](?:${KEY_VOCABULARY})=)${URL_VALUE.source}`, 'gi')
/** `"sdp":"..."` inside an already-serialized JSON document. */
const JSON_FIELD = new RegExp(`("(?:${KEY_VOCABULARY})")(${JSON_KEY_SEPARATOR.source})(${JSON_VALUE.source})`, 'gi')
/** `token=...`, `token: ...`, `password: "..."` in free text. */
const KEY_VALUE = new RegExp(
  `(${KEY_START}(?:${KEY_VOCABULARY})${KEY_END})(${KEY_VALUE_SEPARATOR.source})(${JSON_VALUE.source}|${SINGLE_QUOTED_VALUE.source}|${BARE_VALUE.source})`,
  'gi',
)
const BEARER = /(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi
const BASIC = /(basic\s+)[A-Za-z0-9+/=]+/gi

function redactString(value: string): string {
  return value
    .replace(URL_PARAM, `$1${REDACTED}`)
    .replace(JSON_FIELD, `$1$2"${REDACTED}"`)
    // Scheme prefixes run before the generic `key: value` rule, otherwise a
    // bare `Authorization: Bearer abc` would only redact the scheme word.
    .replace(BEARER, `$1${REDACTED}`)
    .replace(BASIC, `$1${REDACTED}`)
    .replace(KEY_VALUE, `$1$2${REDACTED}`)
}

function readSafely<T>(read: () => T, fallback: T): T {
  try {
    const value = read()
    return value === undefined || value === null ? fallback : value
  } catch {
    return fallback
  }
}

/**
 * Deep-copy `data` with secrets replaced. Never throws: unserializable input
 * degrades to the `[UNSERIALIZABLE]` marker instead of propagating.
 */
export function redactSensitive(data: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  try {
    if (data === null || data === undefined) return data
    switch (typeof data) {
      case 'string':
        return redactString(data)
      case 'number':
        return Number.isFinite(data) ? data : String(data)
      case 'boolean':
        return data
      case 'bigint':
        return data.toString()
      case 'symbol':
        return data.toString()
      case 'function':
        return '[FUNCTION]'
      default:
        break
    }
    if (depth >= MAX_DEPTH) return DEPTH_LIMIT
    const object = data as object
    if (seen.has(object)) return CIRCULAR
    seen.add(object)

    if (Array.isArray(object)) {
      return object.map(item => redactSensitive(item, seen, depth + 1))
    }

    if (object instanceof Error) {
      const name = readSafely(() => (typeof object.name === 'string' ? object.name : 'Error'), 'Error')
      const message = readSafely(() => redactString(typeof object.message === 'string' ? object.message : ''), '')
      const stack = readSafely(() => (typeof object.stack === 'string' ? redactString(object.stack) : undefined), undefined)
      return { name, message, ...(stack ? { stack } : {}) }
    }

    const result: Record<string, unknown> = {}
    // Enumerate keys first (no getter runs), then read each value through a
    // guard: a throwing getter degrades that one field instead of the entry.
    for (const key of Object.keys(object)) {
      if (isSensitiveKey(key)) {
        // Never touch the value of a secret field, not even to copy it.
        result[key] = REDACTED
        continue
      }
      const value = readSafely(() => (object as Record<string, unknown>)[key], UNSERIALIZABLE)
      result[key] = redactSensitive(value, seen, depth + 1)
    }
    return result
  } catch {
    return UNSERIALIZABLE
  }
}

export interface LogEntry {
  ts: string
  level: LogLevel
  scope: string
  event: string
  meta: Record<string, unknown>
}

export type LogSink = (line: string, entry: LogEntry) => void

const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/

/** Event names and scopes are controlled constants; reject anything else. */
function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80 || !LABEL_PATTERN.test(value)) return fallback
  return value
}

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOG_LEVEL_SEVERITY, value)
}

function severityOf(level: string): number {
  return isLogLevel(level) ? LOG_LEVEL_SEVERITY[level] : LOG_LEVEL_SEVERITY.info
}

export class Logger {
  readonly scope: string
  readonly level: LogLevel
  private readonly sink?: LogSink

  constructor(scope: string = 'server', level: LogLevel = 'info', sink?: LogSink) {
    this.scope = safeLabel(scope, 'server')
    this.level = isLogLevel(level) ? level : 'info'
    this.sink = sink
  }

  child(subScope: string): Logger {
    return new Logger(`${this.scope}:${safeLabel(subScope, 'child')}`, this.level, this.sink)
  }

  debug(event: string, meta?: Record<string, unknown>): void {
    this.log('debug', event, meta)
  }

  info(event: string, meta?: Record<string, unknown>): void {
    this.log('info', event, meta)
  }

  warn(event: string, meta?: Record<string, unknown>): void {
    this.log('warn', event, meta)
  }

  error(event: string, meta?: Record<string, unknown>): void {
    this.log('error', event, meta)
  }

  private buildEntry(level: LogLevel, event: unknown, meta: unknown): LogEntry {
    const ts = new Date().toISOString()
    let cleanMeta: Record<string, unknown> = {}
    try {
      const redacted = meta === undefined ? {} : redactSensitive(meta)
      cleanMeta = redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)
        ? redacted as Record<string, unknown>
        : { value: redacted }
    } catch {
      cleanMeta = { redactionFailed: true }
    }
    return { ts, level, scope: this.scope, event: safeLabel(event, 'invalid_event'), meta: cleanMeta }
  }

  private log(level: LogLevel, event: unknown, meta?: unknown): void {
    try {
      if (severityOf(level) < severityOf(this.level)) return
      const entry = this.buildEntry(level, event, meta)
      let line = ''
      try {
        const serialized = JSON.stringify(entry)
        if (typeof serialized !== 'string') throw new TypeError('log entry is not serializable')
        line = serialized
      } catch {
        // Fixed, self-describing shape: no attacker-controlled content at all.
        line = JSON.stringify({
          ts: new Date().toISOString(), level, scope: this.scope,
          event: safeLabel(event, 'invalid_event'), meta: { serializationFailed: true },
        })
      }
      if (this.sink) {
        try { this.sink(line, entry) } catch { /* a broken sink must not break the caller */ }
        return
      }
      if (level === 'error') console.error(line)
      else if (level === 'warn') console.warn(line)
      else console.info(line)
    } catch {
      // Logging is best-effort: it must never alter control flow.
    }
  }
}

export function parseLogLevel(val: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  const effectiveFallback = isLogLevel(fallback) ? fallback : 'info'
  if (typeof val !== 'string' || val.trim() === '') return effectiveFallback
  const normalized = val.trim().toLowerCase()
  // hasOwnProperty guards against prototype members ('constructor', '__proto__',
  // 'toString') being accepted as log levels.
  if (Object.prototype.hasOwnProperty.call(LOG_LEVEL_SEVERITY, normalized)) return normalized as LogLevel
  console.warn(`[config] Invalid DSH_SERVER_LOG_LEVEL. Must be one of ${Object.keys(LOG_LEVEL_SEVERITY).join(', ')}. Falling back to ${effectiveFallback}.`)
  return effectiveFallback
}
