import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TranscriptWatcher } from '../src/acp/adapters/antigravity/transcript-watcher.js'
import type { StepLogRecord } from '../src/acp/adapters/antigravity/types.js'

describe('TranscriptWatcher', () => {
  let testDir: string
  let brainDir: string
  const conversationId = 'test-conv-123'

  beforeEach(async () => {
    testDir = await fs.mkdtemp(join(tmpdir(), 'agy-watcher-test-'))
    brainDir = join(testDir, conversationId, '.system_generated/logs')
    await fs.mkdir(brainDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('incrementally tails transcript.jsonl and dispatches thinking, toolCall and message events', async () => {
    const watcher = new TranscriptWatcher(conversationId, testDir)
    const messages: string[] = []
    const thinkings: string[] = []
    const toolCalls: any[] = []
    const completed: string[] = []

    watcher.on('message', e => messages.push(e.text))
    watcher.on('thinking', e => thinkings.push(e.thinking))
    watcher.on('toolCall', e => toolCalls.push(...e.toolCalls))
    watcher.on('complete', id => completed.push(id))

    watcher.start(50)

    const transcriptFile = join(brainDir, 'transcript.jsonl')

    // Step 1: USER_INPUT
    const userStep: StepLogRecord = {
      step_index: 1,
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-10-04T10:00:00Z',
      content: 'Hello Antigravity',
    }
    await fs.appendFile(transcriptFile, `${JSON.stringify(userStep)}\n`)

    await new Promise(r => setTimeout(r, 120))
    expect(messages).toEqual(['Hello Antigravity'])

    // Step 2: PLANNER_RESPONSE with thinking and toolCall
    const plannerStep: StepLogRecord = {
      step_index: 2,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-04T10:00:05Z',
      thinking: 'Thinking about the user question...',
      tool_calls: [{ name: 'view_file', args: { path: '/tmp' }, status: 'SUCCESS' }],
      content: 'I have found the file.',
    }
    await fs.appendFile(transcriptFile, `${JSON.stringify(plannerStep)}\n`)

    await new Promise(r => setTimeout(r, 150))
    expect(thinkings).toEqual(['Thinking about the user question...'])
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].name).toBe('view_file')
    expect(messages).toEqual(['Hello Antigravity', 'I have found the file.'])
    expect(completed).toEqual([conversationId])

    watcher.stop()
  })

  it('enriches truncated fields from transcript_full.jsonl', async () => {
    const watcher = new TranscriptWatcher(conversationId, testDir)
    const messages: string[] = []
    watcher.on('message', e => messages.push(e.text))

    const transcriptFile = join(brainDir, 'transcript.jsonl')
    const fullTranscriptFile = join(brainDir, 'transcript_full.jsonl')

    // Write full record
    const fullRecord: StepLogRecord = {
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-04T10:00:00Z',
      content: 'Very long full content that was truncated in compact log',
    }
    await fs.writeFile(fullTranscriptFile, `${JSON.stringify(fullRecord)}\n`)

    // Write compact record with truncated_fields
    const compactRecord: StepLogRecord = {
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-04T10:00:00Z',
      content: 'truncated...',
      truncated_fields: ['content'],
    }
    await fs.writeFile(transcriptFile, `${JSON.stringify(compactRecord)}\n`)

    await watcher.flush()

    expect(messages).toEqual(['Very long full content that was truncated in compact log'])
    watcher.stop()
  })
})
