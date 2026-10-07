import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, utimes, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import {
  cleanUserPrompt,
  discoverAntigravitySessions,
  discoverAntigravityWorkspaces,
  loadTranscriptEvents,
} from '../src/acp/adapters/antigravity/transcript-loader.js'

let base: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'agy-transcript-test-'))
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

async function writeTranscript(conversationId: string, records: unknown[]): Promise<string> {
  const logs = join(base, conversationId, '.system_generated', 'logs')
  await mkdir(logs, { recursive: true })
  const path = join(logs, 'transcript.jsonl')
  await writeFile(path, records.map(record => JSON.stringify(record)).join('\n') + '\n')
  return path
}

function createDatabase() {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
  const dbPath = join(base, 'summaries.db')
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, workspace_uris TEXT, step_count INTEGER, last_modified_time TEXT)')
  return { db, dbPath }
}

const createdAt = '2026-10-07T00:00:00Z'

describe('TranscriptLoader', () => {
  it('restores the durable turn end timestamp instead of the history read time', async () => {
    await writeTranscript('conversation', [
      { type: 'USER_INPUT', step_index: 1, created_at: '2026-09-29T09:10:00Z', content: 'ping' },
      { type: 'PLANNER_RESPONSE', step_index: 2, created_at: '2026-09-29T09:10:04Z', content: 'pong' },
    ])
    const events = await loadTranscriptEvents('conversation', 'acp:conversation', base)
    expect(events.at(-1)?.event).toMatchObject({ type: 'turn/end', time: Date.parse('2026-09-29T09:10:04Z') })
    expect(await loadTranscriptEvents('conversation', 'acp:conversation', base)).toEqual(events)
  })

  it('recovers workspace-scoped durable conversations with empty AGY summaries', async () => {
    const workspace = join(base, 'project')
    const other = join(base, 'other')
    const empty = join(base, 'empty')
    for (const path of [workspace, other, empty]) await mkdir(path)
    const { db, dbPath } = createDatabase()
    try {
      const insert = db.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?)')
      for (const [id, path] of [['stale-session', workspace], ['other-session', other], ['idle-session', empty], ['active-untitled', workspace]]) {
        insert.run(id, '', JSON.stringify([pathToFileURL(path).href]), 0, createdAt)
      }
      db.prepare('UPDATE conversation_summaries SET step_count = 2 WHERE conversation_id = ?').run('active-untitled')
      insert.run('normal-session', 'Normal', JSON.stringify([pathToFileURL(workspace).href]), 2, createdAt)
    } finally {
      db.close()
    }
    for (const id of ['stale-session', 'other-session', 'active-untitled']) {
      await writeTranscript(id, [{ type: 'USER_INPUT', step_index: 1, created_at: createdAt, content: 'Durable message' }])
    }
    const sessions = await discoverAntigravitySessions(workspace, 30, base, dbPath)
    expect(sessions.map(session => session.conversationId).sort()).toEqual(['active-untitled', 'normal-session', 'stale-session'])
    expect(sessions.find(session => session.conversationId === 'stale-session')?.title).toBe('Durable message')
    expect(sessions.find(session => session.conversationId === 'active-untitled')?.title).toBe('Durable message')
    expect((await discoverAntigravityWorkspaces(dbPath, base)).sort()).toEqual([workspace, other].sort())
  })

  it('cleans user prompt wrapper tags', () => {
    const raw = '<USER_REQUEST>\n这个主机咋样\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\n...'
    expect(cleanUserPrompt(raw)).toBe('这个主机咋样')
    expect(cleanUserPrompt('普通问题')).toBe('普通问题')
  })

  it('hydrates user and assistant messages from an isolated transcript', async () => {
    await writeTranscript('fixture-conversation', [
      { type: 'USER_INPUT', step_index: 1, created_at: createdAt, content: '<USER_REQUEST>\n这个主机咋样\n</USER_REQUEST>' },
      { type: 'PLANNER_RESPONSE', step_index: 2, created_at: createdAt, content: '主机状态正常。' },
    ])
    const events = await loadTranscriptEvents('fixture-conversation', 'antigravity:fixture-conversation', base)
    expect(events.find(e => e.event.type === 'user/message')?.event.data).toMatchObject({
      content: [{ type: 'text', text: '这个主机咋样' }],
    })
    expect(events.find(e => e.event.type === 'assistant/message')?.event.data).toMatchObject({
      message: { content: [{ type: 'text', text: '主机状态正常。' }] }, stream: [],
    })
  })

  it('discovers sessions from an isolated brain directory when the database is missing', async () => {
    for (const [id, title, time] of [['older-session', 'Older conversation', 1_000], ['newer-session', 'Newer conversation', 2_000]] as const) {
      const path = await writeTranscript(id, [{ type: 'USER_INPUT', step_index: 1, created_at: createdAt, content: title }])
      await utimes(path, time, time)
    }
    const dbPath = join(base, 'missing.db')
    const sessions = await discoverAntigravitySessions('', 10, base, dbPath)
    expect(sessions).toMatchObject([
      { conversationId: 'newer-session', title: 'Newer conversation', updatedAt: 2_000_000 },
      { conversationId: 'older-session', title: 'Older conversation', updatedAt: 1_000_000 },
    ])
    expect(await discoverAntigravitySessions('', 1, base, dbPath)).toEqual(sessions.slice(0, 1))
  })

  it('discovers only existing project directories from an isolated database', async () => {
    const project = join(base, 'project with spaces')
    const file = join(base, 'not-a-directory')
    await mkdir(project)
    await writeFile(file, 'fixture')
    const { db, dbPath } = createDatabase()
    try {
      const insert = db.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?)')
      insert.run('project-session', 'Project', JSON.stringify([
        pathToFileURL(project).href, pathToFileURL(project).href,
        pathToFileURL(file).href, pathToFileURL(join(base, 'missing-project')).href,
        'https://example.invalid/project',
      ]), 2, createdAt)
      insert.run('malformed-session', 'Malformed', 'not-json', 2, createdAt)
    } finally {
      db.close()
    }
    expect(await discoverAntigravityWorkspaces(dbPath, base)).toEqual([project])
  })

  it('matches decoded workspace URIs exactly and applies the limit after scoping', async () => {
    const project = join(base, '项目 with spaces')
    const other = `${project}-other`
    const { db, dbPath } = createDatabase()
    try {
      const insert = db.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?)')
      insert.run('foreign-session', 'Foreign', JSON.stringify([pathToFileURL(other).href]), 2, '2026-10-07T00:01:00Z')
      insert.run('local-session', 'Local', JSON.stringify([pathToFileURL(project).href]), 2, createdAt)
      insert.run('malformed-session', 'Malformed', 'not-json', 2, createdAt)
    } finally { db.close() }
    expect(await discoverAntigravitySessions(project, 1, base, dbPath)).toMatchObject([
      { conversationId: 'local-session', title: 'Local' },
    ])
    expect(await discoverAntigravitySessions(join(base, 'unrelated'), 10, base, dbPath)).toEqual([])
  })

  it('does not infer a workspace from unrelated transcripts when the database is missing', async () => {
    await writeTranscript('foreign-session', [{ type: 'USER_INPUT', step_index: 1, created_at: createdAt, content: 'Foreign' }])
    expect(await discoverAntigravitySessions(join(base, 'project'), 10, base, join(base, 'missing.db'))).toEqual([])
  })

  it('rejects traversal and symlinked transcripts outside the AGY brain', async () => {
    await writeTranscript('outside-session', [{ type: 'USER_INPUT', step_index: 1, created_at: createdAt, content: 'Outside' }])
    const brain = join(base, 'brain')
    await mkdir(brain)
    await symlink(join(base, 'outside-session'), join(brain, 'linked-session'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await loadTranscriptEvents('../outside-session', 'remote', brain)).toEqual([])
    expect(await loadTranscriptEvents('..\\outside-session', 'remote', brain)).toEqual([])
    expect(await loadTranscriptEvents('linked-session', 'remote', brain)).toEqual([])
    expect(await discoverAntigravitySessions('', 10, brain, join(base, 'missing.db'))).toEqual([])
  })

  it('hydrates tool calls with a valid name and callId, including unnamed tools', async () => {
    await writeTranscript('tool-conversation', [
      { type: 'USER_INPUT', step_index: 1, created_at: createdAt, content: 'Run the tool' },
      { type: 'PLANNER_RESPONSE', step_index: 2, created_at: createdAt, tool_calls: [
        { name: 'view_file', args: { path: 'fixture.txt' } },
        { args: {} },
      ] },
    ])
    const events = await loadTranscriptEvents('tool-conversation', 'antigravity:tool-conversation', base)
    const toolCalls = events.filter(e => e.event.type === 'tool/call')
    expect(toolCalls.map(e => e.event.data)).toMatchObject([
      { name: 'view_file', callId: '2:view_file' },
      { name: 'tool', callId: '2:tool' },
    ])
  })
})
