import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { RpcError } from './safe-error.js'
import type { TypertRpcResult } from './typert-gateway-contract.js'
import { parseCodexSessionId } from './codex/session-id.js'

export const TERMINAL_CALLS = new Set(['terminal/environment', 'terminal/shells', 'terminal/list',
  'terminal/create', 'terminal/write', 'terminal/resize', 'terminal/rename', 'terminal/close'])
export const TERMINAL_STREAMS = new Set(['terminal/follow', 'terminal/retain', 'terminal/watch'])
const id = z.string().regex(/^[A-Za-z0-9_:-]{1,256}$/)
const rosterPayload = z.object({ args: z.object({ sessionId: id }).strict() }).strict()

/** Host-lifetime device ownership survives transport reconnects; never supplied by the client. */
export class TerminalPolicy {
  private static readonly claims = new WeakMap<Map<string, string>, Map<string, object>>()
  private readonly attachments = new Map<string, { id: string; claim?: object }>()
  private readonly claims: Map<string, object>
  constructor(private readonly enabled: boolean | (() => boolean), private readonly deviceId: string,
    private readonly owners: Map<string, string>) {
    this.claims = TerminalPolicy.claims.get(owners) ?? new Map()
    TerminalPolicy.claims.set(owners, this.claims)
  }

  /** Host process cleanup releases the exact terminal identity for every connection. */
  static releaseOwner(owners: Map<string, string>, key: string): void {
    owners.delete(key)
    TerminalPolicy.claims.get(owners)?.delete(key)
  }

  check(endpoint: string, payload: unknown): { key?: string; created?: boolean; claim?: object } {
    if (!(typeof this.enabled === 'function' ? this.enabled() : this.enabled)) throw new RpcError('TERMINAL_DISABLED',
      'Remote terminal is disabled on this Host. Enable Remote terminal in the Host Remote settings; the switch saves and applies immediately. / 远程终端未开启，请在 Host 的 Remote 设置中开启「远程终端」，开关切换后立即保存并生效。')
    if (endpoint === 'terminal/watch') {
      rosterPayload.parse(payload)
      return {}
    }
    for (const [key, attachment] of this.attachments) if (this.owners.get(key) !== this.deviceId || this.claims.get(key) !== attachment.claim) this.attachments.delete(key)
    const args = z.object({ args: z.record(z.string(), z.unknown()) }).strict().parse(payload).args
    const rawSessionId = args.agentId ?? args.sessionId
    const sessionId = id.parse(rawSessionId)
    // CodeX sessions are deliberately opaque keys here. Their thread/cwd
    // authority is resolved by the CodeX Host domain, never by Harness lookup.
    const codexSession = parseCodexSessionId(sessionId)
    void codexSession
    if (endpoint === 'terminal/environment' || endpoint === 'terminal/shells' || endpoint === 'terminal/list') return {}
    const request = endpoint === 'terminal/create' ? z.object({ id }).passthrough().parse(args.request) : undefined
    const terminalId = id.parse(request?.id ?? args.id)
    const key = `${sessionId}/${terminalId}`
    if (endpoint === 'terminal/create') {
      if (this.owners.has(key) && this.owners.get(key) !== this.deviceId) this.deny()
      if (!this.owners.has(key) && this.owners.size >= 256) throw new RpcError('RATE_LIMITED', 'Too many retained remote terminals.')
      const created = !this.owners.has(key)
      this.owners.set(key, this.deviceId)
      if (created || !this.claims.has(key)) this.claims.set(key, {})
      return { key, created, claim: this.claims.get(key) }
    }
    if (this.owners.get(key) !== this.deviceId) this.deny()
    if (endpoint === 'terminal/follow') this.attachments.set(key, { id: id.parse(args.attachmentId), claim: this.claims.get(key) })
    if (endpoint === 'terminal/write' || endpoint === 'terminal/resize') {
      if (this.attachments.get(key)?.id !== id.parse(args.attachmentId)) this.deny()
    }
    return { key, claim: this.claims.get(key) }
  }

  result(endpoint: string, payload: unknown, result: TypertRpcResult, reservation: { key?: string; created?: boolean; claim?: object }): TypertRpcResult {
    const releases = (!result.ok && reservation.created && result.error.code !== 'TERMINAL_CLEANUP_FAILED') || (result.ok && endpoint === 'terminal/close')
    // Cleanup can finish before an older RPC response. Its response must not
    // release a new allocation that has since claimed the same identity.
    if (reservation.key !== undefined && releases && this.owners.get(reservation.key) === this.deviceId
      && this.claims.get(reservation.key) === reservation.claim) {
      TerminalPolicy.releaseOwner(this.owners, reservation.key)
      this.attachments.delete(reservation.key)
    }
    if (endpoint === 'terminal/list' && result.ok && Array.isArray(result.value)) {
      const args = (payload as { args: Record<string, unknown> }).args
      const session = args.sessionId ?? args.agentId
      return { ok: true, value: this.ownedRoster(session, result.value) }
    }
    return result
  }

  async *watch(payload: unknown, source: AsyncIterable<unknown>): AsyncIterable<unknown[]> {
    const { args: { sessionId } } = rosterPayload.parse(payload)
    let previous: unknown[] | undefined
    for await (const value of source) {
      this.check('terminal/watch', payload)
      if (!Array.isArray(value)) throw new RpcError('INVALID_MESSAGE', 'The terminal roster is invalid.')
      const roster = this.ownedRoster(sessionId, value)
      if (isDeepStrictEqual(previous, roster)) continue
      previous = roster
      yield roster
    }
  }

  private ownedRoster(session: unknown, value: unknown[]): unknown[] {
    return value.filter(item => typeof item === 'object' && item !== null && 'id' in item
      && typeof item.id === 'string' && this.owners.get(`${session}/${item.id}`) === this.deviceId)
  }

  private deny(): never { throw new RpcError('PERMISSION_DENIED', 'This terminal or input attachment belongs to another connection or device.') }
}
