import { AbortController as NativeAbortController } from 'abort-controller'
import { describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { BotRemoteClient, botMessageRequest, parseBotState, type BotOperation } from '../src/services/bot-catalog'
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
      { name: 'send', endpoint: 'send', payload: { sessionId: 'bot', text: 'hello' }, allowed: true },
      { name: 'card', endpoint: 'view-reply', payload: { sessionId: 'part-2', viewId: 'view', action: 'form', values: { fields: { name: 'value' } } }, allowed: true },
      { name: 'one time', endpoint: 'approval-answer', payload: { id: 'approval', choice: 'allow' }, allowed: true },
      { name: 'reject', endpoint: 'approval-answer', payload: { id: 'approval', choice: 'reject' }, allowed: true },
      { name: 'broad approval', endpoint: 'approval-answer', payload: { choice: 'allow_session' }, allowed: false },
      { name: 'credential write', endpoint: 'secret-set', payload: {}, allowed: false },
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
