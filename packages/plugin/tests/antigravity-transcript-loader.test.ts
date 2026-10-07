import { createRequire } from 'node:module'
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
  it('recovers workspace-scoped durable conversations with empty AGY summaries', async () => {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    const { discoverAntigravitySessions, discoverAntigravityWorkspaces } = await import('../src/acp/adapters/antigravity/transcript-loader.js')
    const base = await mkdtemp(join(tmpdir(), 'agy-summary-'))
    const dbPath = join(base, 'summaries.db')
    const workspace = join(base, 'project')
    const other = join(base, 'other')
    const empty = join(base, 'empty')
    try {
      for (const path of [workspace, other, empty]) await mkdir(path)
      const db = new DatabaseSync(dbPath)
      try {
        db.exec('CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, workspace_uris TEXT, step_count INTEGER, last_modified_time TEXT)')
        const insert = db.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?)')
        for (const [id, path] of [['stale-session', workspace], ['other-session', other], ['idle-session', empty], ['active-untitled', workspace]]) {
          insert.run(id, '', JSON.stringify([`file://${path}`]), 0, '2026-10-07T00:00:00Z')
        }
        db.prepare('UPDATE conversation_summaries SET step_count = 2 WHERE conversation_id = ?').run('active-untitled')
        insert.run('normal-session', 'Normal', JSON.stringify([`file://${workspace}`]), 2, '2026-10-07T00:00:00Z')
      } finally {
        db.close()
      }
      for (const id of ['stale-session', 'other-session', 'active-untitled']) {
        const logs = join(base, id, '.system_generated', 'logs')
        await mkdir(logs, { recursive: true })
        await writeFile(join(logs, 'transcript.jsonl'), JSON.stringify({ type: 'USER_INPUT', step_index: 1, created_at: '2026-10-07T00:00:00Z', content: 'Durable message' }) + '\n')
      }
      const sessions = await discoverAntigravitySessions(workspace, 30, base, dbPath)
      expect(sessions.map(session => session.conversationId).sort()).toEqual(['active-untitled', 'normal-session', 'stale-session'])
      expect(sessions.find(session => session.conversationId === 'stale-session')?.title).toBe('Durable message')
      expect(sessions.find(session => session.conversationId === 'active-untitled')?.title).toBe('Durable message')
      expect((await discoverAntigravityWorkspaces(dbPath, base)).sort()).toEqual([workspace, other].sort())
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
