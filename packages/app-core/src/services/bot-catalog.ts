import type { RemoteSession } from '../types'
import { strings } from '../locales/i18n'

export type BotObject = Record<string, unknown>
export interface BotEntry {
  id: string
  sessionId: string
  parts?: string[]
  tasks?: BotObject[]
  extraDirs?: string[]
  blocked?: BotObject
  failures?: BotObject
  sessionMissing?: boolean
  agentPreset?: string
  packs?: BotObject
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
  avatar?: { shape?: string; image?: string; imageRef?: string }
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
  extraDirs?: string[]
  permission?: string
  avatar?: { image?: string; imageRef?: string }
  idlePaused?: BotObject
  paused?: boolean
  pinned?: boolean
  hidden?: boolean
  goal?: BotObject
  todos?: BotObject[]
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
  sections?: BotObject[]
  exchangeTurns: BotObject
  btwCards: BotObject
  btwSupported: boolean
  parallelSessionsSupported?: boolean
  sideChatsSupported?: boolean
  sideChats: BotObject
  activity: BotObject
  work: {
    bots: BotObject
    rooms: BotObject
    waiting: BotObject
    turns: BotObject
    steered: BotObject
    paused?: BotObject | BotObject[]
    canBackground?: BotObject
    activeRooms?: string[]
  }
  questions: BotObject
  views: BotObject
  closedCards: BotObject
  imVia: BotObject
  connectorRequests: BotObject
  mailRequests: BotObject
  secretRequests?: BotObject
  browserHolds?: BotObject
  learning?: BotObject
  approvalReviews?: BotObject[]
  botTails?: BotObject
  inbox?: BotObject
  computer?: BotObject
  computerLive?: BotObject
  prefs?: BotObject
  browser?: boolean
  memory?: boolean
  permissions?: BotObject
  secrets?: BotObject[]
  secretStore?: BotObject
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
  'state', 'hello', 'avatar', 'avatar-library', 'avatar-import', 'avatar-delete',
  'models', 'efforts', 'presets', 'providers', 'local-agents',
  'exchange', 'exchange-text', 'file-text', 'file-download', 'image', 'markdown-image',
  'earlier', 'chat', 'room-chat', 'run-stats', 'thinking', 'usage', 'usage-summary',
  'room-progress', 'group-rows', 'group-relay-replies', 'room-todo',
  'schedules', 'schedule-create', 'schedule-delete', 'schedule-pause',
  'memory-view', 'memory-history', 'memory-ask', 'memory-forget', 'memory-restore',
  'memory-add', 'memory-edit', 'memory-pin', 'memory-layer', 'memory-move', 'memory-tidy-undo',
  'folders', 'folder-list', 'team-workspace', 'set-prefs',
  'browser-frame', 'browser-takeover', 'browser-give-back', 'browser-stop',
  'computer-stop', 'computer-app-answer',
  'create-bot', 'duplicate-bot', 'update-bot', 'delete-bot', 'set-main', 'set-flags',
  'resume', 'new-part', 'recover-session', 'private-release',
  'bot-move-to-background', 'bot-steer-queue', 'bot-stop-task', 'bot-task-send', 'bot-task-read',
  'create-room', 'update-room', 'delete-room', 'stop-room-work', 'resume-room-pause',
  'resume-work', 'cancel-work', 'goal-draft', 'goal-control',
  'add-agent', 'agent-session', 'agent-adopt', 'agent-archive', 'agent-rename', 'remove-agent',
  'send', 'stage-image', 'stage-file',
  'btw-delete', 'side-new', 'side-ask', 'side-cancel', 'side-close',
  'answer-question', 'dismiss-question', 'dismiss-view', 'view-reply', 'approval-answer', 'stop-member-work',
  'learning-answer', 'secret-allow', 'secret-cancel', 'secret-set', 'secret-delete', 'secret-refresh-external',
  'mail-send-answer', 'connector-request-cancel', 'connector-disconnect', 'connector-retry',
  // Legacy compat for DS-Bot <0.4.0 Hosts.
  'btw', 'btw-cancel', 'room-continue', 'bot-new-part', 'bot-open-part',
] as const
export type BotOperation = typeof BOT_OPERATIONS[number]

export interface BotHelloInfo {
  api: number | null
  capabilities: ReadonlySet<string>
  rpc?: { call: string; feed: string }
  revision?: number
  boot?: string
  seq?: number
}

export interface BotRpcTransport {
  call(endpoint: BotOperation, payload: BotObject | null, signal?: AbortSignal): Promise<unknown>
  openFeed(signal?: AbortSignal): Promise<AsyncIterable<{ event: string; data: unknown }>>
}

export class BotRemoteClient {
  private readonly avatarCache = new Map<string, string>()
  private helloPromise?: Promise<BotHelloInfo | null>
  private helloInfo?: BotHelloInfo | null
  private useRpcCall = false

  constructor(
    private readonly dispatch: (body: { endpoint: BotOperation; payload: BotObject | null }, signal?: AbortSignal) => Promise<unknown>,
    private readonly readSessions: () => Promise<RemoteSession[]>,
    private readonly assertCurrent: () => void,
    private readonly rpcTransport?: BotRpcTransport,
  ) {}

  hasCapability(name: string): boolean {
    return this.helloInfo?.capabilities.has(name) ?? false
  }

  supportsFeed(): boolean {
    return Boolean(
      this.rpcTransport
      && (this.helloInfo?.capabilities.has('rpc') || this.helloInfo?.rpc?.feed === 'dsBot/feed'),
    )
  }

  async negotiate(signal?: AbortSignal): Promise<BotHelloInfo | null> {
    this.assertCurrent()
    checkAborted(signal)
    if (this.helloInfo !== undefined) return this.helloInfo
    if (this.helloPromise !== undefined) return this.helloPromise
    let pending: Promise<BotHelloInfo | null> | undefined
    pending = (async (): Promise<BotHelloInfo | null> => {
      try {
        const raw = await this.call('hello', { api: [1] }, signal)
        if (!isBotObject(raw)) {
          this.helloInfo = null
          return null
        }
        const capabilities = new Set(
          Array.isArray(raw.capabilities)
            ? raw.capabilities.filter((item): item is string => typeof item === 'string' && item.length > 0)
            : [],
        )
        const rpcObj = isBotObject(raw.rpc)
          && typeof raw.rpc.call === 'string'
          && typeof raw.rpc.feed === 'string'
          ? { call: raw.rpc.call, feed: raw.rpc.feed }
          : undefined
        const info: BotHelloInfo = {
          api: typeof raw.api === 'number' || raw.api === null ? raw.api : null,
          capabilities,
          ...(rpcObj !== undefined ? { rpc: rpcObj } : {}),
          ...(typeof raw.revision === 'number' ? { revision: raw.revision } : {}),
          ...(typeof raw.boot === 'string' ? { boot: raw.boot } : {}),
          ...(typeof raw.seq === 'number' ? { seq: raw.seq } : {}),
        }
        this.helloInfo = info
        if (this.rpcTransport !== undefined && (capabilities.has('rpc') || rpcObj?.call === 'dsBot/call')) {
          this.useRpcCall = true
        }
        return info
      } catch (error) {
        this.assertCurrent()
        checkAborted(signal)
        if (error instanceof Error && (
          error.message === strings.bots.notInstalled
          || error.message === strings.bots.unsupported
          || /unknown endpoint|not found/i.test(error.message)
        )) {
          this.helloInfo = null
          return null
        }
        this.helloInfo = null
        return null
      } finally {
        if (this.helloPromise === pending) this.helloPromise = undefined
      }
    })()
    this.helloPromise = pending
    return pending
  }

  async openFeed(signal?: AbortSignal): Promise<AsyncIterable<{ event: string; data: unknown }> | undefined> {
    await this.negotiate(signal)
    if (!this.supportsFeed()) return undefined
    return this.rpcTransport!.openFeed(signal)
  }

  async call(endpoint: BotOperation, payload: BotObject | null = null, signal?: AbortSignal): Promise<unknown> {
    this.assertCurrent()
    checkAborted(signal)
    if (!(BOT_OPERATIONS as readonly string[]).includes(endpoint)
      || (payload !== null && !isBotObject(payload))
      || (endpoint === 'approval-answer' && payload?.choice !== 'allow' && payload?.choice !== 'reject')) {
      throw new Error(strings.bots.operationDenied)
    }
    if (endpoint !== 'hello' && this.rpcTransport !== undefined) {
      if (this.helloPromise !== undefined) {
        await this.helloPromise
        this.assertCurrent()
        checkAborted(signal)
      } else if (
        this.helloInfo === undefined
        && (
          endpoint === 'stage-image'
          || endpoint === 'stage-file'
          || endpoint === 'file-download'
          || endpoint === 'image'
          || endpoint === 'markdown-image'
          || (payload !== null && JSON.stringify(payload).length > 1_500_000)
        )
      ) {
        await this.negotiate(signal)
        this.assertCurrent()
        checkAborted(signal)
      }
    }
    if (this.useRpcCall && this.rpcTransport !== undefined) {
      const response = await this.rpcTransport.call(endpoint, payload, signal)
      this.assertCurrent()
      checkAborted(signal)
      if (!isBotObject(response)) throw new Error(strings.bots.invalid)
      if (response.ok !== true) {
        const error = object(response.error)
        if (error.code === 'bot/stale') throw new Error(strings.bots.stale)
        throw new Error(typeof error.message === 'string' ? error.message : strings.bots.unavailable)
      }
      return response.value
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
    const query: BotObject = canIncremental
      ? {
          since: previous.revision,
          ...(previous.modelsKey !== undefined ? { models: previous.modelsKey } : {}),
          live: previous.liveKey,
          avatars: 'ref',
        }
      : { avatars: 'ref' }
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
    const preserved = previous !== undefined
      ? preserveIncrementalFields(parsed, previous, raw, !withPreviews)
      : parsed
    const hydrated = await this.hydrateAvatars(preserved, signal)
    if (!withPreviews) return hydrated
    return attachStatePreviews(hydrated, await this.readSessions(), () => {
      this.assertCurrent()
      checkAborted(signal)
    })
  }

  private async hydrateAvatars(state: BotState, signal?: AbortSignal): Promise<BotState> {
    const missing: Array<{ isRoom: boolean; id: string; ref: string }> = []
    const seenRefs = new Set<string>()
    const seedOrCollect = (isRoom: boolean, id: string, avatar?: { image?: string; imageRef?: string }) => {
      if (!avatar?.imageRef) return
      if (avatar.image) {
        this.avatarCache.set(avatar.imageRef, avatar.image)
        return
      }
      if (!this.avatarCache.has(avatar.imageRef) && !seenRefs.has(avatar.imageRef)) {
        seenRefs.add(avatar.imageRef)
        missing.push({ isRoom, id, ref: avatar.imageRef })
      }
    }
    for (const bot of state.bots) seedOrCollect(false, bot.id, bot.avatar)
    for (const room of state.rooms) seedOrCollect(true, room.id, room.avatar)

    if (missing.length > 0) {
      await Promise.all(
        missing.map(async item => {
          try {
            const payload = item.isRoom ? { roomId: item.id } : { botId: item.id }
            const res = object(await this.call('avatar', payload, signal))
            const image = text(res.image)
            const ref = text(res.ref) || item.ref
            if (image) this.avatarCache.set(ref, image)
          } catch {
            // Avatar hydration is best-effort and must never fail state loading.
          }
        }),
      )
    }

    let changed = false
    const bots = state.bots.map(bot => {
      const ref = bot.avatar?.imageRef
      if (!ref || bot.avatar?.image) return bot
      const cached = this.avatarCache.get(ref)
      if (!cached) return bot
      changed = true
      return { ...bot, avatar: { ...bot.avatar, image: cached } }
    })
    const rooms = state.rooms.map(room => {
      const ref = room.avatar?.imageRef
      if (!ref || room.avatar?.image) return room
      const cached = this.avatarCache.get(ref)
      if (!cached) return room
      changed = true
      return { ...room, avatar: { ...room.avatar, image: cached } }
    })
    return changed ? { ...state, bots, rooms } : state
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
      ...(Array.isArray(entry.tasks) ? { tasks: objects(entry.tasks) } : {}),
      ...(Array.isArray(entry.extraDirs) ? { extraDirs: entry.extraDirs.filter(nonempty) } : {}),
      ...(isBotObject(entry.blocked) ? { blocked: entry.blocked } : {}),
      ...(isBotObject(entry.failures) ? { failures: entry.failures } : {}),
      ...(entry.sessionMissing === true ? { sessionMissing: true } : {}),
      ...(nonempty(entry.agentPreset) ? { agentPreset: entry.agentPreset } : {}),
      ...(isBotObject(entry.packs) ? { packs: entry.packs } : {}),
      name: text(entry.name) || entry.id,
      color: text(entry.color),
      avatar: {
        shape: text(avatarObj.shape),
        ...(nonempty(avatarObj.image) ? { image: avatarObj.image } : {}),
        ...(nonempty(avatarObj.imageRef) ? { imageRef: avatarObj.imageRef } : {}),
      },
      ...(nonempty(entry.preview) ? { preview: compactPreview(text(entry.preview)) } : {}),
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
    const roomAvatarObj = isBotObject(entry.avatar) ? entry.avatar : undefined
    const roomAvatar = roomAvatarObj && (nonempty(roomAvatarObj.image) || nonempty(roomAvatarObj.imageRef))
      ? {
          ...(nonempty(roomAvatarObj.image) ? { image: roomAvatarObj.image } : {}),
          ...(nonempty(roomAvatarObj.imageRef) ? { imageRef: roomAvatarObj.imageRef } : {}),
        }
      : undefined
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
      ...(Array.isArray(entry.extraDirs) ? { extraDirs: entry.extraDirs.filter(nonempty) } : {}),
      ...(nonempty(entry.permission) ? { permission: entry.permission } : {}),
      ...(roomAvatar !== undefined ? { avatar: roomAvatar } : {}),
      ...(isBotObject(entry.idlePaused) ? { idlePaused: entry.idlePaused } : {}),
      paused: isBotObject(entry.idlePaused) || objects(entry.paused).length > 0 || entry.paused === true,
      ...(entry.pinned === true ? { pinned: true } : {}),
      ...(entry.hidden === true ? { hidden: true } : {}),
      ...(isBotObject(entry.goal) ? { goal: entry.goal } : {}),
      ...(Array.isArray(entry.todos) ? { todos: objects(entry.todos) } : {}),
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
  const hasUnifiedInbox = isBotObject(value.inbox)
  const hasTasks = bots.some(b => Array.isArray(b.tasks))
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
    ...(Array.isArray(value.sections) ? { sections: objects(value.sections) } : {}),
    btwCards: object(value.btwCards),
    btwSupported: isBotObject(value.btwCards) && !hasUnifiedInbox,
    parallelSessionsSupported: !(hasUnifiedInbox || hasTasks),
    sideChats: object(value.sideChats),
    sideChatsSupported: isBotObject(value.sideChats),
    exchangeTurns: object(value.exchangeTurns),
    activity: object(value.activity),
    work: {
      bots: object(workObj.bots),
      rooms: object(workObj.rooms),
      waiting: object(workObj.waiting),
      turns: object(workObj.turns),
      steered: object(workObj.steered),
      ...(Array.isArray(workObj.paused)
        ? { paused: objects(workObj.paused) }
        : isBotObject(workObj.paused)
          ? { paused: workObj.paused }
          : {}),
      ...(isBotObject(workObj.canBackground) ? { canBackground: workObj.canBackground } : {}),
      ...(Array.isArray(workObj.activeRooms) ? { activeRooms: workObj.activeRooms.filter(nonempty) } : {}),
    },
    questions: object(value.questions),
    views: object(value.views),
    closedCards: object(value.closedCards),
    imVia: object(value.imVia),
    connectorRequests: object(value.connectorRequests),
    mailRequests: object(value.mailRequests),
    ...(isBotObject(value.secretRequests) ? { secretRequests: value.secretRequests } : {}),
    ...(isBotObject(value.browserHolds) ? { browserHolds: value.browserHolds } : {}),
    ...(isBotObject(value.learning) ? { learning: value.learning } : {}),
    ...(Array.isArray(value.approvalReviews) ? { approvalReviews: objects(value.approvalReviews) } : {}),
    ...(isBotObject(value.botTails) ? { botTails: value.botTails } : {}),
    ...(hasUnifiedInbox ? { inbox: value.inbox as BotObject } : {}),
    ...(isBotObject(value.computer) ? { computer: value.computer } : {}),
    ...(isBotObject(value.computerLive) ? { computerLive: value.computerLive } : {}),
    ...(isBotObject(value.prefs) ? { prefs: value.prefs } : {}),
    ...(typeof value.browser === 'boolean' ? { browser: value.browser } : {}),
    ...(typeof value.memory === 'boolean' ? { memory: value.memory } : {}),
    ...(isBotObject(value.permissions) ? { permissions: value.permissions } : {}),
    ...(Array.isArray(value.secrets) ? { secrets: objects(value.secrets) } : {}),
    ...(isBotObject(value.secretStore) ? { secretStore: value.secretStore } : {}),
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
    ...(typeof value.readOnly === 'string' && value.readOnly.length > 0 ? { readOnly: value.readOnly } : {}),
  }
}

function attachStatePreviews(state: BotState, sessions: RemoteSession[], verify: () => void): BotState {
  verify()
  const catalog = new Map(sessions.filter(entry => (entry.backend ?? 'harness') === 'harness').map(entry => [entry.sessionId, entry]))
  return {
    ...state,
    bots: state.bots.map(bot => ({
      ...bot,
      preview: bot.preview || sessionPreview(catalog.get(bot.sessionId), state.exchangeTurns[bot.sessionId]),
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
  const prevBots = new Map(previous.bots.map(b => [b.id, b]))
  const prevRooms = new Map(previous.rooms.map(r => [r.id, r]))
  return {
    ...next,
    ...(omitModels ? {
      models: previous.models,
      ...(next.modelsKey === undefined && previous.modelsKey !== undefined ? { modelsKey: previous.modelsKey } : {}),
      ...(next.defaultModel === undefined && previous.defaultModel !== undefined ? { defaultModel: previous.defaultModel } : {}),
    } : {}),
    bots: next.bots.map(bot => {
      const prev = prevBots.get(bot.id)
      const keepPhoto = Boolean(
        !bot.avatar?.image
        && bot.avatar?.imageRef
        && prev?.avatar?.image
        && prev.avatar.imageRef === bot.avatar.imageRef,
      )
      const nextPreview = keepPreviews ? (bot.preview || prev?.preview) : bot.preview
      if (!keepPhoto && nextPreview === bot.preview) return bot
      return {
        ...bot,
        ...(nextPreview !== undefined ? { preview: nextPreview } : {}),
        ...(keepPhoto && prev?.avatar?.image ? { avatar: { ...bot.avatar, image: prev.avatar.image } } : {}),
      }
    }),
    rooms: next.rooms.map(room => {
      const prev = prevRooms.get(room.id)
      const keepPhoto = Boolean(
        !room.avatar?.image
        && room.avatar?.imageRef
        && prev?.avatar?.image
        && prev.avatar.imageRef === room.avatar.imageRef,
      )
      const nextPreview = keepPreviews ? (room.preview || prev?.preview) : room.preview
      if (!keepPhoto && nextPreview === room.preview) return room
      return {
        ...room,
        ...(nextPreview !== undefined ? { preview: nextPreview } : {}),
        ...(keepPhoto && prev?.avatar?.image ? { avatar: { ...room.avatar, image: prev.avatar.image } } : {}),
      }
    }),
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
    || raw.inbox !== undefined
    || raw.browserHolds !== undefined
    || raw.secretRequests !== undefined
    || raw.learning !== undefined
    || raw.approvalReviews !== undefined
    || raw.botTails !== undefined
    || raw.secrets !== undefined
    || raw.secretStore !== undefined
    || raw.readOnly !== undefined
  if (!hasLiveFields && nextRevision === previous.revision && nextLiveKey === previous.liveKey) {
    return previous
  }
  const nextWorkObj = raw.work !== undefined ? object(raw.work) : undefined
  const hasInbox = isBotObject(raw.inbox) || isBotObject(previous.inbox)
  const nextReadOnly = raw.readOnly === null || raw.readOnly === ''
    ? undefined
    : typeof raw.readOnly === 'string'
      ? raw.readOnly
      : previous.readOnly
  const nextState: BotState = {
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
        ...(Array.isArray(nextWorkObj.paused)
          ? { paused: objects(nextWorkObj.paused) }
          : isBotObject(nextWorkObj.paused)
            ? { paused: nextWorkObj.paused }
            : {}),
        ...(isBotObject(nextWorkObj.canBackground) ? { canBackground: nextWorkObj.canBackground } : {}),
        ...(Array.isArray(nextWorkObj.activeRooms) ? { activeRooms: nextWorkObj.activeRooms.filter(nonempty) } : {}),
      },
      approvals: objects(nextWorkObj.approvals),
    } : {}),
    ...(raw.computerLive !== undefined ? { computerLive: object(raw.computerLive) } : {}),
    ...(raw.btwCards !== undefined ? { btwCards: object(raw.btwCards), btwSupported: isBotObject(raw.btwCards) && !hasInbox } : {}),
    ...(raw.sideChats !== undefined ? { sideChats: object(raw.sideChats), sideChatsSupported: isBotObject(raw.sideChats) } : {}),
    ...(raw.connectors !== undefined ? { connectors: object(raw.connectors) } : {}),
    ...(raw.capabilityStatuses !== undefined ? { capabilityStatuses: object(raw.capabilityStatuses) } : {}),
    ...(raw.imStatus !== undefined ? { imStatus: object(raw.imStatus) } : {}),
    ...(raw.imVia !== undefined ? { imVia: object(raw.imVia) } : {}),
    ...(isBotObject(raw.inbox) ? { inbox: raw.inbox, btwSupported: false, parallelSessionsSupported: false } : {}),
    ...(isBotObject(raw.browserHolds) ? { browserHolds: raw.browserHolds } : {}),
    ...(isBotObject(raw.secretRequests) ? { secretRequests: raw.secretRequests } : {}),
    ...(isBotObject(raw.learning) ? { learning: raw.learning } : {}),
    ...(Array.isArray(raw.approvalReviews) ? { approvalReviews: objects(raw.approvalReviews) } : {}),
    ...(isBotObject(raw.botTails) ? { botTails: raw.botTails } : {}),
    ...(Array.isArray(raw.secrets) ? { secrets: objects(raw.secrets) } : {}),
    ...(isBotObject(raw.secretStore) ? { secretStore: raw.secretStore } : {}),
  }
  if (nextReadOnly !== undefined) nextState.readOnly = nextReadOnly
  else delete nextState.readOnly
  return nextState
}
export function isBotObject(value: unknown): value is BotObject { return value !== null && typeof value === 'object' && !Array.isArray(value) }
export function object(value: unknown): BotObject { return isBotObject(value) ? value : {} }
export function objects(value: unknown): BotObject[] { return Array.isArray(value) ? value.filter(isBotObject) : [] }
export function text(value: unknown): string { return typeof value === 'string' ? value : '' }

/** Normalize `state.work.paused` across DS-Bot v0.4 arrays and legacy object maps. */
export function pausedWorksList(
  paused: BotObject | BotObject[] | undefined,
  botId?: string,
  sessionId?: string,
  roomId?: string,
): BotObject[] {
  if (Array.isArray(paused)) {
    return paused.filter(entry => {
      if (!botId && !roomId) return true
      if (botId && (text(entry.from) === botId || text(entry.to) === botId)) return true
      if (roomId && text(entry.room) === roomId) return true
      return false
    })
  }
  if (!isBotObject(paused)) return []
  if (botId && paused[botId] !== undefined) return [isBotObject(paused[botId]) ? paused[botId] : { id: botId, from: botId }]
  if (sessionId && paused[sessionId] !== undefined) return [isBotObject(paused[sessionId]) ? paused[sessionId] : { id: sessionId, from: botId }]
  return []
}
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
  if (/^\/side(?:\s|$)/.test(trimmed)) {
    return ['/side', prefix, trimmed.slice(5).trim()].filter(Boolean).join(' ')
  }
  return [prefix, trimmed].filter(Boolean).join(' ')
}

/** Claim /btw and /side before normal sending; refusals never become queued prompts. */
export function botMessageRequest(state: BotState, targetId: string, draft: string): { endpoint: BotOperation; payload: BotObject } {
  const message = draft.trim()
  const bot = state.bots.find(entry => entry.id === targetId || entry.sessionId === targetId)
  const room = state.rooms.find(entry => entry.id === targetId || entry.sessionId === targetId)
  const isAgentSession = (state.agents ?? []).some(entry => entry.sessions.includes(targetId))
  if ((!bot && !room && !isAgentSession) || state.readOnly !== undefined || !message) throw new Error(strings.bots.sessionUnavailable)
  const isSide = /^\/side(?:\s|$)/.test(message)
  const isAside = /^\/btw(?:\s|$)/.test(message)
  if (isSide || isAside) {
    if (!bot) throw new Error(strings.bots.btwPrivate)
    const question = message.slice(isSide ? 5 : 4).trim()
    if (!question) throw new Error(strings.bots.btwEmpty)
    if (isSide || (!state.btwSupported && state.sideChatsSupported === true)) {
      return { endpoint: 'side-ask', payload: { sessionId: bot.id, recent: true, text: question } }
    }
    if (!state.btwSupported) throw new Error(strings.bots.btwUnsupported)
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
    if (bot.tasks) {
      for (const task of bot.tasks) {
        if (typeof task.sessionId === 'string' && task.sessionId) target.add(task.sessionId)
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
