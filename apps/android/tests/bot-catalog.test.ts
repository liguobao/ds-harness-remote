import { AbortController as NativeAbortController } from 'abort-controller'
import { describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  BotRemoteClient,
  botMessageRequest,
  isScopedKnownBotSessionId,
  parseBotState,
  trackScopedBotStateSessions,
  type BotOperation,
} from '../src/services/bot-catalog'
import { inboxQueuedItems } from '../src/state/message-helpers'
import { buildBotMentionRows, buildReferenceChatGroups, insertReferenceAtSelection } from '../src/screens/bot/at-menu'
import { sessionMentionText } from '../src/ui/mention-helpers'
import type { RemoteSession } from '../src/types'

const botState = () => ({ bots: [{ id: 'bot', sessionId: 'part-2', name: 'Bot' }], rooms: [{ id: 'room', name: 'Team', members: ['bot', 'other'] }], mainBotIds: ['bot'] })
const envelope = (value: unknown) => ({ status: 200, json: { ok: true, value } })
const session = (sessionId: string, backend?: RemoteSession['backend']): RemoteSession => ({ sessionId, backend, updatedAt: 1, running: false, blank: false })

describe('Android Bot client authority', () => {
  it('supports React Native cancellation before dispatch and after asynchronous responses', async () => {
    await runScenarios(['active', 'before', 'during-state', 'during-catalog'].map(stage => ({ name: stage, run: async () => {
      const controller = new NativeAbortController()
      const signal = controller.signal as AbortSignal
      const dispatch = vi.fn(async () => {
        if (stage === 'during-state') controller.abort()
        return envelope(botState())
      })
      const readSessions = vi.fn(async () => {
        if (stage === 'during-catalog') controller.abort()
        return [session('part-2')]
      })
      const client = new BotRemoteClient(dispatch, readSessions, () => {})
      if (stage === 'before') controller.abort()
      if (stage === 'active') await expect(client.resolveSession('bot', signal)).resolves.toMatchObject({ session: { sessionId: 'part-2' } })
      else await expect(client.resolveSession('bot', signal)).rejects.toMatchObject({ name: 'AbortError' })
      expect(dispatch).toHaveBeenCalledTimes(stage === 'before' ? 0 : 1)
      expect(readSessions).toHaveBeenCalledTimes(stage === 'active' || stage === 'during-catalog' ? 1 : 0)
    } })))
  })

  it('claims side questions without ever falling back to a queued prompt', async () => {
    await runScenarios([
      { name: 'aside', draft: '/btw progress?', target: 'bot', supported: true, endpoint: 'btw', text: 'progress?' },
      { name: 'multiline', draft: ' /btw\nprogress? ', target: 'bot', supported: true, endpoint: 'btw', text: 'progress?' },
      { name: 'empty aside', draft: '/btw  ', target: 'bot', supported: true },
      { name: 'group aside', draft: '/btw progress?', target: 'room', supported: true },
      { name: 'older Bot', draft: '/btw progress?', target: 'bot', supported: false },
      { name: 'ordinary message on older Bot', draft: 'hello', target: 'bot', supported: false, endpoint: 'send', text: 'hello' },
      { name: 'not the command', draft: '/btwquestion', target: 'bot', supported: true, endpoint: 'send', text: '/btwquestion' },
      { name: 'read only', draft: '/btw progress?', target: 'bot', supported: true, readOnly: 'locked' },
      { name: 'unknown session', draft: '/btw progress?', target: 'unlisted', supported: true },
    ].map(row => ({ name: row.name, run: async () => {
      const state = parseBotState({ ...botState(), ...(row.supported ? { btwCards: {} } : {}), readOnly: row.readOnly })
      const dispatch = vi.fn(async () => envelope({ id: 'aside' }))
      const client = new BotRemoteClient(dispatch, async () => [], () => {})
      const send = async () => {
        const request = botMessageRequest(state, row.target, row.draft)
        return client.call(request.endpoint, request.payload)
      }
      if (row.endpoint) {
        await send()
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch).toHaveBeenCalledWith({ endpoint: row.endpoint, payload: { sessionId: row.target, text: row.text } }, undefined)
      } else { await expect(send()).rejects.toThrow(); expect(dispatch).not.toHaveBeenCalled() }
    } })))
    // Unknown outcome is never retried as either a side question or a prompt.
    const dispatch = vi.fn(async () => { throw new Error('disconnected') })
    const client = new BotRemoteClient(dispatch, async () => [], () => {})
    await expect(client.call('btw', { sessionId: 'bot', text: 'progress?' })).rejects.toThrow('disconnected')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('opens only current Bot/group sessions from the same official Harness catalog', async () => {
    await runScenarios([
      { name: 'current Bot part', id: 'bot', sessions: [session('part-2')], expected: 'part-2' },
      { name: 'group', id: 'room', sessions: [session('room')], expected: 'room' },
      { name: 'group current part (v0.2.7)', id: 'room', state: { ...botState(), rooms: [{ id: 'room', sessionId: 'room-part-2', name: 'Team', members: ['bot', 'other'] }] }, sessions: [session('room-part-2')], expected: 'room-part-2' },
      { name: 'DSH Agent session in Bot team', id: 'agent-s1', state: { ...botState(), agents: [{ id: 'agent-1', sessions: ['agent-s1'] }] }, sessions: [session('agent-s1')], expected: 'agent-s1' },
      { name: 'old part cannot replace current', id: 'bot', sessions: [session('bot'), session('part-1')] },
      { name: 'ACP identity collision', id: 'bot', sessions: [session('part-2', 'cursor')] },
      { name: 'unlisted session', id: 'other', sessions: [session('other')] },
    ].map(row => ({ name: row.name, run: async () => {
      const client = new BotRemoteClient(vi.fn(async () => envelope(row.state ?? botState())), async () => row.sessions, () => {})
      if (row.expected) await expect(client.resolveSession(row.id)).resolves.toMatchObject({ session: { sessionId: row.expected } })
      else await expect(client.resolveSession(row.id)).rejects.toThrow()
    } })))

    const team = parseBotState({
      bots: [
        { id: 'chief', sessionId: 'chief-part-2', parts: ['chief-part-1'], name: 'Chief', role: 'Lead', main: true, engine: 'claude-code', appliedModel: 'claude-code/default' },
        { id: 'writer', sessionId: 'writer-part-1', name: 'Writer', role: 'Docs' },
      ],
      rooms: [{ id: 'room-1', sessionId: 'room-part-2', ownParts: ['room-part-1'], name: 'Core Team', members: ['chief', 'writer'] }],
      mainBotId: 'chief',
      defaultModel: 'deepseek/deepseek-reasoner',
      closedCards: { 'chief-part-2': { 'call-1': 'replied', 'call-2': 'dismissed' } },
      imVia: { 'chief-part-2': { '10': 'Telegram' } },
      connectorRequests: { 'chief-part-2': { 'req-1': { id: 'github' } } },
      mailRequests: {},
      computer: { enabled: true },
      computerLive: { asks: {}, holds: {} },
    })
    expect(team.bots[0]?.engine).toBe('claude-code')
    expect(team.bots[0]?.appliedModel).toBe('claude-code/default')
    expect(team.defaultModel).toBe('deepseek/deepseek-reasoner')
    expect(team.closedCards).toEqual({ 'chief-part-2': { 'call-1': 'replied', 'call-2': 'dismissed' } })
    expect(team.imVia).toEqual({ 'chief-part-2': { '10': 'Telegram' } })
    expect(team.connectorRequests).toEqual({ 'chief-part-2': { 'req-1': { id: 'github' } } })
    trackScopedBotStateSessions(team, 'test-scope-030')
    expect(isScopedKnownBotSessionId('chief', 'test-scope-030')).toBe(true)
    expect(isScopedKnownBotSessionId('chief-part-1', 'test-scope-030')).toBe(true)
    expect(isScopedKnownBotSessionId('chief-part-2', 'test-scope-030')).toBe(true)
    expect(isScopedKnownBotSessionId('room-part-1', 'test-scope-030')).toBe(true)
    expect(isScopedKnownBotSessionId('dsh-1', 'test-scope-030')).toBe(false)

    // DS-Bot 0.3.0 (#663): only user/schedule/user-question-reply inbox items belong in QueueDock; Bot relays are filtered.
    expect(inboxQueuedItems({
      'next-turn': [
        { id: 'q-user', source: { kind: 'user', rpcId: 'r-user' }, content: [{ type: 'text', text: 'User queued' }] },
        { id: 'q-bot', source: { kind: 'bot', rpcId: 'r-bot' }, content: [{ type: 'text', text: 'Internal bot relay' }] },
        { id: 'q-sched', source: { kind: 'schedule', rpcId: 'r-sched' }, content: [{ type: 'text', text: 'Scheduled' }] },
        { id: 'q-ans', source: { kind: 'user-question-reply', rpcId: 'r-ans' }, content: [{ type: 'text', text: 'Question reply' }] },
      ],
    })).toEqual([
      { id: 'q-user', rpcId: 'r-user', preview: 'User queued' },
      { id: 'q-sched', rpcId: 'r-sched', preview: 'Scheduled' },
      { id: 'q-ans', rpcId: 'r-ans', preview: 'Question reply' },
    ])
    const directMentions = buildBotMentionRows({ state: team, currentBotId: 'chief' })
    expect(directMentions.map(item => item.text)).toEqual(['@Writer '])
    const roomMentions = buildBotMentionRows({ state: team, currentRoom: team.rooms[0] })
    expect(roomMentions.map(item => item.text)).toEqual(['@Chief ', '@Writer ', '@所有人 '])

    const refGroups = buildReferenceChatGroups({
      state: team,
      currentSessionId: 'chief-part-2',
      currentBotId: 'chief',
      sessions: [
        { ...session('chief-part-2'), title: 'Chief' },
        { ...session('writer-part-1'), title: 'Writer' },
        { ...session('room-part-2'), title: 'Core Team' },
        { ...session('room-part-1'), title: 'Core Team Part 1' },
        { ...session('dsh-1'), title: '架构讨论', updatedAt: 200 },
        { ...session('dsh-sub'), title: 'Subagent', origin: 'subagent', parentSessionId: 'dsh-1', updatedAt: 300 },
      ],
    })
    expect(refGroups.bots).toHaveLength(1)
    expect(refGroups.bots[0]?.mentionLabel).toBe('与 Writer 的对话')
    expect(refGroups.bots[0]?.mentionText).toBe(sessionMentionText('writer-part-1', '与 Writer 的对话'))
    expect(refGroups.conversations.map(item => item.sessionId)).toEqual(['dsh-1'])
    const inserted = insertReferenceAtSelection('请参考', { start: 3, end: 3 }, refGroups.conversations[0]!.mentionText)
    expect(inserted.text).toBe(`请参考 ${refGroups.conversations[0]!.mentionText}`)
  })

  it('keeps roster previews scoped to current Harness sessions and rejects stale catalog responses', async () => {
    await runScenarios(['current', 'other-backend', 'replaced', 'aborted'].map(mode => ({ name: mode, run: async () => {
      let current = true
      const controller = new NativeAbortController()
      const client = new BotRemoteClient(async () => envelope({ ...botState(), exchangeTurns: { 'part-2': [2] } }), async () => {
        if (mode === 'replaced') current = false
        if (mode === 'aborted') controller.abort()
        return [{ ...session('part-2', mode === 'other-backend' ? 'cursor' : 'harness'), projections: { values: { turnOutline: [
          { turn: 1, response: 'Visible reply' }, { turn: 2, response: 'Internal exchange' },
        ] } } }, { ...session('part-1'), projections: { values: { turnOutline: [{ turn: 3, response: 'Old part' }] } } }]
      }, () => { if (!current) throw new Error('replaced') })
      const result = client.state(controller.signal as AbortSignal, true)
      if (mode === 'replaced' || mode === 'aborted') await expect(result).rejects.toThrow()
      else expect((await result).bots[0]?.preview).toBe(mode === 'current' ? 'Visible reply' : '')
    } })))
  })

  it('forwards native Bot answers once and rejects unreviewed operations and broad approval', async () => {
    await runScenarios([
      { name: 'aside', endpoint: 'btw', payload: { sessionId: 'bot', text: 'progress?' }, allowed: true },
      { name: 'cancel aside', endpoint: 'btw-cancel', payload: { sessionId: 'bot', id: 'aside' }, allowed: true },
      { name: 'delete aside', endpoint: 'btw-delete', payload: { sessionId: 'bot', cardId: 'aside' }, allowed: true },
      { name: 'continue group', endpoint: 'room-continue', payload: { roomId: 'room' }, allowed: true },
      { name: 'stop room work', endpoint: 'stop-room-work', payload: { roomId: 'room' }, allowed: true },
      { name: 'goal control', endpoint: 'goal-control', payload: { roomId: 'room', action: 'pause' }, allowed: true },
      { name: 'run stats', endpoint: 'run-stats', payload: { botId: 'bot' }, allowed: true },
      { name: 'new part (0.3.0)', endpoint: 'bot-new-part', payload: { botId: 'bot' }, allowed: true },
      { name: 'open earlier part (0.3.0)', endpoint: 'bot-open-part', payload: { botId: 'bot', sessionId: 'part-1' }, allowed: true },
      { name: 'send', endpoint: 'send', payload: { sessionId: 'bot', text: 'hello' }, allowed: true },
      { name: 'card', endpoint: 'view-reply', payload: { sessionId: 'part-2', viewId: 'view', action: 'form', values: { fields: { name: 'value' } } }, allowed: true },
      { name: 'one time', endpoint: 'approval-answer', payload: { id: 'approval', choice: 'allow' }, allowed: true },
      { name: 'reject', endpoint: 'approval-answer', payload: { id: 'approval', choice: 'reject' }, allowed: true },
      { name: 'broad approval', endpoint: 'approval-answer', payload: { choice: 'allow_session' }, allowed: false },
      { name: 'credential write', endpoint: 'secret-set', payload: {}, allowed: false },
      { name: 'local agent registration (0.3.0)', endpoint: 'local-agent-add', payload: {}, allowed: false },
      { name: 'im pairing (0.3.0)', endpoint: 'im-pair', payload: {}, allowed: false },
      { name: 'connector command (0.3.0)', endpoint: 'connector-add', payload: {}, allowed: false },
      { name: 'mail account (0.3.0)', endpoint: 'mail-account-add', payload: {}, allowed: false },
      { name: 'computer control (0.3.0)', endpoint: 'computer-set-enabled', payload: {}, allowed: false },
      { name: 'unknown route operation', endpoint: 'future-operation', payload: {}, allowed: false },
    ].map(row => ({ name: row.name, run: async () => {
      const dispatch = vi.fn(async () => envelope(true))
      const client = new BotRemoteClient(dispatch, async () => [], () => {})
      if (row.allowed) {
        await expect(client.call(row.endpoint as BotOperation, row.payload)).resolves.toBe(true)
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch).toHaveBeenCalledWith({ endpoint: row.endpoint, payload: row.payload }, undefined)
      } else { await expect(client.call(row.endpoint as BotOperation, row.payload)).rejects.toThrow(); expect(dispatch).not.toHaveBeenCalled() }
    } })))
    const dispatch = vi.fn(async () => { throw new Error('timeout') })
    const client = new BotRemoteClient(dispatch, async () => [], () => {})
    await expect(client.call('send', { sessionId: 'bot', text: 'hello' })).rejects.toThrow('timeout')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('rejects Host errors, malformed catalogs, cancellation and late responses without publishing', async () => {
    await runScenarios([
      { name: 'missing plugin', response: { status: 404, json: null } },
      { name: 'missing carrier', response: { status: 503, json: null } },
      { name: 'upstream refusal', response: { status: 200, json: { ok: false, error: { code: 'bot/stale' } } } },
      { name: 'missing current session', response: envelope({ ...botState(), bots: [{ id: 'bot' }] }) },
      { name: 'duplicate identity', response: envelope({ ...botState(), rooms: [{ id: 'bot', members: [] }] }) },
      { name: 'array envelope', response: [] },
    ].map(row => ({ name: row.name, run: async () => {
      const sessions = vi.fn(async () => [])
      const client = new BotRemoteClient(async () => row.response, sessions, () => {})
      await expect(client.resolveSession('bot')).rejects.toThrow()
      expect(sessions).not.toHaveBeenCalled()
    } })))
    let current = true
    const dispatch = vi.fn(async () => { current = false; return envelope(botState()) })
    const client = new BotRemoteClient(dispatch, async () => [], () => { if (!current) throw new Error('replaced') })
    await expect(client.state()).rejects.toThrow('replaced')
    const aborted = new AbortController(); aborted.abort()
    current = true; dispatch.mockClear()
    await expect(client.state(aborted.signal)).rejects.toThrow()
    expect(dispatch).not.toHaveBeenCalled()
  })
})
