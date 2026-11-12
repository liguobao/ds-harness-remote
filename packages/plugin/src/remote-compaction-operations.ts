import { randomUUID } from 'node:crypto'
import type {
  RemoteCompactionState,
  RemoteCompactionStatusParams,
  RemoteCompactionStatusResult,
  RemoteCompactionSubmitParams,
  RemoteCompactionSubmitResult,
} from '@dsh-remote/protocol'
import type { SafeLogger } from './logging.js'
import { RpcError } from './safe-error.js'
import type { TypertRpcResult } from './typert-gateway-contract.js'

/**
 * Host-side registry for asynchronous Remote compaction operations.
 *
 * Harness `commands/execute('/compact')` resolves only after the whole
 * summarization finishes, which can take minutes on local inference backends.
 * Forwarding that call through one RPC makes the RPC deadline (60s on the Host
 * bridge, 35-60s on clients) the effective compaction deadline. This registry
 * instead owns the run on the Host runtime:
 *
 * - `submit` registers and starts the operation, then returns at once.
 * - The run uses its own AbortController and budget, independent of the
 *   submitting connection and RPC.
 * - Closing the client connection stops observation only; `closeAll` belongs
 *   to Host shutdown.
 * - `requestId` makes submission idempotent, so a lost response never starts a
 *   second compaction.
 * - Completed operations are retained briefly so a reconnecting client can
 *   read the settled result; an unknown id (for example after a Host restart)
 *   is reported as `interrupted`, never replayed.
 */

export interface RemoteCompactionOwner {
  deviceId: string
  connectionId: string
}

/** Runs the Host's fixed `/compact` command for one operation. */
export type RemoteCompactionRunner = (sessionId: string, signal: AbortSignal) => Promise<TypertRpcResult>

type SettledState = Exclude<RemoteCompactionState, 'accepted' | 'running' | 'cancelling'>

interface CompactionOperation {
  readonly operationId: string
  readonly requestId: string
  readonly sessionId: string
  readonly ownerDeviceId: string
  readonly budgetMs: number
  readonly acceptedAt: number
  readonly controller: AbortController
  readonly settled: Promise<void>
  resolveSettled: () => void
  state: RemoteCompactionState
  startedAt?: number
  finishedAt?: number
  message?: string
  cancelled: boolean
  timedOut: boolean
  timer?: ReturnType<typeof setTimeout>
}

const MIN_BUDGET_MS = 60_000
const MAX_BUDGET_MS = 7_200_000
const DEFAULT_BUDGET_MS = 1_800_000
/** Keep settled operations readable long enough for a reconnect to collect them. */
const RETENTION_MS = 600_000
/** A cancel request waits this long for the command to actually settle. */
const CANCEL_SETTLE_MS = 15_000

function requestIndexKey(ownerDeviceId: string, sessionId: string, requestId: string): string {
  return `${ownerDeviceId}\u0000${sessionId}\u0000${requestId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class RemoteCompactionOperations {
  private readonly operations = new Map<string, CompactionOperation>()
  private readonly requestIndex = new Map<string, string>()
  private closed = false

  constructor(
    private readonly runner: RemoteCompactionRunner,
    private readonly logger?: SafeLogger,
    private readonly now: () => number = Date.now,
  ) {}

  submit(params: RemoteCompactionSubmitParams, owner: RemoteCompactionOwner): RemoteCompactionSubmitResult {
    if (this.closed) throw new RpcError('HARNESS_UNAVAILABLE', 'The Remote Host is shutting down.')
    this.prune()
    const key = requestIndexKey(owner.deviceId, params.sessionId, params.requestId)
    const existing = this.requestIndex.get(key)
    if (existing !== undefined) {
      const operation = this.operations.get(existing)
      if (operation !== undefined) return { operationId: operation.operationId, state: operation.state }
      this.requestIndex.delete(key)
    }
    const budgetMs = clampBudget(params.budgetMs)
    const operation = this.createOperation(params, owner, budgetMs)
    this.operations.set(operation.operationId, operation)
    this.requestIndex.set(key, operation.operationId)
    this.logger?.info('remote compaction accepted', {
      operationId: operation.operationId,
      sessionId: operation.sessionId,
      budgetMs,
    })
    void this.run(operation)
    return { operationId: operation.operationId, state: 'accepted' }
  }

  status(params: RemoteCompactionStatusParams, owner: RemoteCompactionOwner): RemoteCompactionStatusResult {
    this.prune()
    const operation = this.find(params, owner)
    if (operation === undefined) return this.interrupted(params)
    return this.view(operation)
  }

  async cancel(params: RemoteCompactionStatusParams, owner: RemoteCompactionOwner): Promise<RemoteCompactionStatusResult> {
    this.prune()
    const operation = this.find(params, owner)
    if (operation === undefined) return this.interrupted(params)
    if (operation.finishedAt !== undefined) return this.view(operation)
    if (!operation.cancelled) {
      operation.cancelled = true
      operation.state = 'cancelling'
      operation.controller.abort(new Error('Remote compaction cancelled by the client.'))
      this.logger?.info('remote compaction cancellation requested', { operationId: operation.operationId })
    }
    // Report the terminal state only after the Host call actually settles; a
    // still-running command answers `cancelling` and the client polls again.
    await Promise.race([operation.settled, delay(CANCEL_SETTLE_MS)])
    return this.view(operation)
  }

  /** Host shutdown: stop work and report every unfinished operation as interrupted. */
  closeAll(): void {
    this.closed = true
    for (const operation of this.operations.values()) {
      if (operation.finishedAt !== undefined) continue
      this.settle(operation, 'interrupted', 'The Remote Host shut down before the compaction finished.')
      operation.controller.abort(new Error('Remote Host shut down.'))
    }
  }

  private createOperation(
    params: RemoteCompactionSubmitParams,
    owner: RemoteCompactionOwner,
    budgetMs: number,
  ): CompactionOperation {
    let resolveSettled = () => {}
    const settled = new Promise<void>(resolve => { resolveSettled = resolve })
    return {
      operationId: randomUUID(),
      requestId: params.requestId,
      sessionId: params.sessionId,
      ownerDeviceId: owner.deviceId,
      budgetMs,
      acceptedAt: this.now(),
      controller: new AbortController(),
      settled,
      resolveSettled,
      state: 'accepted',
      cancelled: false,
      timedOut: false,
    }
  }

  private async run(operation: CompactionOperation): Promise<void> {
    operation.state = 'running'
    operation.startedAt = this.now()
    operation.timer = setTimeout(() => {
      operation.timedOut = true
      operation.controller.abort(new Error('Remote compaction exceeded its budget.'))
    }, operation.budgetMs)
    try {
      const result = await this.runner(operation.sessionId, operation.controller.signal)
      const outcome = this.interpret(operation, result)
      this.settle(operation, outcome.state, outcome.message)
    } catch (error) {
      this.settle(operation, this.failureState(operation), this.failureMessage(operation, error))
    }
  }

  private interpret(
    operation: CompactionOperation,
    result: TypertRpcResult,
  ): { state: SettledState; message?: string } {
    if (operation.cancelled) return { state: 'cancelled', message: 'Compaction cancelled.' }
    if (operation.timedOut) {
      return { state: 'failed', message: `Compaction exceeded its ${operation.budgetMs}ms budget.` }
    }
    if (result.ok !== true) {
      return { state: 'failed', message: sanitizeMessage(result.error.message) }
    }
    const value = result.value
    const command = isRecord(value) && isRecord(value.result) ? value.result : undefined
    if (command === undefined || (command.kind !== 'success' && command.kind !== 'error')) {
      return { state: 'failed', message: 'The Host returned an unexpected compaction result.' }
    }
    if (command.kind === 'error') {
      return {
        state: 'failed',
        message: typeof command.text === 'string' && command.text.trim() !== ''
          ? sanitizeMessage(command.text)
          : 'The Host rejected the compaction command.',
      }
    }
    return {
      state: 'succeeded',
      ...(typeof command.text === 'string' && command.text.trim() !== ''
        ? { message: sanitizeMessage(command.text) }
        : {}),
    }
  }

  private failureState(operation: CompactionOperation): SettledState {
    if (operation.cancelled) return 'cancelled'
    if (operation.timedOut) return 'failed'
    return 'failed'
  }

  private failureMessage(operation: CompactionOperation, error: unknown): string {
    if (operation.cancelled) return 'Compaction cancelled.'
    if (operation.timedOut) return `Compaction exceeded its ${operation.budgetMs}ms budget.`
    if (error instanceof RpcError) return sanitizeMessage(error.message)
    this.logger?.warn('remote compaction failed', {
      operationId: operation.operationId,
      reason: error instanceof Error ? error.name : 'unknown',
    })
    return 'The Host failed to run the compaction command.'
  }

  private settle(operation: CompactionOperation, state: SettledState, message?: string): void {
    if (operation.finishedAt !== undefined) return
    if (operation.timer !== undefined) {
      clearTimeout(operation.timer)
      operation.timer = undefined
    }
    operation.state = state
    operation.finishedAt = this.now()
    if (message !== undefined) operation.message = message
    operation.resolveSettled()
    this.logger?.info('remote compaction settled', {
      operationId: operation.operationId,
      state,
      durationMs: operation.startedAt === undefined ? 0 : operation.finishedAt - operation.startedAt,
    })
    this.prune()
  }

  private find(params: RemoteCompactionStatusParams, owner: RemoteCompactionOwner): CompactionOperation | undefined {
    const operation = this.operations.get(params.operationId)
    if (operation === undefined) return undefined
    if (operation.ownerDeviceId !== owner.deviceId) {
      throw new RpcError('PERMISSION_DENIED', 'This compaction operation belongs to another device.')
    }
    if (operation.sessionId !== params.sessionId) {
      throw new RpcError('INVALID_MESSAGE', 'The compaction operation does not belong to this Session.')
    }
    return operation
  }

  private view(operation: CompactionOperation): RemoteCompactionStatusResult {
    return {
      operationId: operation.operationId,
      sessionId: operation.sessionId,
      state: operation.state,
      acceptedAt: operation.acceptedAt,
      ...(operation.startedAt === undefined ? {} : { startedAt: operation.startedAt }),
      ...(operation.finishedAt === undefined ? {} : { finishedAt: operation.finishedAt }),
      ...(operation.message === undefined ? {} : { message: operation.message }),
    }
  }

  private interrupted(params: RemoteCompactionStatusParams): RemoteCompactionStatusResult {
    return {
      operationId: params.operationId,
      sessionId: params.sessionId,
      state: 'interrupted',
      message: 'The Host no longer tracks this operation; it may have restarted.',
    }
  }

  /** Drop settled operations past retention; unfinished ones are never pruned. */
  private prune(): void {
    const cutoff = this.now() - RETENTION_MS
    for (const [operationId, operation] of this.operations) {
      if (operation.finishedAt === undefined || operation.finishedAt > cutoff) continue
      this.operations.delete(operationId)
      this.requestIndex.delete(requestIndexKey(operation.ownerDeviceId, operation.sessionId, operation.requestId))
    }
  }
}

function clampBudget(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BUDGET_MS
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new RpcError('INVALID_MESSAGE', 'budgetMs must be a safe integer.')
  }
  return Math.min(Math.max(value, MIN_BUDGET_MS), MAX_BUDGET_MS)
}

function sanitizeMessage(message: string): string {
  return message.length <= 2_000 ? message : `${message.slice(0, 2_000)}…`
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
