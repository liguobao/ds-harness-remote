import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Buffer } from 'node:buffer'
import type { SafeLogger } from '../logging.js'
import { PLUGIN_VERSION } from '../version.js'

const ACP_REQUEST_TIMEOUT_MS = 60_000
const ACP_START_TIMEOUT_MS = 20_000
const MAX_ACP_LINE_BYTES = 288 * 1024 * 1024
const MAX_STDERR_CAPTURE_BYTES = 4 * 1024

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface CursorAcpNotification {
  kind: 'notification'
  method: string
  params: unknown
}

export interface CursorAcpRequest {
  kind: 'request'
  id: string | number
  method: string
  params: unknown
}

export type CursorAcpInbound = CursorAcpNotification | CursorAcpRequest
export type CursorAcpInboundHandler = (message: CursorAcpInbound) => void
export type CursorAcpUnavailableHandler = (code: string) => void
export type SpawnCursorAcp = (binary: string) => ChildProcessWithoutNullStreams

export interface CursorAcpLike {
  start(): Promise<void>
  isReady(): boolean
  call(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  respond(id: string | number, result: unknown): Promise<void>
  respondError(id: string | number, code: number, message: string): Promise<void>
  onInbound(handler: CursorAcpInboundHandler): () => void
  onUnavailable(handler: CursorAcpUnavailableHandler): () => void
  close(): Promise<void>
}

export class CursorAcpError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CursorAcpError'
  }
}

/**
 * Host-local stdio client for one Cursor CLI ACP process (`agent acp`).
 * Authorization and method policy live in the surrounding Cursor domain.
 */
export class CursorAcpClient implements CursorAcpLike {
  private process?: ChildProcessWithoutNullStreams
  private nextId = 1
  private readonly pending = new Map<string | number, PendingRequest>()
  private readonly inboundHandlers = new Set<CursorAcpInboundHandler>()
  private readonly unavailableHandlers = new Set<CursorAcpUnavailableHandler>()
  private stdoutBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private stderrBytes = 0
  private ready = false
  private closed = false
  private failureNotified = false
  private startPromise?: Promise<void>

  constructor(
    private readonly binary: string,
    private readonly logger?: SafeLogger,
    private readonly spawnAcp: SpawnCursorAcp = binary => spawn(binary, ['acp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    }),
  ) {}

  start(): Promise<void> {
    if (this.closed) return Promise.reject(new CursorAcpError('CURSOR_CLOSED', 'The Cursor domain is closed.'))
    if (this.ready) return Promise.resolve()
    this.startPromise ??= this.startOnce().finally(() => { this.startPromise = undefined })
    return this.startPromise
  }

  isReady(): boolean { return this.ready }

  async call(method: string, params: unknown, timeoutMs = ACP_REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (!this.ready) throw new CursorAcpError('CURSOR_UNAVAILABLE', 'Cursor ACP is not ready.')
    return this.request(method, params, timeoutMs)
  }

  async respond(id: string | number, result: unknown): Promise<void> {
    this.write({ jsonrpc: '2.0', id, result })
  }

  async respondError(id: string | number, code: number, message: string): Promise<void> {
    this.write({ jsonrpc: '2.0', id, error: { code, message } })
  }

  onInbound(handler: CursorAcpInboundHandler): () => void {
    this.inboundHandlers.add(handler)
    return () => this.inboundHandlers.delete(handler)
  }

  onUnavailable(handler: CursorAcpUnavailableHandler): () => void {
    this.unavailableHandlers.add(handler)
    return () => this.unavailableHandlers.delete(handler)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.ready = false
    this.failPending(new CursorAcpError('CURSOR_CLOSED', 'Cursor ACP was closed.'))
    const child = this.process
    this.process = undefined
    if (child === undefined || child.exitCode !== null || child.killed) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 2_000)
      timer.unref?.()
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }

  private async startOnce(): Promise<void> {
    if (this.process !== undefined) {
      throw new CursorAcpError('CURSOR_STARTING', 'Cursor ACP is already starting.')
    }
    const child = this.spawnAcp(this.binary)
    this.process = child
    this.failureNotified = false
    this.stdoutBuffer = Buffer.alloc(0)
    this.stderrBytes = 0
    child.stdout.on('data', chunk => this.consumeStdout(Buffer.from(chunk as Uint8Array)))
    child.stderr.on('data', chunk => {
      this.stderrBytes = Math.min(MAX_STDERR_CAPTURE_BYTES, this.stderrBytes + Buffer.byteLength(chunk))
    })
    child.on('error', error => this.handleProcessFailure('CURSOR_BINARY_UNAVAILABLE', error))
    child.on('exit', (code, signal) => {
      if (this.process !== child) return
      this.process = undefined
      this.ready = false
      this.failPending(new CursorAcpError('CURSOR_ACP_EXITED', 'Cursor ACP exited unexpectedly.'))
      if (!this.closed) {
        this.logger?.warn('Cursor ACP exited', {
          code: code ?? 'none',
          signal: signal ?? 'none',
          stderrBytes: this.stderrBytes,
        })
        this.notifyUnavailable('CURSOR_ACP_EXITED')
      }
    })

    try {
      await this.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: 'deepseek_harness_remote',
          version: PLUGIN_VERSION,
        },
      }, ACP_START_TIMEOUT_MS)
      await this.request('authenticate', { methodId: 'cursor_login' }, ACP_START_TIMEOUT_MS)
      this.ready = true
      this.logger?.info('Cursor ACP ready')
    } catch (error) {
      child.kill('SIGTERM')
      if (error instanceof CursorAcpError) throw error
      throw new CursorAcpError('CURSOR_INITIALIZE_FAILED', 'Cursor ACP initialization failed.', { cause: error })
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CursorAcpError('CURSOR_REQUEST_TIMEOUT', 'Cursor ACP request timed out.'))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
    })
    try {
      this.write({ jsonrpc: '2.0', id, method, params })
    } catch (error) {
      const pending = this.takePending(id)
      pending?.reject(error instanceof Error ? error : new Error('Cursor ACP write failed.'))
    }
    return result
  }

  private write(message: unknown): void {
    const child = this.process
    if (child === undefined || child.stdin.destroyed || !child.stdin.writable) {
      throw new CursorAcpError('CURSOR_UNAVAILABLE', 'Cursor ACP is not available.')
    }
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private consumeStdout(chunk: Buffer): void {
    this.stdoutBuffer = this.stdoutBuffer.length === 0 ? chunk : Buffer.concat([this.stdoutBuffer, chunk])
    if (this.stdoutBuffer.length > MAX_ACP_LINE_BYTES) {
      this.handleProcessFailure(
        'CURSOR_RESPONSE_TOO_LARGE',
        new Error('Cursor ACP emitted an oversized JSONL message.'),
      )
      return
    }
    let newline = this.stdoutBuffer.indexOf(0x0a)
    while (newline >= 0) {
      const line = this.stdoutBuffer.subarray(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1)
      if (line.length > 0) this.handleLine(line)
      newline = this.stdoutBuffer.indexOf(0x0a)
    }
  }

  private handleLine(line: Buffer): void {
    let value: unknown
    try {
      value = JSON.parse(line.toString('utf8'))
    } catch {
      this.handleProcessFailure('CURSOR_INVALID_RESPONSE', new Error('Cursor ACP emitted invalid JSON.'))
      return
    }
    if (!isRecord(value)) {
      this.handleProcessFailure('CURSOR_INVALID_RESPONSE', new Error('Cursor ACP emitted an invalid message.'))
      return
    }
    if ((typeof value.id === 'number' || typeof value.id === 'string') && ('result' in value || 'error' in value)) {
      const pending = this.takePending(value.id)
      if (pending === undefined) return
      if ('error' in value && value.error !== undefined) {
        pending.reject(new CursorAcpError('CURSOR_UPSTREAM_ERROR', safeUpstreamError(value.error)))
      } else {
        pending.resolve(value.result)
      }
      return
    }
    if (typeof value.method !== 'string' || value.method.length === 0 || value.method.length > 160) return
    const params = value.params ?? {}
    const inbound: CursorAcpInbound = typeof value.id === 'string' || typeof value.id === 'number'
      ? { kind: 'request', id: value.id, method: value.method, params }
      : { kind: 'notification', method: value.method, params }
    for (const handler of this.inboundHandlers) handler(inbound)
  }

  private handleProcessFailure(code: string, cause: Error): void {
    this.ready = false
    this.failPending(new CursorAcpError(code, 'Cursor ACP communication failed.', { cause }))
    const child = this.process
    this.process = undefined
    child?.kill('SIGTERM')
    this.logger?.warn('Cursor ACP communication failed', { code })
    if (!this.closed) this.notifyUnavailable(code)
  }

  private notifyUnavailable(code: string): void {
    if (this.failureNotified) return
    this.failureNotified = true
    for (const handler of this.unavailableHandlers) handler(code)
  }

  private takePending(id: string | number): PendingRequest | undefined {
    const pending = this.pending.get(id)
    if (pending === undefined) return undefined
    this.pending.delete(id)
    clearTimeout(pending.timer)
    return pending
  }

  private failPending(error: Error): void {
    for (const id of [...this.pending.keys()]) this.takePending(id)?.reject(error)
  }
}

function safeUpstreamError(value: unknown): string {
  if (!isRecord(value) || typeof value.message !== 'string') return 'Cursor ACP rejected the request.'
  const message = value.message.toLowerCase()
  if (message.includes('auth') || message.includes('login') || message.includes('api key')) {
    return 'Cursor ACP authentication failed.'
  }
  if (message.includes('not initialized')) return 'Cursor ACP is not initialized.'
  return 'Cursor ACP rejected the request.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
