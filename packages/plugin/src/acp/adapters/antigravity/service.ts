import { AntigravityExecutor, type SingleExecutionResult } from './executor.js'
import { TranscriptWatcher } from './transcript-watcher.js'
import type { ExecutionOptions } from './types.js'

export class AntigravitySession {
  constructor(
    readonly conversationId: string,
    readonly watcher: TranscriptWatcher,
    private readonly executor: AntigravityExecutor,
    private readonly defaultOptions: ExecutionOptions = {},
  ) {}

  /**
   * 发送 Prompt 并等待完成；期间 watcher 会持续抛出思考与工具调用事件
   */
  async prompt(text: string, options: ExecutionOptions = {}): Promise<SingleExecutionResult> {
    const merged: ExecutionOptions = {
      ...this.defaultOptions,
      ...options,
      conversationId: this.conversationId,
    }
    const result = await this.executor.executeOnce(text, merged)
    await this.watcher.flush()
    return result
  }

  close(): void {
    this.watcher.stop()
    this.executor.kill()
  }
}

export class AntigravityService {
  constructor(private readonly executor: AntigravityExecutor = new AntigravityExecutor()) {}

  /**
   * 创建新会话并执行首轮 Prompt
   */
  async createSession(
    initialPrompt: string,
    options: ExecutionOptions = {},
  ): Promise<{ session: AntigravitySession; result: SingleExecutionResult }> {
    const result = await this.executor.executeOnce(initialPrompt, options)
    const conversationId = result.conversationId || 'default'

    const watcher = new TranscriptWatcher(conversationId)
    watcher.start()
    await watcher.flush()

    const session = new AntigravitySession(conversationId, watcher, this.executor, options)
    return { session, result }
  }

  /**
   * 恢复已有会话
   */
  resumeSession(conversationId: string, options: ExecutionOptions = {}): AntigravitySession {
    const watcher = new TranscriptWatcher(conversationId)
    watcher.start()
    return new AntigravitySession(conversationId, watcher, this.executor, {
      ...options,
      conversationId,
    })
  }

  /**
   * 单次无状态执行
   */
  async executeOnce(prompt: string, options: ExecutionOptions = {}): Promise<SingleExecutionResult> {
    return this.executor.executeOnce(prompt, options)
  }
}
