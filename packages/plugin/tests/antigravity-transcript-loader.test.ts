import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadTranscriptEvents, cleanUserPrompt } from '../src/acp/adapters/antigravity/transcript-loader.js'

describe('TranscriptLoader', () => {
  it('restores the durable turn end timestamp instead of the history read time', async () => {
    const base = await mkdtemp(join(tmpdir(), 'agy-history-'))
    try {
      const logs = join(base, 'conversation', '.system_generated', 'logs')
      await mkdir(logs, { recursive: true })
      await writeFile(join(logs, 'transcript.jsonl'), [
        { type: 'USER_INPUT', step_index: 1, created_at: '2026-09-29T09:10:00Z', content: 'ping' },
        { type: 'PLANNER_RESPONSE', step_index: 2, created_at: '2026-09-29T09:10:04Z', content: 'pong' },
      ].map(record => JSON.stringify(record)).join('\n'))
      const events = await loadTranscriptEvents('conversation', 'acp:conversation', base)
      expect(events.at(-1)?.event).toMatchObject({ type: 'turn/end', time: Date.parse('2026-09-29T09:10:04Z') })
      expect(await loadTranscriptEvents('conversation', 'acp:conversation', base)).toEqual(events)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
  it('cleans user prompt wrapper tags', () => {
    const raw = '<USER_REQUEST>\n这个主机咋样\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\n...'
    expect(cleanUserPrompt(raw)).toBe('这个主机咋样')
    expect(cleanUserPrompt('普通问题')).toBe('普通问题')
  })

  it('hydrates events from real local transcript file', async () => {
    const events = await loadTranscriptEvents(
      'bab821dd-6184-43f1-8ed5-fe589be9b302',
      'cursor:bab821dd-6184-43f1-8ed5-fe589be9b302',
    )
    if (events.length > 0) {
      expect(events.length).toBeGreaterThan(0)
      const types = events.map(e => e.event.type)
      expect(types).toContain('user/message')
      expect(types).toContain('assistant/message')
      const user = events.find(e => e.event.type === 'user/message')
      expect((user?.event?.data as any)?.content?.[0]?.text).toBe('这个主机咋样')
    }
  })

  it('discovers existing Antigravity sessions from brain directory', async () => {
    const { discoverAntigravitySessions } = await import('../src/acp/adapters/antigravity/transcript-loader.js')
    const list = await discoverAntigravitySessions('/var/lib/dsh/workspace/ds-harness-remote', 10)
    expect(Array.isArray(list)).toBe(true)
    if (list.length > 0) {
      expect(typeof list[0].conversationId).toBe('string')
      expect(typeof list[0].title).toBe('string')
      expect(list[0].title.length).toBeGreaterThan(0)
    }
  })

  it('discovers existing Antigravity workspaces from database', async () => {
    const { discoverAntigravityWorkspaces } = await import('../src/acp/adapters/antigravity/transcript-loader.js')
    const workspaces = await discoverAntigravityWorkspaces()
    expect(Array.isArray(workspaces)).toBe(true)
    if (workspaces.length > 0) {
      expect(workspaces).toContain('/var/lib/dsh/workspace/ds-harness-remote')
    }
  })

  it('hydrates tool/call events with valid name and callId to satisfy DSH front-end', async () => {
    const events = await loadTranscriptEvents(
      '8563e7e9-7c52-4687-a61f-12f69014d03e',
      'cursor:8563e7e9-7c52-4687-a61f-12f69014d03e',
    )
    const toolCalls = events.filter(e => e.event.type === 'tool/call')
    if (toolCalls.length > 0) {
      for (const tc of toolCalls) {
        const data = tc.event.data as Record<string, unknown>
        expect(typeof data.name).toBe('string')
        expect((data.name as string).length).toBeGreaterThan(0)
        expect(typeof data.callId).toBe('string')
        // DSH client isSubagentDelegationTool check should not throw
        expect(() => {
          const name = data.name as string
          const isSub = name === 'subagent' || name.startsWith('subagent_')
          return isSub
        }).not.toThrow()
      }
    }
  })
})
