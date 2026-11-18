import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { resolveBrainDirs } from './antigravity-paths.js'
import type { AntigravityEvents, StepLogRecord } from './types.js'

interface TranscriptState {
  readonly brainDir: string
  readonly transcriptPath: string
  readonly transcriptFullPath: string
  offset: number
  lineRemainder: string
}

export interface TranscriptWatcherOptions {
  /** Explicit brain roots; takes precedence over the baseDir argument. */
  brainDirs?: readonly string[]
  /** Dispatch a given (type, step_index) once across all roots. Defaults to true. */
  dedupe?: boolean
}

export class TranscriptWatcher extends EventEmitter {
  private readonly states: TranscriptState[]
  private readonly dedupe: boolean
  private readonly dispatched = new Set<string>()
  private pollTimer?: NodeJS.Timeout
  private closed = false
  /** First brain root, retained for compatibility with single-root callers. */
  readonly baseDir: string
  readonly brainDirs: readonly string[]

  constructor(
    readonly conversationId: string,
    baseDir?: string | readonly string[],
    options: TranscriptWatcherOptions = {},
  ) {
    super()
    const roots = options.brainDirs !== undefined ? [...options.brainDirs] : resolveBrainDirs(baseDir)
    this.brainDirs = roots
    this.baseDir = roots[0] ?? ''
    this.dedupe = options.dedupe !== false
    this.states = roots.map(brainDir => {
      const logs = join(brainDir, conversationId, '.system_generated', 'logs')
      return {
        brainDir,
        transcriptPath: join(logs, 'transcript.jsonl'),
        transcriptFullPath: join(logs, 'transcript_full.jsonl'),
        offset: 0,
        lineRemainder: '',
      }
    })
  }

  override on<U extends keyof AntigravityEvents>(event: U, listener: AntigravityEvents[U]): this {
    return super.on(event, listener)
  }

  override emit<U extends keyof AntigravityEvents>(event: U, ...args: Parameters<AntigravityEvents[U]>): boolean {
    return super.emit(event, ...args)
  }

  /**
   * 启动增量文件监听
   */
  start(intervalMs = 250): void {
    if (this.closed) return
    const poll = async () => {
      try {
        await this.readNewLines()
      } catch {
        // 文件可能尚未创建或临时锁占用，静默重试
      }
      if (!this.closed) {
        this.pollTimer = setTimeout(poll, intervalMs)
        this.pollTimer.unref?.()
      }
    }
    void poll()
  }

  stop(): void {
    this.closed = true
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  /**
   * 立即触发一次读取（同步/主动检查）
   */
  async flush(): Promise<void> {
    await this.readNewLines()
  }

  private async readNewLines(): Promise<void> {
    // Consume the most recently updated transcript first. After a desktop ->
    // CLI resume sync both roots contain the same steps; duplicate steps from
    // the older root are then suppressed instead of being emitted twice.
    const ranked = await Promise.all(this.states.map(async state => {
      try {
        return { state, mtimeMs: (await fs.stat(state.transcriptPath)).mtimeMs }
      } catch {
        return { state, mtimeMs: -1 }
      }
    }))
    ranked.sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const { state } of ranked) await this.readState(state)
  }

  private async readState(state: TranscriptState): Promise<void> {
    let stat
    try {
      stat = await fs.stat(state.transcriptPath)
    } catch {
      return
    }

    if (stat.size <= state.offset) return

    const handle = await fs.open(state.transcriptPath, 'r')
    try {
      const bytesToRead = stat.size - state.offset
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, state.offset)
      state.offset += bytesRead

      const text = state.lineRemainder + buffer.subarray(0, bytesRead).toString('utf-8')
      const lines = text.split('\n')
      state.lineRemainder = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        await this.parseAndDispatch(trimmed, state)
      }
    } finally {
      await handle.close()
    }
  }

  private async parseAndDispatch(rawLine: string, state: TranscriptState): Promise<void> {
    let record: StepLogRecord
    try {
      record = JSON.parse(rawLine) as StepLogRecord
    } catch {
      return
    }

    if (Array.isArray(record.truncated_fields) && record.truncated_fields.length > 0) {
      record = await this.enrichFromFullTranscript(record, state)
    }

    if (this.dedupe) {
      const key = `${record.type ?? ''}:${record.step_index ?? ''}`
      if (this.dispatched.has(key)) return
      this.dispatched.add(key)
    }

    this.emit('step', record)

    if (record.type === 'PLANNER_RESPONSE') {
      if (record.thinking && record.thinking.trim() !== '') {
        this.emit('thinking', {
          stepIndex: record.step_index,
          thinking: record.thinking,
          createdAt: record.created_at,
        })
      }
      if (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) {
        this.emit('toolCall', {
          stepIndex: record.step_index,
          toolCalls: record.tool_calls,
          createdAt: record.created_at,
        })
      }
      if (record.content && record.content.trim() !== '') {
        this.emit('message', {
          stepIndex: record.step_index,
          text: record.content,
          createdAt: record.created_at,
        })
      }
    } else if (record.type === 'USER_INPUT' && record.content) {
      this.emit('message', {
        stepIndex: record.step_index,
        text: record.content,
        createdAt: record.created_at,
      })
    }

    if (record.status === 'DONE' && record.type === 'PLANNER_RESPONSE') {
      this.emit('complete', this.conversationId)
    }
  }

  private async enrichFromFullTranscript(record: StepLogRecord, state: TranscriptState): Promise<StepLogRecord> {
    try {
      const content = await fs.readFile(state.transcriptFullPath, 'utf-8')
      const lines = content.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const full = JSON.parse(trimmed) as StepLogRecord
        if (full.step_index === record.step_index) {
          return full
        }
      }
    } catch {
      // 容错降级
    }
    return record
  }
}
