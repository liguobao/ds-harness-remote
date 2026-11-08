import { isSubagentSession } from '../../lib/session-kind'
import type { BotEntry, BotRoom, BotState } from '../../services/bot-catalog'
import type { RemoteSession, WorkspaceView } from '../../types'
import { filterByQuery, maskPersonalPath, sessionMentionText } from '../../ui/mention-helpers'
import { resolveSessionDisplayTitle } from '../session-title'

const ROOM_ALL_KEYWORDS = ['all', 'everyone', '所有人', '全体']
const OTHER_CHATS_MAX = 20

export interface BotAtMentionRow {
  id: string
  label: string
  description?: string
  text: string
  bot?: BotEntry
  room?: BotRoom
}

export interface ReferenceChatCandidate {
  id: string
  sessionId: string
  /** Display name in the picker row (e.g. bot name or session title). */
  title: string
  /** Label embedded inside `@[label](dsh-session:...)`. */
  mentionLabel: string
  /** Preformatted `@[label](dsh-session:<base64url>) ` token with trailing space. */
  mentionText: string
  description?: string
  updatedAt?: number
  bot?: BotEntry
}

export interface ReferenceChatGroups {
  bots: ReferenceChatCandidate[]
  conversations: ReferenceChatCandidate[]
}

/**
 * Mirrors `mentionRows` in `ds-bot/src/client/at-menu.js`:
 * - In a group chat: offers the room's member Bots and `@所有人 ` (when >1 member).
 * - In a Bot's 1:1 chat: offers every other Bot in the team.
 */
export function buildBotMentionRows({
  state,
  currentBotId,
  currentRoom,
  query = '',
  everyoneLabel = '所有人',
  membersCountLabel,
}: {
  state: BotState | undefined
  currentBotId?: string
  currentRoom?: BotRoom
  query?: string
  everyoneLabel?: string
  membersCountLabel?: (count: number) => string
}): BotAtMentionRow[] {
  if (!state) return []
  const byId = new Map(state.bots.map(bot => [bot.id, bot]))
  const bots = currentRoom
    ? currentRoom.members.map(id => byId.get(id)).filter((b): b is BotEntry => b !== undefined)
    : state.bots.filter(bot => bot.id !== currentBotId)

  const needle = query.trim().toLowerCase()
  const rows: BotAtMentionRow[] = bots
    .filter(bot => !needle || bot.name.toLowerCase().includes(needle) || (bot.role ?? '').toLowerCase().includes(needle))
    .map(bot => ({
      id: `bot:${bot.id}`,
      label: bot.name,
      ...(bot.role ? { description: bot.role } : {}),
      text: `@${bot.name} `,
      bot,
    }))

  if (
    currentRoom
    && bots.length > 1
    && (!needle || [everyoneLabel, ...ROOM_ALL_KEYWORDS].some(word => word.toLowerCase().startsWith(needle)))
  ) {
    rows.push({
      id: `room-all:${currentRoom.id}`,
      label: everyoneLabel,
      description: membersCountLabel ? membersCountLabel(currentRoom.members.length) : `${currentRoom.members.length} 位成员`,
      text: `@${everyoneLabel} `,
      room: currentRoom,
    })
  }
  return rows
}

/**
 * Mirrors `chatRows` in `ds-bot/src/client/at-menu.js`:
 * 1. Every other Bot's current chat (`与 {name} 的对话`).
 * 2. Recent Harness conversations outside the Bot team (excluding group chats and subagents).
 */
export function buildReferenceChatGroups({
  state,
  sessions,
  workspaces = [],
  currentSessionId,
  currentBotId,
  archivedSessionIds = [],
  query = '',
  chatWithBotLabel = (name: string) => `与 ${name} 的对话`,
}: {
  state: BotState | undefined
  sessions: readonly RemoteSession[]
  workspaces?: readonly WorkspaceView[]
  currentSessionId?: string
  currentBotId?: string
  archivedSessionIds?: readonly string[]
  query?: string
  chatWithBotLabel?: (name: string) => string
}): ReferenceChatGroups {
  const sessionById = new Map(sessions.map(item => [item.sessionId, item]))

  const rawBots: ReferenceChatCandidate[] = (state?.bots ?? [])
    .filter(bot => bot.id !== currentBotId && typeof bot.sessionId === 'string' && bot.sessionId.length > 0 && bot.sessionId !== currentSessionId)
    .map(bot => {
      const sid = bot.sessionId!
      const mentionLabel = chatWithBotLabel(bot.name)
      const matchedSession = sessionById.get(sid)
      return {
        id: `bot-chat:${bot.id}`,
        sessionId: sid,
        title: bot.name,
        mentionLabel,
        mentionText: sessionMentionText(sid, mentionLabel),
        description: bot.role || bot.preview || mentionLabel,
        updatedAt: matchedSession?.updatedAt,
        bot,
      }
    })

  const teamIds = new Set<string>()
  for (const bot of state?.bots ?? []) {
    if (bot.id) teamIds.add(bot.id)
    if (bot.sessionId) teamIds.add(bot.sessionId)
  }
  for (const room of state?.rooms ?? []) {
    if (room.id) teamIds.add(room.id)
    if (room.sessionId) teamIds.add(room.sessionId)
    for (const part of room.ownParts ?? []) {
      if (part) teamIds.add(part)
    }
  }

  const archivedSet = new Set(archivedSessionIds)
  const eligibleSessions = sessions.filter(
    row =>
      (row.backend ?? 'harness') === 'harness'
      && row.sessionId !== currentSessionId
      && !teamIds.has(row.sessionId)
      && !archivedSet.has(row.sessionId)
      && row.origin !== 'subagent'
      && !isSubagentSession(row),
  )
  const nonBlank = eligibleSessions.filter(row => row.blank !== true)
  const pool = nonBlank.length > 0 ? nonBlank : eligibleSessions

  const rawConversations: ReferenceChatCandidate[] = [...pool]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, OTHER_CHATS_MAX)
    .map(row => {
      const title = resolveSessionDisplayTitle(row) ?? row.title ?? row.sessionId
      const owner = workspaces.find(w => w.sessionIds.includes(row.sessionId))
      const description = owner ? `${owner.title} · ${maskPersonalPath(owner.path)}` : undefined
      return {
        id: `session:${row.sessionId}`,
        sessionId: row.sessionId,
        title,
        mentionLabel: title,
        mentionText: sessionMentionText(row.sessionId, title),
        ...(description ? { description } : {}),
        updatedAt: row.updatedAt,
      }
    })

  return {
    bots: filterByQuery(rawBots, query, item => [item.title, item.mentionLabel, item.description ?? '']),
    conversations: filterByQuery(rawConversations, query, item => [item.title, item.description ?? '']),
  }
}

/** Insert a reference or mention token at the current selection (or append with a space). */
export function insertReferenceAtSelection(
  draft: string,
  selection: { start: number; end: number } | undefined,
  tokenText: string,
): { text: string; cursor: number } {
  const start = selection ? Math.max(0, Math.min(draft.length, selection.start)) : draft.length
  const end = selection ? Math.max(start, Math.min(draft.length, selection.end)) : draft.length
  const before = draft.slice(0, start)
  const after = draft.slice(end)
  const needsLeadingSpace = before.length > 0 && !/\s$/u.test(before)
  const prefix = needsLeadingSpace ? ' ' : ''
  const inserted = `${prefix}${tokenText}`
  const nextText = `${before}${inserted}${after}`
  const nextCursor = before.length + inserted.length
  return { text: nextText, cursor: nextCursor }
}
