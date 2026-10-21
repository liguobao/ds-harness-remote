import { MAX_SECURE_MESSAGE_BYTES } from '@dsh-remote/protocol'
import type { PluginRouteCallParams, PluginRouteCallResult } from '@dsh-remote/protocol'
import { z } from 'zod'
import type { SafeLogger } from './logging.js'
import { RpcError } from './safe-error.js'

/** Local plugin web routes forwardable over the authenticated channel (POST only). */
export const PLUGIN_ROUTE_ALLOWLIST = ['api/bot'] as const

/** Reviewed DS Bot operations; new upstream operations stay local by default. */
export const BOT_REMOTE_OPERATIONS = [
  'state', 'models', 'efforts', 'exchange', 'earlier', 'usage', 'room-progress', 'schedules',
  'create-bot', 'duplicate-bot', 'update-bot', 'delete-bot', 'set-main', 'set-flags',
  'create-room', 'update-room', 'delete-room',
  'add-agent', 'agent-session', 'agent-adopt', 'agent-archive', 'agent-rename', 'remove-agent',
  'send', 'answer-question', 'dismiss-question', 'view-reply', 'approval-answer', 'stop-member-work',
] as const

export function isAllowedPluginRoute(route: string): route is typeof PLUGIN_ROUTE_ALLOWLIST[number] {
  return PLUGIN_ROUTE_ALLOWLIST.some(allowed => allowed === route)
}

export type PluginRouteDispatcher = (
  route: string,
  body: unknown,
  signal: AbortSignal,
) => Promise<{ status: number; json: unknown }>

const callSchema = z.object({
  route: z.enum(PLUGIN_ROUTE_ALLOWLIST),
  body: z.object({
    endpoint: z.enum(BOT_REMOTE_OPERATIONS),
    payload: z.record(z.string(), z.unknown()).nullable().optional(),
  }).strict().superRefine((body, ctx) => {
    if (body.endpoint === 'approval-answer' && body.payload?.choice !== 'allow' && body.payload?.choice !== 'reject') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only one-time approval or rejection is supported.' })
    }
  }),
}).strict()

/** Local plugin route call timeout, mirroring the Harness API bridge budget. */
const PLUGIN_ROUTE_TIMEOUT_MS = 30_000

/**
 * Forwards bounded POST calls to local plugin web routes (first case: ds-bot's
 * `api/bot`) through the shared fetch handler of the Host connection service.
 * The route allowlist and both size bounds keep the tunnel fail-closed.
 */
export class PluginRouteBridge {
  constructor(
    private readonly dispatch: PluginRouteDispatcher,
    private readonly logger?: SafeLogger,
  ) {}

  async call(input: unknown): Promise<PluginRouteCallResult> {
    let params: PluginRouteCallParams
    try {
      params = callSchema.parse(input) as PluginRouteCallParams
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new RpcError('INVALID_MESSAGE', 'The plugin route call is invalid for the remote channel.')
      }
      throw error
    }
    if (serializedBytes(params) > MAX_SECURE_MESSAGE_BYTES) {
      throw new RpcError('INVALID_MESSAGE', `The plugin route call exceeds the ${MAX_SECURE_MESSAGE_BYTES}-byte remote limit.`)
    }
    const startedAt = performance.now()
    let result: { status: number; json: unknown }
    try {
      result = await this.dispatch(params.route, params.body, AbortSignal.timeout(PLUGIN_ROUTE_TIMEOUT_MS))
    } catch (error) {
      this.logger?.warn('plugin route call failed', {
        route: params.route,
        durationMs: Math.round(performance.now() - startedAt),
      })
      throw error
    }
    if (serializedBytes(result) > MAX_SECURE_MESSAGE_BYTES) {
      throw new RpcError('RESPONSE_TOO_LARGE', 'The plugin route response exceeds the bounded remote limit.')
    }
    this.logger?.debug('plugin route call ok', {
      route: params.route,
      status: result.status,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return { status: result.status, json: result.json }
  }
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
