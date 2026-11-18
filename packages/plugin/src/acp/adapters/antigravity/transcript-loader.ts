import { AGY_IMAGE_ROOT, stripAgyImageReferences, agyImageReferences, readAgyImage } from './image-store.js'
import { promises as fs } from 'node:fs'
import { MAX_AGENT_ACP_TRANSFER_BYTES } from '@dsh-remote/protocol'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  resolveAntigravityEnds,
  resolveBrainDirs,
  resolveTranscriptPath,
  publicSource,
  type AntigravityEnd,
  type AntigravitySource,
} from './antigravity-paths.js'
import type { StepLogRecord } from './types.js'

// Load prefix-only Node builtins natively, including under older Vite runners.
const nodeRequire = createRequire(import.meta.url)

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
  raw = stripAgyImageReferences(raw)
  const match = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/)
  if (match && match[1]) {
    return match[1].trim()
  }
  return raw.trim()
}

export async function loadTranscriptEvents(
  conversationId: string,
  sessionId: string,
  baseDir?: string | readonly string[],
): Promise<HydratedSessionEvent[]> {
  let content = ''
  try {
    // An explicit baseDir keeps the original single-root behavior; the default
    // checks every configured brain root and reads the most recently updated
    // transcript for this conversation.
    const candidates: Array<{ path: string; mtimeMs: number }> = []
    for (const brainDir of resolveBrainDirs(baseDir)) {
      const path = await resolveTranscriptPath(brainDir, conversationId)
      if (path === undefined) continue
      const stat = await fs.stat(path)
      if (stat.size > MAX_AGENT_ACP_TRANSFER_BYTES) return []
      candidates.push({ path, mtimeMs: stat.mtimeMs })
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const newest = candidates[0]
    if (newest === undefined) return []
    content = await fs.readFile(newest.path, 'utf-8')
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
      const images = (await Promise.all(agyImageReferences(record.content ?? '').map(path => readAgyImage(conversationId, path))))
        .filter((image): image is Record<string, unknown> => image !== undefined)
      push('user/message', {
        id: `user:${record.step_index}`,
        role: 'user',
        content: [...(text ? [{ type: 'text', text }] : []), ...images],
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
  /** Which Antigravity data root won this session; absent for explicit single-path callers. */
  source?: AntigravitySource
}

async function querySqliteJson<T = unknown>(dbPath: string, sql: string, params: Array<string | number> = []): Promise<T[]> {
  try {
    const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite')
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
  dbPath?: string,
  baseDir?: string,
): Promise<string[]> {
  const paths = new Set<string>()
  for (const end of resolveAntigravityEnds({ dbPath, brainDir: baseDir })) {
    for (const path of await workspacesFromEnd(end)) paths.add(path)
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

async function workspacesFromEnd(end: AntigravityEnd): Promise<string[]> {
  try {
    await fs.stat(end.dbPath)
  } catch {
    return []
  }

  const sql = "SELECT conversation_id, workspace_uris, step_count, title FROM conversation_summaries ORDER BY step_count DESC;"
  const rows = await querySqliteJson<{ conversation_id: string; workspace_uris?: string; step_count?: number; title?: string }>(end.dbPath, sql)
  const paths = new Set<string>()

  for (const row of rows) {
    if (!row?.workspace_uris) continue
    if (!(row.step_count && row.step_count > 0) && !row.title?.trim() && !await readTranscriptSummary(end.brainDir, row.conversation_id)) continue
    try {
      const uris = JSON.parse(row.workspace_uris)
      if (Array.isArray(uris)) {
        for (const u of uris) {
          if (typeof u === 'string' && u.startsWith('file://')) {
            try {
              const p = fileURLToPath(u)
              const imageRelative = relative(AGY_IMAGE_ROOT, p)
              const imageCache = imageRelative === '' || (!isAbsolute(imageRelative)
                && imageRelative !== '..' && !imageRelative.startsWith(`..${sep}`))
              if (!imageCache) paths.add(p)
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
  return [...paths]
}

async function readTranscriptSummary(
  baseDir: string,
  conversationId: string,
  source?: AntigravitySource,
): Promise<DiscoveredSession | undefined> {
  try {
    const path = await resolveTranscriptPath(baseDir, conversationId)
    if (path === undefined) return undefined
    const stat = await fs.stat(path)
    const handle = await fs.open(path, 'r')
    try {
      const buffer = Buffer.alloc(4096)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const firstLine = buffer.subarray(0, bytesRead).toString('utf-8').split('\n')[0]
      if (!firstLine) return undefined
      const record = JSON.parse(firstLine) as StepLogRecord
      if (record.type !== 'USER_INPUT') return undefined
      const title = cleanUserPrompt(record.content).split('\n')[0]?.trim().slice(0, 40) || (agyImageReferences(record.content ?? '').length > 0 ? 'Image' : undefined)
      if (!title) return undefined
      return {
        conversationId,
        title,
        createdAt: record.created_at ? new Date(record.created_at).getTime() : stat.mtimeMs,
        updatedAt: stat.mtimeMs,
        ...(source === undefined ? {} : { source }),
      }
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
  baseDir?: string,
  dbPath?: string,
): Promise<DiscoveredSession[]> {
  const requestedWorkspace = workspacePath.trim() === '' ? undefined : resolve(workspacePath)
  const ends = resolveAntigravityEnds({ dbPath, brainDir: baseDir })
  // Discover every root before applying the limit; otherwise one root with
  // many recent sessions could hide a newer session from the other root.
  const found = (await Promise.all(ends.map(end => sessionsFromEnd(end, requestedWorkspace)))).flat()
  const merged = new Map<string, DiscoveredSession>()
  for (const session of found) {
    const previous = merged.get(session.conversationId)
    if (previous === undefined || session.updatedAt > previous.updatedAt) merged.set(session.conversationId, session)
  }
  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

async function sessionsFromEnd(end: AntigravityEnd, requestedWorkspace?: string): Promise<DiscoveredSession[]> {
  const source = publicSource(end)
  // Database URIs provide workspace authority. Decode them before comparing so
  // percent-encoded names, path separators, and similarly named projects stay distinct.
  try {
    await fs.stat(end.dbPath)
    interface DbSessionRow {
      conversation_id: string
      title?: string
      workspace_uris?: string
      step_count?: number
      last_modified_time?: string
    }
    const rows = await querySqliteJson<DbSessionRow>(end.dbPath,
      'SELECT conversation_id, title, workspace_uris, step_count, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC;')
    const summaries: DiscoveredSession[] = []
    for (const row of rows) {
      if (requestedWorkspace !== undefined && !workspaceMatches(row.workspace_uris, requestedWorkspace)) continue
      const transcript = row.title?.trim() ? undefined : await readTranscriptSummary(end.brainDir, row.conversation_id, source)
      if (!row.step_count && !row.title?.trim()) {
        if (transcript !== undefined) summaries.push(transcript)
        continue
      }
      const time = row.last_modified_time ? new Date(row.last_modified_time).getTime() : Date.now()
      summaries.push({
        conversationId: row.conversation_id,
        title: row.title?.trim() || transcript?.title || 'Untitled Session',
        createdAt: time,
        updatedAt: time,
        ...(source === undefined ? {} : { source }),
      })
    }
    return summaries
  } catch {
    // Unscoped discovery may fall back to transcript scanning without a database.
  }
  // A transcript alone does not establish which project it belongs to.
  if (requestedWorkspace !== undefined) return []

  // Fallback to filesystem scanning
  let dirEntries: string[]
  try {
    dirEntries = await fs.readdir(end.brainDir)
  } catch {
    return []
  }

  const results: DiscoveredSession[] = []
  for (const entry of dirEntries) {
    if (entry === 'tempmediaStorage' || !entry.includes('-')) continue
    try {
      const path = await resolveTranscriptPath(end.brainDir, entry)
      if (path === undefined) continue
      const s = await fs.stat(path)
      const handle = await fs.open(path, 'r')
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
              ...(source === undefined ? {} : { source }),
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
  return results
}

function workspaceMatches(rawUris: string | undefined, requestedWorkspace: string): boolean {
  if (rawUris === undefined) return false
  try {
    const uris: unknown = JSON.parse(rawUris)
    return Array.isArray(uris) && uris.some(uri => {
      if (typeof uri !== 'string') return false
      try { return resolve(fileURLToPath(uri)) === requestedWorkspace } catch { return false }
    })
  } catch { return false }
}

