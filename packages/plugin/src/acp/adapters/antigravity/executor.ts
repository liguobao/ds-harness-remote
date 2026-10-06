import { type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolveAntigravityBinary } from '../antigravity-process.js'
import { spawnAntigravityWithLocalCredentials } from '../antigravity-local-auth.js'
import type { ExecutionOptions } from './types.js'

export interface SingleExecutionResult {
  conversationId?: string
  output: string
  raw: unknown
}

export class AntigravityExecutor {
  private activeProcess?: ChildProcess

  /**
   * 非交互式调用：`agy -p "<prompt>" --output-format json`
   */
  async executeOnce(
    prompt: string,
    options: ExecutionOptions = {},
  ): Promise<SingleExecutionResult> {
    const args: string[] = ['-p', prompt, '--output-format', 'json']

    if (options.conversationId) {
      args.push('--conversation', options.conversationId)
    } else if (options.continueLast) {
      args.push('-c')
    }

    if (options.skipPermissions) {
      args.push('--dangerously-skip-permissions')
    }

    const timeoutMs = options.timeoutMs ?? 120_000
    args.push('--print-timeout', String(Math.floor(timeoutMs / 1000)))

    const binary = resolveAntigravityBinary(options.binaryPath)
    const child = spawnAntigravityWithLocalCredentials(binary, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.activeProcess = child
    let stdout = ''
    let stderr = ''

    return new Promise<SingleExecutionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`Antigravity execution timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref?.()

      child.stdout?.on('data', chunk => { stdout += chunk.toString('utf-8') })
      child.stderr?.on('data', chunk => { stderr += chunk.toString('utf-8') })

      child.on('error', err => {
        clearTimeout(timer)
        this.activeProcess = undefined
        reject(err)
      })

      child.on('close', code => {
        clearTimeout(timer)
        this.activeProcess = undefined
        if (code !== 0) {
          return reject(new Error(`agy exited with code ${code}: ${stderr.trim()}`))
        }
        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>
          const convId = typeof parsed.conversation_id === 'string'
            ? parsed.conversation_id
            : options.conversationId
          const text = typeof parsed.content === 'string' ? parsed.content : stdout
          resolve({
            conversationId: convId,
            output: text,
            raw: parsed,
          })
        } catch {
          resolve({
            conversationId: options.conversationId,
            output: stdout,
            raw: stdout,
          })
        }
      })
    })
  }

  /**
   * 启动常驻交互式流式子进程 (stream-json 管道模式)
   */
  spawnStreamSession(options: ExecutionOptions = {}): ChildProcessWithoutNullStreams {
    const args: string[] = ['--input-format', 'stream-json', '--output-format', 'stream-json']

    if (options.conversationId) {
      args.push('--conversation', options.conversationId)
    } else if (options.continueLast) {
      args.push('-c')
    }

    if (options.skipPermissions) {
      args.push('--dangerously-skip-permissions')
    }

    const binary = resolveAntigravityBinary(options.binaryPath)
    return spawnAntigravityWithLocalCredentials(binary, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  kill(): void {
    if (this.activeProcess && !this.activeProcess.killed) {
      this.activeProcess.kill('SIGTERM')
      this.activeProcess = undefined
    }
  }
}
