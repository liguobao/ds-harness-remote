import type { CatalogState } from './virtual-catalog.js'
import { nativeVisibleWorkspaces, nativeWorkspace } from './virtual-catalog.js'
import type { PendingApproval } from './virtual-contract.js'
import { AsyncValueQueue } from './virtual-contract.js'
import type { CodexClientLike, JsonRecord } from './virtual-values.js'
import { record, string } from './virtual-values.js'

/** Collaborates with one CodexVirtualHarness; never creates a second session or connection state. */
export interface CodexEventCarrierContext {
  readonly workspaceStreams: Set<AsyncValueQueue>
  readonly refreshCatalog: (signal?: AbortSignal) => Promise<CatalogState>
  readonly selectedWorkspaceId: string | undefined
  readonly controlStreams: Set<AsyncValueQueue>
  readonly host: { deviceId: string; name: string; }
  readonly eventStreams: Map<string, AsyncValueQueue>
  readonly currentCatalog: (signal?: AbortSignal) => Promise<CatalogState>
  readonly pendingApprovals: Map<string, PendingApproval>
  readonly client: CodexClientLike
}

export class CodexEventCarrier {
  constructor(private readonly context: CodexEventCarrierContext) {}

  async workspaceFollow(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const queue = new AsyncValueQueue(signal)
    this.context.workspaceStreams.add(queue)
    const catalog = await this.context.refreshCatalog(signal)
    queue.push({
      type: 'baseline',
      value: {
        items: nativeVisibleWorkspaces(catalog, this.context.selectedWorkspaceId).map(nativeWorkspace),
        archivedSessionIds: catalog.sessions.filter(item => item.archived).map(item => item.id),
        pinnedSessionIds: [],
      },
    })
    return queue.iterate(() => this.context.workspaceStreams.delete(queue))
  }

  async sessionControl(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const queue = new AsyncValueQueue(signal)
    this.context.controlStreams.add(queue)
    queue.push({ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } })
    return queue.iterate(() => this.context.controlStreams.delete(queue))
  }

  /**
   * Background jobs belong to the Host Harness session, not to a CodeX virtual
   * Workspace. The native session header mounts a job roster stream as soon as a
   * Session opens, so answer it with an authoritative empty roster instead of a
   * terminal `method-not-found` failure that tears the page down.
   */
  emptyJobStream(endpoint: 'job/list' | 'job/follow', signal: AbortSignal): AsyncIterable<unknown> {
    const queue = new AsyncValueQueue(signal)
    if (endpoint === 'job/list') queue.push({ type: 'rows', jobs: [] })
    return queue.iterate(() => queue.close())
  }

  async remoteEvents(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const queue = new AsyncValueQueue(signal)
    const clientId = `codex-events:${this.context.host.deviceId}:${Date.now().toString(36)}`
    this.context.eventStreams.set(clientId, queue)
    const home = (await this.context.currentCatalog(signal)).workspaces[0]?.path ?? '/'
    queue.push({ type: 'ready', clientId, host: { home } })
    return queue.iterate(() => this.context.eventStreams.delete(clientId))
  }

  emitRemoteEvent(event: string, args: unknown[]): void {
    for (const queue of this.context.eventStreams.values()) queue.push({ type: 'emit', event, args })
  }

  emitApproval(input: { eventId: string; agentId: string; request: JsonRecord }): void {
    for (const queue of this.context.eventStreams.values()) queue.push({
      type: 'waterfall',
      event: 'approval/request',
      eventId: input.eventId,
      agentId: input.agentId,
      request: input.request,
    })
  }

  async answerRemoteEvent(args: JsonRecord, signal: AbortSignal): Promise<undefined> {
    const eventId = string(args.eventId)
    const outcome = record(args.outcome)
    if (eventId === undefined) throw new Error('The CodeX approval result is missing its event id.')
    const pending = this.context.pendingApprovals.get(eventId)
    if (pending === undefined) return undefined
    this.context.pendingApprovals.delete(eventId)
    const decision = outcome.kind === 'result' && outcome.value === 'allowed-once'
      ? 'accept'
      : outcome.kind === 'result' && outcome.value === 'cancelled'
        ? 'cancel'
        : 'decline'
    await this.context.client.respond(pending.requestHandle, decision, signal)
    return undefined
  }

  publishProjection(sessionId: string, key: string, value: unknown, seq: number): void {
    // 0.2.2 sends per-event `changes`; keep the legacy key/value fields so
    // older official clients keep applying the same frame.
    for (const queue of this.context.controlStreams) {
      queue.push({ type: 'projection', sessionId, seq, key, value, changes: [{ key, val: value }] })
    }
  }
}
