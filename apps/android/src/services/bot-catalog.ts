import type { RemoteSession } from '../types'
import { strings } from '../locales/i18n'

export type BotObject = Record<string, unknown>
export interface BotEntry {
  id: string
  sessionId: string
  parts?: string[]
  name: string
  role: string
  instructions: string
  model: string
  appliedModel?: string
  effort: string
  engine?: string
  workDir?: string
  permission?: string
  private?: boolean
  browserGrants?: BotObject[]
  capabilities?: string[]
  color?: string
  avatar?: { shape?: string; image?: string }
  preview?: string
  main: boolean
  tile?: boolean
  pinned?: boolean
  hidden?: boolean
  waiting?: boolean
  createdAt?: number
}
export interface BotRoom {
  preview?: string
  id: string
  sessionId: string
  ownParts?: string[]
  parts?: string[]
  name: string
  members: string[]
  notice: string
  admin: string
  mode?: string
  workDir?: string
  permission?: string
  paused?: boolean
  pinned?: boolean
  hidden?: boolean
  goal?: BotObject
  createdAt?: number
}
export interface BotAgent {
  id: string
  sessions: string[]
  pinned?: boolean
  createdAt?: number
}
export interface BotState {
  revision?: number
  liveKey?: string
  modelsKey?: string
  workspaceId?: string
  mainBotId?: string
  mainBotIds?: string[]
  bots: BotEntry[]
  rooms: BotRoom[]
  agents: BotAgent[]
  exchangeTurns: BotObject
  btwCards: BotObject
  btwSupported: boolean
  sideChats: BotObject
  activity: BotObject
  work: {
    bots: BotObject
    rooms: BotObject
    waiting: BotObject
    turns: BotObject
    steered: BotObject
  }
  questions: BotObject
  views: BotObject
  closedCards: BotObject
  imVia: BotObject
  connectorRequests: BotObject
  mailRequests: BotObject
  computer?: BotObject
  computerLive?: BotObject
  prefs?: BotObject
  browser?: boolean
  memory?: boolean
  permissions?: BotObject
  secrets?: BotObject[]
  capabilities?: BotObject[]
  capabilityStatuses?: BotObject
  connectors?: BotObject
  im?: BotObject
  imStatus?: BotObject
  privateArchives?: BotObject[]
  colors?: string[]
  approvals: BotObject[]
  models: BotObject[]
  defaultModel?: string
  readOnly?: string
}

// Android only exposes the reviewed Bot workflows, never arbitrary plugin routes.
export const BOT_OPERATIONS = [
  'state', 'models', 'efforts', 'providers', 'local-agents',
  'exchange', 'exchange-text', 'file-text', 'earlier', 'chat', 'run-stats', 'thinking', 'usage', 'room-progress', 'group-rows',
  'schedules', 'schedule-create', 'schedule-delete',
  'memory-view', 'memory-history', 'memory-ask', 'memory-forget', 'memory-restore',
  'folders', 'folder-list', 'team-workspace', 'set-prefs',
  'browser-takeover', 'browser-give-back', 'browser-stop',
  'create-bot', 'duplicate-bot', 'update-bot', 'delete-bot', 'set-main', 'set-flags', 'resume', 'bot-new-part', 'bot-open-part',
  'create-room', 'update-room', 'delete-room', 'stop-room-work', 'goal-draft', 'goal-control',
  'add-agent', 'agent-session', 'agent-adopt', 'agent-archive', 'agent-rename', 'remove-agent',
  'send', 'btw', 'btw-cancel', 'btw-delete', 'side-new', 'side-ask', 'side-cancel', 'side-close',
  'room-continue', 'answer-question', 'dismiss-question', 'dismiss-view', 'view-reply', 'approval-answer', 'stop-member-work',
] as const
export type BotOperation = typeof BOT_OPERATIONS[number]

export class BotRemoteClient {
  constructor(
    private readonly dispatch: (body: { endpoint: BotOperation; payload: BotObject | null }, signal?: AbortSignal) => Promise<unknown>,
    private readonly readSessions: () => Promise<RemoteSession[]>,
    private readonly assertCurrent: () => void,
  ) {}

  async call(endpoint: BotOperation, payload: BotObject | null = null, signal?: AbortSignal): Promise<unknown> {
    this.assertCurrent()
    checkAborted(signal)
    if (!(BOT_OPERATIONS as readonly string[]).includes(endpoint)
      || (payload !== null && !isBotObject(payload))
      || (endpoint === 'approval-answer' && payload?.choice !== 'allow' && payload?.choice !== 'reject')) {
      throw new Error(strings.bots.operationDenied)
    }
    const response = await this.dispatch({ endpoint, payload }, signal)
    this.assertCurrent()
    checkAborted(signal)
    if (!isBotObject(response)) throw new Error(strings.bots.invalid)
    if (response.status === 404) throw new Error(strings.bots.notInstalled)
    if (response.status === 503) throw new Error(strings.bots.unsupported)
    if (response.status !== 200 || !isBotObject(response.json)) throw new Error(strings.bots.unavailable)
    const envelope = response.json
    if (envelope.ok !== true) {
      const error = object(envelope.error)
      if (error.code === 'bot/stale') throw new Error(strings.bots.stale)
      throw new Error(typeof error.message === 'string' ? error.message : strings.bots.unavailable)
    }
    return envelope.value
  }

  async state(signal?: AbortSignal, withPreviews = false, previous?: BotState): Promise<BotState> {
    const canIncremental = previous?.revision !== undefined && previous?.liveKey !== undefined
    const query = canIncremental
      ? {
          since: previous.revision,
          ...(previous.modelsKey !== undefined ? { models: previous.modelsKey } : {}),
          live: previous.liveKey,
        }
      : null
    const raw = await this.call('state', query, signal)
    if (canIncremental) {
      const merged = mergeBotStateDelta(previous, raw)
      if (merged !== undefined) {
        if (!withPreviews) return merged
        return attachStatePreviews(merged, await this.readSessions(), () => {
          this.assertCurrent()
          checkAborted(signal)
        })
      }
    }
    const parsed = parseBotState(raw)
    const state = previous !== undefined
      ? preserveIncrementalFields(parsed, previous, raw, !withPreviews)
      : parsed
    if (!withPreviews) return state
    return attachStatePreviews(state, await this.readSessions(), () => {
      this.assertCurrent()
      checkAborted(signal)
    })
  }

  /** Resolve only a current Bot/group returned by this Host, against its official catalog. */
  async resolveSession(id: string, signal?: AbortSignal): Promise<{ state: BotState; session: RemoteSession }> {
    const state = await this.state(signal)
    const bot = state.bots.find(entry => entry.id === id)
    const room = state.rooms.find(entry => entry.id === id)
    const agentSession = state.agents.flatMap(entry => entry.sessions).find(sessionId => sessionId === id)
    const sessionId = bot?.sessionId ?? (room ? (room.sessionId || room.id) : agentSession)
    if (sessionId === undefined) throw new Error(strings.bots.sessionUnavailable)
    const sessions = await this.readSessions()
    this.assertCurrent()
    checkAborted(signal)
    const session = sessions.find(item => item.sessionId === sessionId && (item.backend ?? 'harness') === 'harness')
    if (session === undefined) throw new Error(strings.bots.sessionUnavailable)
    return { state, session }
  }
}

export function parseBotState(value: unknown): BotState {
  if (!isBotObject(value) || !Array.isArray(value.bots) || !Array.isArray(value.rooms)) throw new Error(strings.bots.invalid)
  const hasExplicitMainIds = Array.isArray(value.mainBotIds) || nonempty(value.mainBotId)
  const mainBotIds = Array.isArray(value.mainBotIds)
    ? value.mainBotIds.filter(nonempty)
    : nonempty(value.mainBotId)
      ? [value.mainBotId]
      : []
  const mainBotId = nonempty(value.mainBotId) ? value.mainBotId : mainBotIds[0]
  const bots = value.bots.map(entry => {
    if (!isBotObject(entry) || !nonempty(entry.id) || !nonempty(entry.sessionId)) throw new Error(strings.bots.invalid)
    const avatarObj = object(entry.avatar)
    return {
      id: entry.id,
      sessionId: entry.sessionId,
      ...(Array.isArray(entry.parts) ? { parts: entry.parts.filter(nonempty) } : {}),
      name: text(entry.name) || entry.id,
      color: text(entry.color),
      avatar: { shape: text(avatarObj.shape), ...(nonempty(avatarObj.image) ? { image: avatarObj.image } : {}) },
      role: text(entry.role),
      instructions: text(entry.instructions),
      model: text(entry.model),
      ...(nonempty(entry.appliedModel) ? { appliedModel: entry.appliedModel } : {}),
      effort: text(entry.effort),
      ...(nonempty(entry.engine) ? { engine: entry.engine } : {}),
      ...(nonempty(entry.workDir) ? { workDir: entry.workDir } : {}),
      ...(nonempty(entry.permission) ? { permission: entry.permission } : {}),
      ...(entry.private === true ? { private: true } : {}),
      ...(Array.isArray(entry.browserGrants) ? { browserGrants: objects(entry.browserGrants) } : {}),
      ...(Array.isArray(entry.capabilities) ? { capabilities: entry.capabilities.filter(nonempty) } : {}),
      main: hasExplicitMainIds ? mainBotIds.includes(entry.id) : entry.main === true,
      tile: mainBotId === entry.id,
      ...(entry.pinned === true ? { pinned: true } : {}),
      ...(entry.hidden === true ? { hidden: true } : {}),
      ...(entry.waiting === true ? { waiting: true } : {}),
      ...(typeof entry.createdAt === 'number' ? { createdAt: entry.createdAt } : {}),
    }
  })
  const rooms = value.rooms.map(entry => {
    if (!isBotObject(entry) || !nonempty(entry.id) || !Array.isArray(entry.members) || !entry.members.every(nonempty)) throw new Error(strings.bots.invalid)
    const sessionId = text(entry.sessionId) || entry.id
    return {
      preview: compactPreview(text(entry.preview)),
      id: entry.id,
      sessionId,
      ...(Array.isArray(entry.ownParts) ? { ownParts: entry.ownParts.filter(nonempty) } : {}),
      ...(Array.isArray(entry.parts) ? { parts: entry.parts.filter(nonempty) } : {}),
      name: text(entry.name) || entry.id,
      members: entry.members as string[],
      notice: text(entry.notice),
      admin: text(entry.admin),
      ...(nonempty(entry.mode) ? { mode: entry.mode } : {}),
      ...(nonempty(entry.workDir) ? { workDir: entry.workDir } : {}),
      ...(nonempty(entry.permission) ? { permission: entry.permission } : {}),
      paused: objects(entry.paused).length > 0 || entry.paused === true,
      ...(entry.pinned === true ? { pinned: true } : {}),
      ...(entry.hidden === true ? { hidden: true } : {}),
      ...(isBotObject(entry.goal) ? { goal: entry.goal } : {}),
      ...(typeof entry.createdAt === 'number' ? { createdAt: entry.createdAt } : {}),
    }
  })
  const agents = Array.isArray(value.agents)
    ? value.agents.filter(isBotObject).filter(entry => nonempty(entry.id)).map(entry => ({
        id: entry.id as string,
        sessions: Array.isArray(entry.sessions) ? entry.sessions.filter(nonempty) : [],
        ...(entry.pinned === true ? { pinned: true } : {}),
        ...(typeof entry.createdAt === 'number' ? { createdAt: entry.createdAt } : {}),
      }))
    : []
  const ids = [...bots, ...rooms].map(entry => entry.id)
  if (new Set(ids).size !== ids.length) throw new Error(strings.bots.invalid)
  const workObj = object(value.work)
  return {
    ...(typeof value.revision === 'number' ? { revision: value.revision } : {}),
    ...(nonempty(value.liveKey) ? { liveKey: value.liveKey } : {}),
    ...(nonempty(value.modelsKey) ? { modelsKey: value.modelsKey } : {}),
    ...(nonempty(value.workspaceId) ? { workspaceId: value.workspaceId } : {}),
    ...(mainBotId !== undefined ? { mainBotId } : {}),
    ...(mainBotIds.length > 0 ? { mainBotIds } : {}),
    bots,
    rooms,
    agents,
    btwCards: object(value.btwCards),
    btwSupported: isBotObject(value.btwCards),
    sideChats: object(value.sideChats),
    exchangeTurns: object(value.exchangeTurns),
    activity: object(value.activity),
    work: {
      bots: object(workObj.bots),
      rooms: object(workObj.rooms),
      waiting: object(workObj.waiting),
      turns: object(workObj.turns),
      steered: object(workObj.steered),
    },
    questions: object(value.questions),
    views: object(value.views),
    closedCards: object(value.closedCards),
    imVia: object(value.imVia),
    connectorRequests: object(value.connectorRequests),
    mailRequests: object(value.mailRequests),
    ...(isBotObject(value.computer) ? { computer: value.computer } : {}),
    ...(isBotObject(value.computerLive) ? { computerLive: value.computerLive } : {}),
    ...(isBotObject(value.prefs) ? { prefs: value.prefs } : {}),
    ...(typeof value.browser === 'boolean' ? { browser: value.browser } : {}),
    ...(typeof value.memory === 'boolean' ? { memory: value.memory } : {}),
    ...(isBotObject(value.permissions) ? { permissions: value.permissions } : {}),
    ...(Array.isArray(value.secrets) ? { secrets: objects(value.secrets) } : {}),
    ...(Array.isArray(value.capabilities) ? { capabilities: objects(value.capabilities) } : {}),
    ...(isBotObject(value.capabilityStatuses) ? { capabilityStatuses: value.capabilityStatuses } : {}),
    ...(isBotObject(value.connectors) ? { connectors: value.connectors } : {}),
    ...(isBotObject(value.im) ? { im: value.im } : {}),
    ...(isBotObject(value.imStatus) ? { imStatus: value.imStatus } : {}),
    ...(Array.isArray(value.privateArchives) ? { privateArchives: objects(value.privateArchives) } : {}),
    ...(Array.isArray(value.colors) ? { colors: value.colors.filter(nonempty) } : {}),
    approvals: objects(workObj.approvals),
    models: objects(value.models),
    ...(nonempty(value.defaultModel) ? { defaultModel: value.defaultModel } : {}),
    ...(typeof value.readOnly === 'string' ? { readOnly: value.readOnly } : {}),
  }
}

function attachStatePreviews(state: BotState, sessions: RemoteSession[], verify: () => void): BotState {
  verify()
  const catalog = new Map(sessions.filter(entry => (entry.backend ?? 'harness') === 'harness').map(entry => [entry.sessionId, entry]))
  return {
    ...state,
    bots: state.bots.map(bot => ({
      ...bot,
      preview: sessionPreview(catalog.get(bot.sessionId), state.exchangeTurns[bot.sessionId]),
    })),
    rooms: state.rooms.map(room => ({
      ...room,
      preview: room.preview || sessionPreview(catalog.get(room.sessionId || room.id)),
    })),
  }
}

function preserveIncrementalFields(
  next: BotState,
  previous: BotState,
  raw: unknown,
  keepPreviews: boolean,
): BotState {
  const rawObj = isBotObject(raw) ? raw : {}
  const omitModels = !Array.isArray(rawObj.models)
  const prevBotPreviews = keepPreviews ? new Map(previous.bots.map(b => [b.id, b.preview])) : undefined
  const prevRoomPreviews = keepPreviews ? new Map(previous.rooms.map(r => [r.id, r.preview])) : undefined
  return {
    ...next,
    ...(omitModels ? {
      models: previous.models,
      ...(next.modelsKey === undefined && previous.modelsKey !== undefined ? { modelsKey: previous.modelsKey } : {}),
      ...(next.defaultModel === undefined && previous.defaultModel !== undefined ? { defaultModel: previous.defaultModel } : {}),
    } : {}),
    ...(prevBotPreviews ? {
      bots: next.bots.map(bot => ({
        ...bot,
        preview: bot.preview || prevBotPreviews.get(bot.id),
      })),
    } : {}),
    ...(prevRoomPreviews ? {
      rooms: next.rooms.map(room => ({
        ...room,
        preview: room.preview || prevRoomPreviews.get(room.id),
      })),
    } : {}),
  }
}

export function mergeBotStateDelta(previous: BotState, raw: unknown): BotState | undefined {
  if (!isBotObject(raw) || raw.unchanged !== true) return undefined
  const nextRevision = typeof raw.revision === 'number' ? raw.revision : previous.revision
  const nextLiveKey = nonempty(raw.liveKey) ? raw.liveKey : previous.liveKey
  const hasLiveFields =
    raw.activity !== undefined
    || raw.work !== undefined
    || raw.computerLive !== undefined
    || raw.btwCards !== undefined
    || raw.sideChats !== undefined
    || raw.connectors !== undefined
    || raw.capabilityStatuses !== undefined
    || raw.imStatus !== undefined
    || raw.imVia !== undefined
  if (!hasLiveFields && nextRevision === previous.revision && nextLiveKey === previous.liveKey) {
    return previous
  }
  const nextWorkObj = raw.work !== undefined ? object(raw.work) : undefined
  return {
    ...previous,
    ...(nextRevision !== undefined ? { revision: nextRevision } : {}),
    ...(nextLiveKey !== undefined ? { liveKey: nextLiveKey } : {}),
    ...(raw.activity !== undefined ? { activity: object(raw.activity) } : {}),
    ...(nextWorkObj !== undefined ? {
      work: {
        bots: object(nextWorkObj.bots),
        rooms: object(nextWorkObj.rooms),
        waiting: object(nextWorkObj.waiting),
        turns: object(nextWorkObj.turns),
        steered: object(nextWorkObj.steered),
      },
      approvals: objects(nextWorkObj.approvals),
    } : {}),
    ...(raw.computerLive !== undefined ? { computerLive: object(raw.computerLive) } : {}),
    ...(raw.btwCards !== undefined ? { btwCards: object(raw.btwCards), btwSupported: isBotObject(raw.btwCards) } : {}),
    ...(raw.sideChats !== undefined ? { sideChats: object(raw.sideChats) } : {}),
    ...(raw.connectors !== undefined ? { connectors: object(raw.connectors) } : {}),
    ...(raw.capabilityStatuses !== undefined ? { capabilityStatuses: object(raw.capabilityStatuses) } : {}),
    ...(raw.imStatus !== undefined ? { imStatus: object(raw.imStatus) } : {}),
    ...(raw.imVia !== undefined ? { imVia: object(raw.imVia) } : {}),
  }
}
export function isBotObject(value: unknown): value is BotObject { return value !== null && typeof value === 'object' && !Array.isArray(value) }
export function object(value: unknown): BotObject { return isBotObject(value) ? value : {} }
export function objects(value: unknown): BotObject[] { return Array.isArray(value) ? value.filter(isBotObject) : [] }
export function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }

// React Native's abort-controller implements aborted/events, not throwIfAborted.
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
}

// Match the native Bot sidebar: latest visible response, then prompt; never internal exchanges.
function sessionPreview(session?: RemoteSession, hiddenTurns: unknown = []): string {
  const hidden = Array.isArray(hiddenTurns) ? hiddenTurns : []
  const outline = objects(session?.projections?.values?.turnOutline)
  for (let i = outline.length - 1; i >= 0; i--) {
    const turn = outline[i]!
    if (hidden.includes(turn.turn)) continue
    const value = text(turn.response) || text(turn.prompt)
    if (value) return compactPreview(value.replace(/^\[(Message from|Reply from|Group chat|Group post from|Bot team setup|Handoff · part|Secret card)(?:[^\r\n]*\]\r?\n|[^\]\r\n]*\])/, ''))
  }
  return ''
}
function compactPreview(value: string): string { return value.replace(/\s+/g, ' ').trim().slice(0, 240) }

/** Combine staged reference mentions with a Bot composer draft without breaking leading /btw commands. */
export function formatBotSubmission(rawDraft: string, referenceMentions: readonly string[]): string {
  const trimmed = rawDraft.trim()
  const prefix = referenceMentions.map(item => item.trim()).filter(Boolean).join(' ')
  if (/^\/btw(?:\s|$)/.test(trimmed)) {
    return ['/btw', prefix, trimmed.slice(4).trim()].filter(Boolean).join(' ')
  }
  return [prefix, trimmed].filter(Boolean).join(' ')
}

/** Claim /btw before normal sending; refusals never become queued prompts. */
export function botMessageRequest(state: BotState, targetId: string, draft: string): { endpoint: BotOperation; payload: BotObject } {
  const message = draft.trim()
  const bot = state.bots.find(entry => entry.id === targetId || entry.sessionId === targetId)
  const room = state.rooms.find(entry => entry.id === targetId || entry.sessionId === targetId)
  const isAgentSession = (state.agents ?? []).some(entry => entry.sessions.includes(targetId))
  if ((!bot && !room && !isAgentSession) || state.readOnly !== undefined || !message) throw new Error(strings.bots.sessionUnavailable)
  const aside = /^\/btw(?:\s|$)/.test(message)
  if (aside) {
    if (!bot) throw new Error(strings.bots.btwPrivate)
    if (!state.btwSupported) throw new Error(strings.bots.btwUnsupported)
    const question = message.slice(4).trim()
    if (!question) throw new Error(strings.bots.btwEmpty)
    return { endpoint: 'btw', payload: { sessionId: bot.id, text: question } }
  }
  const resolvedTargetId = bot?.id ?? room?.id ?? targetId
  return { endpoint: 'send', payload: { sessionId: resolvedTargetId, text: message } }
}

/**
 * Whether a Bot can be deleted: non-main Bots can always be deleted; a Main Bot
 * can be deleted when another Main Bot exists or another non-private Bot can
 * take over the Main Bot role first.
 */
export function canDeleteBot(state: BotState | undefined, bot: BotEntry | undefined): boolean {
  if (!state || !bot || state.readOnly !== undefined) return false
  if (!bot.main) return true
  const mainCount = state.bots.filter(entry => entry.main).length
  if (mainCount > 1) return true
  return state.bots.some(entry => entry.id !== bot.id && !entry.private)
}

const knownBotSessionIdsByScope = new Map<string, Set<string>>()

function scopeSet(scope: string): Set<string> {
  let set = knownBotSessionIdsByScope.get(scope)
  if (!set) {
    set = new Set<string>()
    knownBotSessionIdsByScope.set(scope, set)
  }
  return set
}

export function markScopedBotSessionId(sessionId: string | undefined, scope: string): void {
  if (!sessionId || !scope) return
  scopeSet(scope).add(sessionId)
}

export function trackScopedBotStateSessions(state: BotState | undefined, scope: string): void {
  if (!state || !scope) return
  const target = scopeSet(scope)
  for (const bot of state.bots) {
    if (bot.id) target.add(bot.id)
    if (bot.sessionId) target.add(bot.sessionId)
    if (bot.parts) {
      for (const part of bot.parts) {
        if (part) target.add(part)
      }
    }
  }
  for (const room of state.rooms) {
    const primarySessionId = room.sessionId || room.id
    if (primarySessionId) target.add(primarySessionId)
    if (room.ownParts) {
      for (const part of room.ownParts) {
        if (part) target.add(part)
      }
    }
  }
}

export function isScopedKnownBotSessionId(
  sessionId: string | undefined,
  scope: string,
  state?: BotState,
): boolean {
  if (!sessionId || !scope) return false
  if (state) {
    trackScopedBotStateSessions(state, scope)
  }
  return knownBotSessionIdsByScope.get(scope)?.has(sessionId) ?? false
}

export function resolveBotTargetSessionId(
  state: BotState | undefined,
  selectedId: string | undefined,
): string | undefined {
  if (!state || !selectedId) return undefined
  const bot = state.bots.find(entry => entry.id === selectedId)
  if (bot) return bot.sessionId
  const room = state.rooms.find(entry => entry.id === selectedId)
  if (room) return room.sessionId || room.id
  const isAgentSession = state.agents.some(agent => agent.sessions.includes(selectedId))
  return isAgentSession ? selectedId : undefined
}

export function botSessionOwnerKey(
  scope: string,
  connectionEpoch: number,
  selectedId: string | undefined,
  targetSessionId: string | undefined,
): string | undefined {
  if (!scope || !selectedId || !targetSessionId) return undefined
  return `${scope}|epoch:${connectionEpoch}|${selectedId}|${targetSessionId}`
}
