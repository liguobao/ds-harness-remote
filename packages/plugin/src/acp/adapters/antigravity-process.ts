import { type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import type { SafeLogger } from '../../logging.js'
import type {
  CursorAcpInbound,
  CursorAcpInboundHandler,
  CursorAcpLike,
  CursorAcpUnavailableHandler,
} from './cursor-process.js'

import { TranscriptWatcher } from './antigravity/transcript-watcher.js'
import { spawnAntigravityWithLocalCredentials } from './antigravity-local-auth.js'

const ACP_REQUEST_TIMEOUT_MS = 60_000
const ACP_PROMPT_TIMEOUT_MS = 10 * 60_000
const ACP_START_TIMEOUT_MS = 20_000
const MAX_STDERR_CAPTURE_BYTES = 4 * 1024

export type SpawnAntigravityAcp = (binary: string, args: string[]) => ChildProcessWithoutNullStreams

export class AntigravityAcpError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AntigravityAcpError'
  }
}

export function resolveAntigravityBinary(preferred?: string): string {
  if (preferred && preferred.trim() !== '' && preferred !== 'agent' && preferred !== 'cursor') {
    return preferred.trim()
  }
  const defaultLocal = '/var/lib/dsh/.local/bin/agy'
  if (existsSync(defaultLocal)) {
    return defaultLocal
  }
  return 'agy'
}

export interface AntigravityAcpClientOptions {
  skipPermissions?: boolean
  conversationId?: string
}

/**
 * Host-local stdio client for Google Antigravity CLI (`agy --input-format stream-json --output-format stream-json`).
 * Maps Antigravity's stream-json NDJSON events to the standard Agent ACP gateway protocol.
 */
export class AntigravityAcpClient implements CursorAcpLike {
  private process?: ChildProcessWithoutNullStreams
  private readonly inboundHandlers = new Set<CursorAcpInboundHandler>()
  private readonly unavailableHandlers = new Set<CursorAcpUnavailableHandler>()
  private watcher?: TranscriptWatcher
  private stdoutBuffer: Buffer = Buffer.alloc(0)
  private stderrBytes = 0
  private ready = false
  private closed = false
  private startPromise?: Promise<void>
  private activeConversationId?: string
  private readonly skipPermissions: boolean
  private currentPromptPending?: {
    sessionId: string
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }

  constructor(
    private readonly binary: string = 'agy',
    private readonly logger?: SafeLogger,
    private readonly spawnAcp: SpawnAntigravityAcp = (bin, args) => spawnAntigravityWithLocalCredentials(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    }),
    options: AntigravityAcpClientOptions = {},
  ) {
    this.skipPermissions = options.skipPermissions === true
    this.activeConversationId = options.conversationId
  }

  start(): Promise<void> {
    if (this.closed) return Promise.reject(new AntigravityAcpError('ANTIGRAVITY_CLOSED', 'The Antigravity domain is closed.'))
    if (this.ready) return Promise.resolve()
    this.startPromise ??= this.startOnce().finally(() => { this.startPromise = undefined })
    return this.startPromise
  }

  isReady(): boolean { return this.ready }

  async call(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    if (!this.ready) throw new AntigravityAcpError('ANTIGRAVITY_UNAVAILABLE', 'Antigravity ACP is not ready.')

    if (method === 'initialize') {
      return {
        protocolVersion: 1,
        capabilities: {
          loadSession: true,
          promptTypes: ['text'],
        },
        agentInfo: {
          name: 'antigravity',
          version: '1.2.16',
        },
        backend: 'antigravity',
      }
    }

    if (method === 'session/new') {
      const sessionId = this.activeConversationId || `sess_${Date.now()}`
      return { sessionId }
    }

    if (method === 'session/load') {
      const sessionId = (params as Record<string, unknown>)?.sessionId ?? this.activeConversationId ?? `sess_${Date.now()}`
      return { sessionId }
    }

    if (method === 'session/cancel') {
      if (this.currentPromptPending) {
        clearTimeout(this.currentPromptPending.timer)
        const pending = this.currentPromptPending
        this.currentPromptPending = undefined
        pending.resolve({ stopReason: 'cancelled' })
      }
      return { cancelled: true }
    }

    if (method === 'session/prompt') {
      const p = params as { sessionId: string; prompt: Array<{ type: string; text: string }> }
      const promptText = Array.isArray(p.prompt) ? p.prompt.map(item => item.text).join('\n') : String(params)
      return this.sendPrompt(p.sessionId, promptText, timeoutMs ?? ACP_PROMPT_TIMEOUT_MS)
    }

    throw new AntigravityAcpError('METHOD_NOT_SUPPORTED', `Method ${method} is not supported by Antigravity ACP adapter.`)
  }

  async respond(_id: string | number, _result: unknown): Promise<void> {
    // Currently auto-approved or handled via session permissions
  }

  async respondError(_id: string | number, _code: number, _message: string): Promise<void> {
    // Currently auto-approved or handled via session permissions
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
    if (this.watcher) {
      this.watcher.stop()
      this.watcher = undefined
    }
    if (this.currentPromptPending) {
      clearTimeout(this.currentPromptPending.timer)
      this.currentPromptPending.reject(new AntigravityAcpError('ANTIGRAVITY_CLOSED', 'Antigravity ACP was closed.'))
      this.currentPromptPending = undefined
    }
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
      throw new AntigravityAcpError('ANTIGRAVITY_STARTING', 'Antigravity ACP is already starting.')
    }
    const bin = resolveAntigravityBinary(this.binary)
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json']
    if (this.activeConversationId) {
      args.push('--conversation', this.activeConversationId)
    }
    if (this.skipPermissions) {
      args.push('--dangerously-skip-permissions')
    }
    const child = this.spawnAcp(bin, args)
    this.process = child
    this.stdoutBuffer = Buffer.alloc(0)
    this.stderrBytes = 0

    let initResolved = false
    let rejectInit: ((error: Error) => void) | undefined
    const initPromise = new Promise<void>((resolve, reject) => {
      rejectInit = reject
      const timer = setTimeout(() => {
        if (!initResolved) {
          reject(new AntigravityAcpError('ANTIGRAVITY_INIT_TIMEOUT', 'Timed out waiting for Antigravity init event.'))
        }
      }, ACP_START_TIMEOUT_MS)
      timer.unref?.()

      const checkInit = (chunk: Buffer) => {
        this.consumeStdout(chunk, (event) => {
          if (event.event === 'init') {
            initResolved = true
            clearTimeout(timer)
            const conversationId = (event as Record<string, unknown>).conversation_id
            if (typeof conversationId === 'string') {
              this.activeConversationId = conversationId
              this.watcher = new TranscriptWatcher(conversationId)
              this.watcher.start()
            }
            resolve()
          }
        })
      }

      child.stdout.on('data', chunk => {
        if (!initResolved) {
          checkInit(Buffer.from(chunk as Uint8Array))
        } else {
          this.consumeStdout(Buffer.from(chunk as Uint8Array))
        }
      })
    })

    child.stderr.on('data', chunk => {
      this.stderrBytes = Math.min(MAX_STDERR_CAPTURE_BYTES, this.stderrBytes + Buffer.byteLength(chunk))
    })

    child.on('error', error => {
      this.ready = false
      if (!initResolved) {
        rejectInit?.(new AntigravityAcpError('ANTIGRAVITY_BINARY_UNAVAILABLE', 'Failed to start the Antigravity CLI.', { cause: error }))
      }
      if (!this.closed) {
        this.logger?.warn('Antigravity binary error', { message: error.message })
        this.notifyUnavailable('ANTIGRAVITY_BINARY_UNAVAILABLE')
      }
    })

    child.on('exit', (code, signal) => {
      if (this.process !== child) return
      this.process = undefined
      this.ready = false
      if (!initResolved) {
        rejectInit?.(new AntigravityAcpError('ANTIGRAVITY_EXITED', 'Antigravity exited before initialization.'))
      }
      if (this.currentPromptPending) {
        clearTimeout(this.currentPromptPending.timer)
        this.currentPromptPending.reject(new AntigravityAcpError('ANTIGRAVITY_EXITED', 'Antigravity exited unexpectedly.'))
        this.currentPromptPending = undefined
      }
      if (!this.closed) {
        this.logger?.warn('Antigravity process exited', { code: code ?? 'none', signal: signal ?? 'none' })
        this.notifyUnavailable('ANTIGRAVITY_EXITED')
      }
    })

    try {
      await initPromise
      this.ready = true
      this.logger?.info('Antigravity ACP ready', { conversationId: this.activeConversationId })
    } catch (err) {
      child.kill('SIGTERM')
      throw err
    }
  }

  private sendPrompt(sessionId: string, promptText: string, timeoutMs: number): Promise<unknown> {
    if (this.currentPromptPending) {
      throw new AntigravityAcpError('PROMPT_IN_PROGRESS', 'Another prompt is already in progress.')
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.currentPromptPending) {
          this.currentPromptPending = undefined
          reject(new AntigravityAcpError('ANTIGRAVITY_REQUEST_TIMEOUT', 'Antigravity turn timed out.'))
        }
      }, timeoutMs)
      timer.unref?.()

      this.currentPromptPending = { sessionId, resolve, reject, timer }

      const payload = {
        event: 'user',
        message: { content: promptText },
      }
      const data = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8')
      this.process?.stdin.write(data)
    })
  }

  private consumeStdout(chunk: Buffer, onRawEvent?: (event: Record<string, unknown>) => void): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf(0x0a)
      if (newlineIndex === -1) break

      const line = this.stdoutBuffer.subarray(0, newlineIndex).toString('utf8').trim()
      this.stdoutBuffer = this.stdoutBuffer.subarray(newlineIndex + 1)
      if (line === '') continue

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (onRawEvent) {
          onRawEvent(parsed)
        }
        this.handleAgyEvent(parsed)
      } catch (err) {
        this.logger?.debug('Failed to parse agy stdout line', { line, error: String(err) })
      }
    }
  }

  private handleAgyEvent(event: Record<string, unknown>): void {
    const eventName = event.event
    const current = this.currentPromptPending
    const sessionId = current?.sessionId ?? this.activeConversationId ?? 'default'

    if (eventName === 'step_update' && typeof event.step_update === 'object' && event.step_update !== null) {
      const step = event.step_update as Record<string, unknown>
      const stepType = step.step_type

      if (stepType === 'agent_response' && typeof step.text_delta === 'string') {
        this.emitNotification('session/update', {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            text: step.text_delta,
          },
        })
      } else if (stepType === 'thought' || stepType === 'reasoning') {
        const text = typeof step.text_delta === 'string'
          ? step.text_delta
          : typeof step.thought === 'string'
            ? step.thought
            : typeof step.reasoning === 'string'
              ? step.reasoning
              : undefined
        if (text) {
          this.emitNotification('session/update', {
            sessionId,
            update: {
              sessionUpdate: 'agent_thought_chunk',
              text,
            },
          })
        }
      } else if (stepType === 'tool') {
        const toolInfo = (step.tool_info as Record<string, unknown>) ?? {}
        const toolName = typeof step.tool_name === 'string' ? step.tool_name : (toolInfo.name as string) ?? 'tool'
        const callId = String(step.step_index ?? Date.now())

        if (step.state === 'ACTIVE') {
          this.emitNotification('session/update', {
            sessionId,
            update: {
              sessionUpdate: 'tool_call',
              callId,
              name: toolName,
              parameters: toolInfo.parameters ?? {},
            },
          })
        } else if (step.state === 'DONE') {
          this.emitNotification('session/update', {
            sessionId,
            update: {
              sessionUpdate: 'tool_call_update',
              callId,
              output: typeof toolInfo.output === 'string' ? toolInfo.output : JSON.stringify(toolInfo.output ?? ''),
            },
          })
        }
      }
    } else if (eventName === 'result' && typeof event.result === 'object' && event.result !== null) {
      const result = event.result as Record<string, unknown>
      if (current) {
        clearTimeout(current.timer)
        this.currentPromptPending = undefined
        if (result.status === 'ERROR') {
          current.reject(new AntigravityAcpError('ANTIGRAVITY_TURN_FAILED', String(result.error ?? 'Execution error')))
        } else {
          current.resolve({ stopReason: 'end_turn', response: result.response })
        }
      }
    }
  }

  private emitNotification(method: string, params: unknown): void {
    const notification: CursorAcpInbound = { kind: 'notification', method, params }
    for (const handler of this.inboundHandlers) {
      try {
        handler(notification)
      } catch (err) {
        this.logger?.warn('Error in inbound ACP handler', { error: String(err) })
      }
    }
  }

  private notifyUnavailable(code: string): void {
    for (const handler of this.unavailableHandlers) {
      try {
        handler(code)
      } catch (err) {
        this.logger?.warn('Error in unavailable ACP handler', { error: String(err) })
      }
    }
  }
}
