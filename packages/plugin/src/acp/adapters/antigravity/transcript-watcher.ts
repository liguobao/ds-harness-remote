import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import type { AntigravityEvents, StepLogRecord } from './types.js'

export class TranscriptWatcher extends EventEmitter {
  private offset = 0
  private lineRemainder = ''
  private pollTimer?: NodeJS.Timeout
  private closed = false
  private readonly transcriptPath: string
  private readonly transcriptFullPath: string

  constructor(
    readonly conversationId: string,
    readonly baseDir: string = join(homedir(), '.gemini/antigravity-cli/brain'),
  ) {
    super()
    const brainDir = join(this.baseDir, conversationId, '.system_generated/logs')
    this.transcriptPath = join(brainDir, 'transcript.jsonl')
    this.transcriptFullPath = join(brainDir, 'transcript_full.jsonl')
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
    let stat
    try {
      stat = await fs.stat(this.transcriptPath)
    } catch {
      return
    }

    if (stat.size <= this.offset) return

    const handle = await fs.open(this.transcriptPath, 'r')
    try {
      const bytesToRead = stat.size - this.offset
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, this.offset)
      this.offset += bytesRead

      const text = this.lineRemainder + buffer.subarray(0, bytesRead).toString('utf-8')
      const lines = text.split('\n')
      this.lineRemainder = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        await this.parseAndDispatch(trimmed)
      }
    } finally {
      await handle.close()
    }
  }

  private async parseAndDispatch(rawLine: string): Promise<void> {
    let record: StepLogRecord
    try {
      record = JSON.parse(rawLine) as StepLogRecord
    } catch {
      return
    }

    if (Array.isArray(record.truncated_fields) && record.truncated_fields.length > 0) {
      record = await this.enrichFromFullTranscript(record)
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

  private async enrichFromFullTranscript(record: StepLogRecord): Promise<StepLogRecord> {
    try {
      const content = await fs.readFile(this.transcriptFullPath, 'utf-8')
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
