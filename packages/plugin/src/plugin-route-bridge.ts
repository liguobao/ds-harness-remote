import { MAX_SECURE_MESSAGE_BYTES, MAX_HARNESS_API_TRANSFER_BYTES } from '@dsh-remote/protocol'
import type { PluginRouteCallParams, PluginRouteCallResult } from '@dsh-remote/protocol'
import { z } from 'zod'
import type { SafeLogger } from './logging.js'
import { RpcError } from './safe-error.js'

/** Local plugin web routes forwardable over the authenticated channel (POST only). */
export const PLUGIN_ROUTE_ALLOWLIST = ['api/bot', 'api/session/uploadFileBinary'] as const

/** DS-Bot v0.4.1 team channel endpoints + legacy compat; computer-only and dsh-update-install stay local. */
export const BOT_REMOTE_OPERATIONS = [
  'abandon-work', 'add-agent', 'agent-adopt', 'agent-archive', 'agent-chat',
  'agent-rename', 'agent-session', 'answer-question', 'approval-answer', 'avatar',
  'avatar-delete', 'avatar-import', 'avatar-library', 'background-add', 'background-picture',
  'bot-capability', 'bot-move-to-background', 'bot-steer-queue', 'bot-stop-task', 'bot-task-read',
  'bot-task-send', 'browser-frame', 'browser-give-back', 'browser-stop', 'browser-takeover',
  'btw-delete', 'cancel-work', 'capability-approve', 'capability-delete', 'capability-save',
  'changes-check', 'chat', 'chatgpt', 'chatgpt-cancel', 'chatgpt-models',
  'chatgpt-sign-out', 'computer-app-answer', 'computer-stop', 'connector-add', 'connector-cancel',
  'connector-client', 'connector-connect', 'connector-disconnect', 'connector-remove', 'connector-request-cancel',
  'connector-retry', 'connector-set', 'connector-sign-in-code', 'create-bot', 'create-room',
  'deepseek-services', 'deepseek-services-config', 'deepseek-synthesize', 'delete-bot', 'delete-room',
  'diagnostics', 'diagnostics-clear', 'diagnostics-log', 'dismiss-question', 'dismiss-view',
  'duplicate-bot', 'earlier', 'efforts', 'exchange', 'exchange-text',
  'file-download', 'file-text', 'folder-list', 'folders', 'goal-control',
  'goal-draft', 'group-relay-replies', 'group-rows', 'group-search', 'hello',
  'im-add', 'im-chat', 'im-login-start', 'im-login-wait', 'im-pair',
  'im-remove', 'im-retry', 'im-unpair', 'im-update', 'image',
  'learning-answer', 'local-agent-add', 'local-agent-models', 'local-agent-profile-add', 'local-agent-profile-remove',
  'local-agent-profile-update', 'local-agent-refresh', 'local-agent-remove', 'local-agent-update', 'local-agents',
  'mail-account-add', 'mail-account-remove', 'mail-rule-set', 'mail-send-answer', 'mail-sign-in-code',
  'markdown-image', 'memory-add', 'memory-ask', 'memory-edit', 'memory-forget',
  'memory-history', 'memory-layer', 'memory-move', 'memory-pin', 'memory-restore',
  'memory-tidy-undo', 'memory-view', 'models', 'new-part', 'notices',
  'presets', 'private-release', 'provider-add', 'provider-key', 'provider-models',
  'provider-models-save', 'provider-remove', 'providers', 'recover-session', 'remove-agent',
  'repo-stars', 'resume', 'resume-room-pause', 'resume-work', 'room-chat',
  'room-progress', 'room-todo', 'run-stats', 'schedule-create', 'schedule-delete',
  'schedule-pause', 'schedules', 'secret-allow', 'secret-cancel', 'secret-decrypt',
  'secret-delete', 'secret-encrypt', 'secret-refresh-external', 'secret-set', 'secret-store',
  'secret-unlock', 'secret-update', 'section-delete', 'section-order', 'section-save',
  'send', 'set-chat-background', 'set-flags', 'set-main', 'set-prefs',
  'side-ask', 'side-cancel', 'side-close', 'side-new', 'stage-file',
  'stage-image', 'state', 'stop-agent', 'stop-chat', 'stop-member-work',
  'stop-room-work', 'task-cancel', 'task-note', 'team-workspace', 'thinking',
  'update-bot', 'update-check', 'update-install', 'update-room', 'usage',
  'usage-summary', 'view-reply',
  // Legacy compat for DS-Bot <0.4.0 Hosts.
  'btw', 'btw-cancel', 'room-continue', 'bot-new-part', 'bot-open-part',
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
  }).strict(),
}).strict()

/** Fixed official attachment intake; caller-selected filesystem paths are forbidden. */
const uploadFields = {
  sessionId: z.string().min(1).max(512),
  name: z.string().max(512).optional(),
  data: z.string().max(256 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/).refine(value => value.length % 4 === 0),
}
const imageUploadCallSchema = z.object({
  route: z.literal('api/session/uploadFileBinary'),
  body: z.discriminatedUnion('endpoint', [
    z.object({ endpoint: z.literal('image'), payload: z.object({ ...uploadFields,
      mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    }).strict() }).strict(),
    z.object({ endpoint: z.literal('file'), payload: z.object(uploadFields).strict() }).strict(),
  ]),
}).strict()

/** Local plugin route call timeout, mirroring the Harness API bridge budget. */
const PLUGIN_ROUTE_TIMEOUT_MS = 30_000
const LONG_POLL_TIMEOUT_MS = 45_000
const SLOW_BOT_OPERATION_TIMEOUT_MS = 60_000
const SLOW_BOT_OPERATIONS = new Set([
  'send',
  'connector-add',
  'connector-connect',
  'connector-retry',
  'connector-sign-in-code',
])
const COMPUTER_APPEARANCE_KEYS = new Set([
  'css', 'mode', 'uiFont', 'codeFont', 'fontSize', 'lineHeight', 'material',
])
const REMOTE_STATE_OMIT_KEYS = new Set([
  'userQuestions', 'sessionQueues', 'api', 'telemetryPrompt', 'releaseNotes',
])

function timeoutForEndpoint(endpoint: string): number {
  if (endpoint === 'im-login-wait') return LONG_POLL_TIMEOUT_MS
  if (SLOW_BOT_OPERATIONS.has(endpoint)) return SLOW_BOT_OPERATION_TIMEOUT_MS
  return PLUGIN_ROUTE_TIMEOUT_MS
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeBotRequestBody(
  body: { endpoint: string; payload?: Record<string, unknown> | null },
): { endpoint: string; payload?: Record<string, unknown> | null } {
  const payload = isPlainRecord(body.payload) ? body.payload : undefined
  if (body.endpoint === 'approval-answer') {
    const choice = payload?.choice
    if (choice !== 'allow' && choice !== 'reject') {
      throw new RpcError('INVALID_MESSAGE', 'The approval choice is invalid for the remote channel.')
    }
  }
  if (body.endpoint === 'image' && typeof payload?.parent === 'string' && payload.parent.trim() !== '') {
    throw new RpcError('INVALID_MESSAGE', 'Session logs are read on the computer.')
  }
  if (body.endpoint === 'set-prefs' && payload !== undefined) {
    const hasCss = Object.hasOwn(payload, 'css')
    const rawAppearance = isPlainRecord(payload.appearance) ? payload.appearance : undefined
    const hasRestrictedAppearance = rawAppearance !== undefined
      && Object.keys(rawAppearance).some(key => COMPUTER_APPEARANCE_KEYS.has(key))
    if (hasCss || hasRestrictedAppearance) {
      const nextPayload: Record<string, unknown> = { ...payload }
      delete nextPayload.css
      if (rawAppearance !== undefined) {
        const nextAppearance: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rawAppearance)) {
          if (!COMPUTER_APPEARANCE_KEYS.has(key)) nextAppearance[key] = value
        }
        nextPayload.appearance = nextAppearance
      }
      return { ...body, payload: nextPayload }
    }
  }
  return body
}

function sanitizeBotResponseJson(endpoint: string, json: unknown): unknown {
  if (!isPlainRecord(json) || json.ok !== true || !isPlainRecord(json.value)) return json
  if (endpoint === 'folders') {
    if (!Object.hasOwn(json.value, 'data')) return json
    const nextValue = { ...json.value }
    delete nextValue.data
    return { ...json, value: nextValue }
  }
  if (endpoint !== 'state') return json
  const value = json.value
  let nextValue: Record<string, unknown> | undefined
  const ensureCopy = () => {
    nextValue ??= { ...value }
    return nextValue
  }
  for (const key of REMOTE_STATE_OMIT_KEYS) {
    if (Object.hasOwn(value, key)) delete ensureCopy()[key]
  }
  if (isPlainRecord(value.phone) && Object.hasOwn(value.phone, 'pairing')) {
    const nextPhone = { ...value.phone }
    delete nextPhone.pairing
    ensureCopy().phone = nextPhone
  }
  if (isPlainRecord(value.work) && Array.isArray(value.work.approvals)
    && value.work.approvals.some(entry => isPlainRecord(entry) && Object.hasOwn(entry, 'alwaysAllow'))) {
    ensureCopy().work = {
      ...value.work,
      approvals: value.work.approvals.map(entry => {
        if (!isPlainRecord(entry) || !Object.hasOwn(entry, 'alwaysAllow')) return entry
        const copy = { ...entry }
        delete copy.alwaysAllow
        return copy
      }),
    }
  }
  return nextValue === undefined ? json : { ...json, value: nextValue }
}

/**
 * Forwards bounded POST calls to local plugin web routes (first case: ds-bot's
 * `api/bot`) through the shared fetch handler of the Host connection service.
 * The route allowlist and both size bounds keep the tunnel fail-closed.
 */
export type PluginRouteObserver = (
  route: string,
  body: { endpoint: string; payload?: Record<string, unknown> | null },
  result: PluginRouteCallResult,
) => void

export type LocalDsBotCall = (
  endpoint: string,
  payload: Record<string, unknown> | null,
  signal: AbortSignal,
) => Promise<{ ok: true; value: unknown } | { ok: false; code?: string }>

const TERMINAL_LOCAL_DS_BOT_CODES = new Set([
  'gateway/not-found',
  'gateway/invocation-unavailable',
  'METHOD_NOT_FOUND',
])

export class PluginRouteBridge {
  private dsBotRpcAvailable = true

  constructor(
    private readonly dispatch: PluginRouteDispatcher,
    private readonly logger?: SafeLogger,
    private readonly observer?: PluginRouteObserver,
    private readonly localDsBotCall?: LocalDsBotCall,
  ) {}

  async call(input: unknown, transferred = false): Promise<PluginRouteCallResult> {
    let params: PluginRouteCallParams
    try {
      params = (typeof input === 'object' && input !== null && 'route' in input
        && input.route === 'api/session/uploadFileBinary'
        ? imageUploadCallSchema.parse(input) : callSchema.parse(input)) as PluginRouteCallParams
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new RpcError('INVALID_MESSAGE', 'The plugin route call is invalid for the remote channel.')
      }
      throw error
    }
    if (serializedBytes(params) > (transferred && params.route === 'api/session/uploadFileBinary' ? MAX_HARNESS_API_TRANSFER_BYTES : MAX_SECURE_MESSAGE_BYTES)) {
      throw new RpcError('INVALID_MESSAGE', `The plugin route call exceeds the ${MAX_SECURE_MESSAGE_BYTES}-byte remote limit.`)
    }
    const dispatchBody = params.route === 'api/bot' ? sanitizeBotRequestBody(params.body) : params.body
    const timeoutMs = params.route === 'api/bot' ? timeoutForEndpoint(params.body.endpoint) : PLUGIN_ROUTE_TIMEOUT_MS
    const startedAt = performance.now()
    const signal = AbortSignal.timeout(timeoutMs)
    let result: { status: number; json: unknown } | undefined
    let fallbackToHttp = false
    if (params.route === 'api/bot' && this.localDsBotCall !== undefined && this.dsBotRpcAvailable) {
      try {
        const botBody = dispatchBody as { endpoint: string; payload?: Record<string, unknown> | null }
        const local = await this.localDsBotCall(botBody.endpoint, botBody.payload ?? null, signal)
        if (local.ok) {
          result = { status: 200, json: local.value }
        } else if (local.code !== undefined && TERMINAL_LOCAL_DS_BOT_CODES.has(local.code)) {
          this.dsBotRpcAvailable = false
          fallbackToHttp = true
        } else {
          this.logger?.warn('plugin route call failed', {
            route: params.route,
            durationMs: Math.round(performance.now() - startedAt),
          })
          const rpcCode = local.code === 'gateway/timeout' || local.code === 'TIMEOUT' ? 'TIMEOUT' : 'INTERNAL_ERROR'
          throw new RpcError(rpcCode, 'The local DS-Bot call failed.')
        }
      } catch (error) {
        if (!fallbackToHttp) {
          if (error instanceof RpcError) throw error
          this.logger?.warn('plugin route call failed', {
            route: params.route,
            durationMs: Math.round(performance.now() - startedAt),
          })
          throw new RpcError(signal.aborted ? 'TIMEOUT' : 'INTERNAL_ERROR', 'The local DS-Bot call failed.')
        }
      }
    }
    if (result === undefined && (fallbackToHttp || params.route !== 'api/bot' || this.localDsBotCall === undefined || !this.dsBotRpcAvailable)) {
      try {
        result = await this.dispatch(params.route, dispatchBody, signal)
      } catch (error) {
        this.logger?.warn('plugin route call failed', {
          route: params.route,
          durationMs: Math.round(performance.now() - startedAt),
        })
        throw error
      }
    }
    if (result === undefined) {
      throw new RpcError('INTERNAL_ERROR', 'The plugin route call produced no result.')
    }
    const sanitizedJson = params.route === 'api/bot' && result.status === 200
      ? sanitizeBotResponseJson(params.body.endpoint, result.json)
      : result.json
    const output: PluginRouteCallResult = { status: result.status, json: sanitizedJson }
    if (serializedBytes(output) > MAX_SECURE_MESSAGE_BYTES) {
      throw new RpcError('RESPONSE_TOO_LARGE', 'The plugin route response exceeds the bounded remote limit.')
    }
    this.logger?.debug('plugin route call ok', {
      route: params.route,
      status: output.status,
      durationMs: Math.round(performance.now() - startedAt),
    })
    if (this.observer !== undefined) {
      try {
        this.observer(params.route, dispatchBody, output)
      } catch {
        // Live observation must never fail a plugin route call.
      }
    }
    return output
  }
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
