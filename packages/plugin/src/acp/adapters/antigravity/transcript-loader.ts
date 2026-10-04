import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { StepLogRecord } from './types.js'

export interface HydratedSessionEvent {
  type: 'event'
  event: {
    type: string
    seq: number
    time: number
    data: unknown
    surfaceOp?: 'append'
  }
}

export function cleanUserPrompt(raw?: string): string {
  if (!raw) return ''
  const match = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/)
  if (match && match[1]) {
    return match[1].trim()
  }
  return raw.trim()
}

export async function loadTranscriptEvents(
  conversationId: string,
  sessionId: string,
  baseDir: string = join(homedir(), '.gemini/antigravity-cli/brain'),
): Promise<HydratedSessionEvent[]> {
  const filePath = join(baseDir, conversationId, '.system_generated/logs/transcript.jsonl')
  let content = ''
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    return []
  }

  const lines = content.split('\n')
  const events: HydratedSessionEvent[] = []
  let currentSeq = 0
  let currentTurn = 0
  let turnOpen = false

  const push = (type: string, data: unknown, time: number, surface = false) => {
    events.push({
      type: 'event',
      event: {
        type,
        seq: currentSeq++,
        time,
        data,
        ...(surface ? { surfaceOp: 'append' } : {}),
      },
    })
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let record: StepLogRecord
    try {
      record = JSON.parse(trimmed) as StepLogRecord
    } catch {
      continue
    }

    const time = record.created_at ? new Date(record.created_at).getTime() : Date.now()

    if (record.type === 'USER_INPUT') {
      if (turnOpen) {
        push('step/end', { turn: currentTurn, step: 1 }, time)
        push('turn/end', { turn: currentTurn, reason: { kind: 'completed' } }, time)
        turnOpen = false
      }
      currentTurn += 1
      turnOpen = true
      push('turn/start', { turn: currentTurn }, time)
      push('step/start', { turn: currentTurn, step: 1 }, time)

      const text = cleanUserPrompt(record.content)
      push('user/message', {
        id: `user:${record.step_index}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }, time, true)
    } else if (record.type === 'PLANNER_RESPONSE') {
      if (!turnOpen) {
        currentTurn += 1
        turnOpen = true
        push('turn/start', { turn: currentTurn }, time)
        push('step/start', { turn: currentTurn, step: 1 }, time)
      }

      if (Array.isArray(record.tool_calls)) {
        for (const call of record.tool_calls) {
          push('tool/call', {
            turn: currentTurn,
            step: 1,
            toolCallId: `${record.step_index}:${call.name}`,
            toolName: call.name,
            status: call.status === 'ERROR' ? 'failed' : 'finished',
          }, time, false)
        }
      }

      if (record.content && record.content.trim() !== '') {
        push('assistant/message', {
          turn: currentTurn,
          step: 1,
          message: {
            id: `${sessionId}:${currentTurn}`,
            role: 'assistant',
            content: [{ type: 'text', text: record.content }],
            source: { kind: 'model', provider: 'google', model: 'gemini' },
          },
          stream: [],
        }, time, true)

        push('step/end', { turn: currentTurn, step: 1 }, time)
        push('turn/end', { turn: currentTurn, reason: { kind: 'completed' } }, time)
        turnOpen = false
      }
    }
  }

  if (turnOpen) {
    push('step/end', { turn: currentTurn, step: 1 }, Date.now())
    push('turn/end', { turn: currentTurn, reason: { kind: 'completed' } }, Date.now())
  }

  return events
}

export interface DiscoveredSession {
  conversationId: string
  title: string
  createdAt: number
  updatedAt: number
}

export async function discoverAntigravitySessions(
  _workspacePath: string,
  limit: number = 30,
  baseDir: string = join(homedir(), '.gemini/antigravity-cli/brain'),
): Promise<DiscoveredSession[]> {
  let dirEntries: string[]
  try {
    dirEntries = await fs.readdir(baseDir)
  } catch {
    return []
  }

  const results: DiscoveredSession[] = []
  for (const entry of dirEntries) {
    if (entry === 'tempmediaStorage' || !entry.includes('-')) continue
    const transcriptPath = join(baseDir, entry, '.system_generated/logs/transcript.jsonl')
    try {
      const s = await fs.stat(transcriptPath)
      const handle = await fs.open(transcriptPath, 'r')
      try {
        const buf = Buffer.alloc(4096)
        const { bytesRead } = await handle.read(buf, 0, 4096, 0)
        const firstLine = buf.subarray(0, bytesRead).toString('utf-8').split('\n')[0]
        if (firstLine) {
          const parsed = JSON.parse(firstLine) as StepLogRecord
          const rawPrompt = cleanUserPrompt(parsed.content)
          const title = rawPrompt ? rawPrompt.split('\n')[0]?.trim().slice(0, 40) : undefined
          if (title) {
            const createdAt = parsed.created_at ? new Date(parsed.created_at).getTime() : s.mtimeMs
            results.push({
              conversationId: entry,
              title,
              createdAt,
              updatedAt: s.mtimeMs,
            })
          }
        }
      } finally {
        await handle.close()
      }
    } catch {
      // ignore
    }
  }

  results.sort((a, b) => b.updatedAt - a.updatedAt)
  return results.slice(0, limit)
}
