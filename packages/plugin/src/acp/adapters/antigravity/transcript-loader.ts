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
          const toolName = (typeof call.name === 'string' && call.name.length > 0) ? call.name : 'tool'
          const callId = `${record.step_index}:${toolName}`
          push('tool/call', {
            turn: currentTurn,
            step: 1,
            callId,
            name: toolName,
            arguments: typeof call.args === 'object' && call.args !== null ? JSON.stringify(call.args) : '{}',
            toolCallId: callId,
            toolName,
            status: call.status === 'ERROR' ? 'failed' : 'finished',
          }, time, false)
        }
      }

      if (record.content && record.content.trim() !== '') {
        const contentBlocks: Array<{ type: string; text: string }> = []
        if (record.thinking && record.thinking.trim() !== '') {
          contentBlocks.push({ type: 'reasoning', text: record.thinking.trim() })
        }
        contentBlocks.push({ type: 'text', text: record.content.trim() })

        push('assistant/message', {
          turn: currentTurn,
          step: 1,
        message: {
          id: `${sessionId}:${record.step_index}`,
          role: 'assistant',
          content: contentBlocks,
          source: { kind: 'model', provider: 'google', model: 'gemini' },
        },
        // Harness trajectory timing expects every assistant message to carry
        // an iterable stream, including messages restored from transcript.
        stream: [],
      }, time, true)
      }
    }
  }

  if (turnOpen) {
    // Hydration must not extend a settled turn until the time of the read.
    const settledAt = events.at(-1)?.event.time ?? Date.now()
    push('step/end', { turn: currentTurn, step: 1 }, settledAt)
    push('turn/end', { turn: currentTurn, reason: { kind: 'completed' } }, settledAt)
  }

  return events
}

export interface DiscoveredSession {
  conversationId: string
  title: string
  createdAt: number
  updatedAt: number
}

async function querySqliteJson<T = unknown>(dbPath: string, sql: string, params: Array<string | number> = []): Promise<T[]> {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const stmt = db.prepare(sql)
      const rows = stmt.all(...params)
      return rows as T[]
    } finally {
      db.close()
    }
  } catch {
    // fallback to sqlite3 CLI
  }

  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    let formattedSql = sql
    for (const p of params) {
      const val = typeof p === 'number' ? String(p) : `'${String(p).replace(/'/g, "''")}'`
      formattedSql = formattedSql.replace('?', val)
    }
    const { stdout } = await execFileAsync('sqlite3', [dbPath, '-json', formattedSql])
    return JSON.parse(stdout || '[]') as T[]
  } catch {
    return []
  }
}

export async function discoverAntigravityWorkspaces(
  dbPath: string = join(homedir(), '.gemini/antigravity-cli/conversation_summaries.db'),
  baseDir: string = join(homedir(), '.gemini/antigravity-cli/brain'),
): Promise<string[]> {
  try {
    await fs.stat(dbPath)
  } catch {
    return []
  }

  const sql = "SELECT conversation_id, workspace_uris, step_count, title FROM conversation_summaries ORDER BY step_count DESC;"
  const rows = await querySqliteJson<{ conversation_id: string; workspace_uris?: string; step_count?: number; title?: string }>(dbPath, sql)
  const paths = new Set<string>()

  for (const row of rows) {
    if (!row?.workspace_uris) continue
    if (!(row.step_count && row.step_count > 0) && !row.title?.trim() && !await readTranscriptSummary(baseDir, row.conversation_id)) continue
    try {
      const uris = JSON.parse(row.workspace_uris)
      if (Array.isArray(uris)) {
        for (const u of uris) {
          if (typeof u === 'string' && u.startsWith('file://')) {
            try {
              const parsed = new URL(u)
              let p = decodeURIComponent(parsed.pathname)
              if (process.platform === 'win32' && p.startsWith('/') && p.length > 2 && p[2] === ':') {
                p = p.slice(1)
              }
              paths.add(p)
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const verified: string[] = []
  for (const p of paths) {
    try {
      const s = await fs.stat(p)
      if (s.isDirectory()) verified.push(p)
    } catch {
      // ignore
    }
  }
  return verified
}

async function readTranscriptSummary(baseDir: string, conversationId: string): Promise<DiscoveredSession | undefined> {
  if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) return undefined
  const path = join(baseDir, conversationId, '.system_generated/logs/transcript.jsonl')
  try {
    const stat = await fs.stat(path)
    const handle = await fs.open(path, 'r')
    try {
      const buffer = Buffer.alloc(4096)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const firstLine = buffer.subarray(0, bytesRead).toString('utf-8').split('\n')[0]
      if (!firstLine) return undefined
      const record = JSON.parse(firstLine) as StepLogRecord
      if (record.type !== 'USER_INPUT') return undefined
      const title = cleanUserPrompt(record.content).split('\n')[0]?.trim().slice(0, 40)
      if (!title) return undefined
      return { conversationId, title, createdAt: record.created_at ? new Date(record.created_at).getTime() : stat.mtimeMs, updatedAt: stat.mtimeMs }
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

export async function discoverAntigravitySessions(
  workspacePath: string,
  limit: number = 30,
  baseDir: string = join(homedir(), '.gemini/antigravity-cli/brain'),
  dbPath: string = join(homedir(), '.gemini/antigravity-cli/conversation_summaries.db'),
): Promise<DiscoveredSession[]> {
  // 1. Try querying from conversation_summaries.db
  try {
    await fs.stat(dbPath)
    let sql = 'SELECT conversation_id, title, workspace_uris, step_count, last_modified_time FROM conversation_summaries WHERE (step_count > 0 OR title != \'\')'
    const params: Array<string | number> = []
    if (workspacePath && workspacePath.trim() !== '') {
      sql += ' AND workspace_uris LIKE ?'
      params.push(`%${workspacePath.trim()}%`)
    }
    sql += ' ORDER BY last_modified_time DESC LIMIT ?;'
    params.push(limit)

    interface DbSessionRow {
      conversation_id: string
      title?: string
      step_count?: number
      last_modified_time?: string
    }

    const rows = await querySqliteJson<DbSessionRow>(dbPath, sql, params)
    // Concurrent idle AGY processes can leave an empty summary for a durable
    // conversation. Use its transcript, but only within the DB workspace filter.
    const emptySql = sql.replace("(step_count > 0 OR title != '')", "(step_count = 0 AND title = '')")
    const emptyRows = await querySqliteJson<DbSessionRow>(dbPath, emptySql, params)
    const recovered = (await Promise.all(emptyRows.map(row => readTranscriptSummary(baseDir, row.conversation_id))))
      .filter((item): item is DiscoveredSession => item !== undefined)
    if (rows.length > 0 || emptyRows.length > 0) {
      const summaries = await Promise.all(rows.map(async r => {
        const time = r.last_modified_time ? new Date(r.last_modified_time).getTime() : Date.now()
        const transcript = r.title?.trim() ? undefined : await readTranscriptSummary(baseDir, r.conversation_id)
        return {
          conversationId: r.conversation_id,
          title: r.title?.trim() || transcript?.title || 'Untitled Session',
          createdAt: time,
          updatedAt: time,
        }
      }))
      return [...summaries, ...recovered].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
    }
  } catch {
    // fallback to filesystem scanning
  }

  // 2. Fallback to filesystem scanning
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
