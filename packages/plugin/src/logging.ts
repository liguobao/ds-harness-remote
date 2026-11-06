export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogSink {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

const levels: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']
const secretKey = /authorization|cookie|token|secret|private|shared|ciphertext|payload|prompt|source|workspace|output|registrationCode|deviceCode/i

export class SafeLogger {
  constructor(private readonly sink: LogSink, private readonly threshold: LogLevel = 'info') {}

  debug(message: string, fields?: Record<string, unknown>): void { this.write('debug', message, fields) }
  info(message: string, fields?: Record<string, unknown>): void { this.write('info', message, fields) }
  warn(message: string, fields?: Record<string, unknown>): void { this.write('warn', message, fields) }
  error(message: string, fields?: Record<string, unknown>): void { this.write('error', message, fields) }

  private write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (levels.indexOf(level) < levels.indexOf(this.threshold)) return
    const safeFields = fields === undefined ? '' : ` ${JSON.stringify(redact(fields))}`
    this.sink[level](`[ds-harness-remote] ${message}${safeFields}`)
  }
}

function redact(value: unknown, key = ''): unknown {
  if (secretKey.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map(item => redact(item))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]))
}
