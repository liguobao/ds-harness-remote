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
  name: string
  members: string[]
  notice: string
  admin: string
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
  mainBotId?: string
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
  approvals: BotObject[]
  models: BotObject[]
  defaultModel?: string
  readOnly?: string
}

// Android only exposes the reviewed Bot workflows, never arbitrary plugin routes.
export const BOT_OPERATIONS = [
  'state', 'models', 'efforts', 'exchange', 'exchange-text', 'file-text', 'earlier', 'chat', 'run-stats', 'thinking', 'usage', 'room-progress', 'schedules',
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

  async state(signal?: AbortSignal, withPreviews = false): Promise<BotState> {
    const state = parseBotState(await this.call('state', null, signal))
    if (!withPreviews) return state
    const sessions = await this.readSessions()
    this.assertCurrent()
    checkAborted(signal)
    const catalog = new Map(sessions.filter(entry => (entry.backend ?? 'harness') === 'harness').map(entry => [entry.sessionId, entry]))
    for (const bot of state.bots) bot.preview = sessionPreview(catalog.get(bot.sessionId), state.exchangeTurns[bot.sessionId])
    for (const room of state.rooms) room.preview ||= sessionPreview(catalog.get(room.sessionId || room.id))
    return state
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
      main: mainBotIds.includes(entry.id),
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
      name: text(entry.name) || entry.id,
      members: entry.members as string[],
      notice: text(entry.notice),
      admin: text(entry.admin),
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
    ...(mainBotId !== undefined ? { mainBotId } : {}),
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
    approvals: objects(workObj.approvals),
    models: objects(value.models),
    ...(nonempty(value.defaultModel) ? { defaultModel: value.defaultModel } : {}),
    ...(typeof value.readOnly === 'string' ? { readOnly: value.readOnly } : {}),
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

/** Claim /btw before normal sending; refusals never become queued prompts. */
export function botMessageRequest(state: BotState, targetId: string, draft: string): { endpoint: BotOperation; payload: BotObject } {
  const message = draft.trim()
  const bot = state.bots.find(entry => entry.id === targetId)
  const room = state.rooms.find(entry => entry.id === targetId)
  if ((!bot && !room) || state.readOnly !== undefined || !message) throw new Error(strings.bots.sessionUnavailable)
  const aside = /^\/btw(?:\s|$)/.test(message)
  if (aside) {
    if (!bot) throw new Error(strings.bots.btwPrivate)
    if (!state.btwSupported) throw new Error(strings.bots.btwUnsupported)
    const question = message.slice(4).trim()
    if (!question) throw new Error(strings.bots.btwEmpty)
    return { endpoint: 'btw', payload: { sessionId: bot.id, text: question } }
  }
  return { endpoint: 'send', payload: { sessionId: targetId, text: message } }
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
