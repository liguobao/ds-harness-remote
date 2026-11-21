import { AGY_IMAGE_ROOT, stripAgyImageReferences, agyImageReferences, readAgyImage } from './image-store.js'
import { promises as fs } from 'node:fs'
import { MAX_AGENT_ACP_TRANSFER_BYTES } from '@dsh-remote/protocol'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { RpcError } from '../../../safe-error.js'
import type { StepLogRecord } from './types.js'

// Load prefix-only Node builtins natively, including under older Vite runners.
const nodeRequire = createRequire(import.meta.url)

const FIRST_LINE_CHUNK_BYTES = 4096
const MAX_FIRST_LINE_BYTES = 256 * 1024

async function readFirstLine(handle: fs.FileHandle): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  while (totalBytes <= MAX_FIRST_LINE_BYTES) {
    const chunk = Buffer.allocUnsafe(FIRST_LINE_CHUNK_BYTES)
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, totalBytes)
    if (bytesRead === 0) break
    const slice = chunk.subarray(0, bytesRead)
    const newlineIndex = slice.indexOf(0x0a)
    if (newlineIndex !== -1) {
      const lineBytes = totalBytes + newlineIndex
      if (lineBytes > MAX_FIRST_LINE_BYTES) return undefined
      chunks.push(slice.subarray(0, newlineIndex))
      return Buffer.concat(chunks, lineBytes).toString('utf-8')
    }
    totalBytes += bytesRead
    if (totalBytes > MAX_FIRST_LINE_BYTES) return undefined
    chunks.push(slice)
  }
  return totalBytes > 0 ? Buffer.concat(chunks, totalBytes).toString('utf-8') : undefined
}

export interface HydratedSessionEvent {
  type: 'event'
  event: {
    type: string
    seq: number
    time: number
    data: unknown
    sourceEventSeqs?: number[]
    surfaceOp?: 'append'
  }
}

interface TranscriptCacheEntry {
  baseDir: string
  mtimeMs: number
  size: number
  bytes: number
  events: HydratedSessionEvent[]
}

/**
 * Host-process memory cache of parsed Antigravity transcripts. Entries are
 * invalidated by (mtime, size) of the transcript file and never persisted to
 * disk, matching the ACP memory-projection boundary. Bounded LRU so one Host
 * serving many long conversations cannot grow without limit.
 */
const transcriptCache = new Map<string, TranscriptCacheEntry>()
const TRANSCRIPT_CACHE_MAX_SESSIONS = 32
const TRANSCRIPT_CACHE_MAX_EVENTS = 100_000
const TRANSCRIPT_CACHE_MAX_BYTES = 64 * 1024 * 1024

function rememberTranscript(conversationId: string, entry: TranscriptCacheEntry): void {
  if (entry.bytes > TRANSCRIPT_CACHE_MAX_BYTES) return
  transcriptCache.delete(conversationId)
  transcriptCache.set(conversationId, entry)
  let sessions = transcriptCache.size
  let totalEvents = 0
  let totalBytes = 0
  for (const cached of transcriptCache.values()) {
    totalEvents += cached.events.length
    totalBytes += cached.bytes
  }
  while (transcriptCache.size > 0
    && (sessions > TRANSCRIPT_CACHE_MAX_SESSIONS
      || totalEvents > TRANSCRIPT_CACHE_MAX_EVENTS
      || totalBytes > TRANSCRIPT_CACHE_MAX_BYTES)) {
    const oldest = transcriptCache.keys().next().value
    if (oldest === undefined) break
    const evicted = transcriptCache.get(oldest)!
    totalEvents -= evicted.events.length
    totalBytes -= evicted.bytes
    transcriptCache.delete(oldest)
    sessions -= 1
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
  baseDir: string = join(homedir(), '.gemini/antigravity-cli/brain'),
): Promise<HydratedSessionEvent[]> {
  let content = ''
  let mtimeMs = 0
  let sizeBytes = 0
  try {
    const filePath = await transcriptPath(baseDir, conversationId)
    if (filePath === undefined) return []
    const info = await fs.stat(filePath)
    mtimeMs = info.mtimeMs
    sizeBytes = info.size
    if (info.size > MAX_AGENT_ACP_TRANSFER_BYTES) {
      throw new RpcError('ACP_HISTORY_TOO_LARGE', 'Antigravity history exceeds the transfer limit.')
    }
    const cached = transcriptCache.get(conversationId)
    if (cached !== undefined && cached.baseDir === baseDir
      && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      // Refresh LRU recency; seq assignment is deterministic per file version.
      rememberTranscript(conversationId, cached)
      return cached.events
    }
    content = await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    if (error instanceof RpcError) throw error
    return []
  }

  const lines = content.split('\n')
  const events: HydratedSessionEvent[] = []
  let currentSeq = 0
  let currentTurn = 0
  let turnOpen = false

  const push = (type: string, data: unknown, time: number, surface = false, sourceEventSeqs?: number[]) => {
    events.push({
      type: 'event',
      event: {
        type,
        seq: currentSeq++,
        time,
        data,
        ...(sourceEventSeqs ? { sourceEventSeqs } : {}),
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
        const seenNames = new Map<string, number>()
        for (const call of record.tool_calls) {
          const toolName = (typeof call.name === 'string' && call.name.length > 0) ? call.name : 'tool'
          const count = seenNames.get(toolName) ?? 0
          seenNames.set(toolName, count + 1)
          const callId = count === 0 ? `${record.step_index}:${toolName}` : `${record.step_index}:${toolName}:${count}`
          const isError = call.status === 'ERROR'
          const callSeq = currentSeq
          push('tool/call', {
            turn: currentTurn,
            step: 1,
            callId,
            name: toolName,
            arguments: typeof call.args === 'object' && call.args !== null ? JSON.stringify(call.args) : '{}',
            toolCallId: callId,
            toolName,
            status: isError ? 'failed' : 'finished',
          }, time, false)
          if (call.status !== 'CALLING' && call.status !== 'EXECUTING') {
            let resultText = ''
            if (typeof call.result === 'string') {
              resultText = call.result
            } else if (call.result !== undefined && call.result !== null) {
              try {
                resultText = JSON.stringify(call.result)
              } catch {
                resultText = ''
              }
            }
            push('tool/result', {
              turn: currentTurn,
              step: 1,
              message: {
                id: `${sessionId}:${record.step_index}:tool-result:${callId}`,
                role: 'user',
                source: { kind: 'tool', callId },
                content: [{
                  type: 'tool-result',
                  toolCallId: callId,
                  content: resultText.length > 0 ? [{ type: 'text', text: resultText }] : [],
                  ...(isError ? { isError: true } : {}),
                }],
              },
            }, time, true, [callSeq])
          }
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

  const bytes = Buffer.byteLength(JSON.stringify(events), 'utf8')
  rememberTranscript(conversationId, { baseDir, mtimeMs, size: sizeBytes, bytes, events })
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
    const { stdout } = await execFileAsync('sqlite3', [dbPath, '-json', formattedSql], { windowsHide: true })
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
  try {
    const path = await transcriptPath(baseDir, conversationId)
    if (path === undefined) return undefined
    const stat = await fs.stat(path)
    const handle = await fs.open(path, 'r')
    try {
      const firstLine = await readFirstLine(handle)
      if (!firstLine) return undefined
      const record = JSON.parse(firstLine) as StepLogRecord
      if (record.type !== 'USER_INPUT') return undefined
      const title = cleanUserPrompt(record.content).split('\n')[0]?.trim().slice(0, 40) || (agyImageReferences(record.content ?? '').length > 0 ? 'Image' : undefined)
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
  const requestedWorkspace = workspacePath.trim() === '' ? undefined : resolve(workspacePath)
  // Database URIs provide workspace authority. Decode them before comparing so
  // percent-encoded names, path separators, and similarly named projects stay distinct.
  try {
    await fs.stat(dbPath)
    interface DbSessionRow {
      conversation_id: string
      title?: string
      workspace_uris?: string
      step_count?: number
      last_modified_time?: string
    }
    const rows = await querySqliteJson<DbSessionRow>(dbPath,
      'SELECT conversation_id, title, workspace_uris, step_count, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC;')
    const summaries: DiscoveredSession[] = []
    for (const row of rows) {
      if (requestedWorkspace !== undefined && !workspaceMatches(row.workspace_uris, requestedWorkspace)) continue
      const transcript = row.title?.trim() ? undefined : await readTranscriptSummary(baseDir, row.conversation_id)
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
      })
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  } catch {
    // Unscoped discovery may fall back to transcript scanning without a database.
  }
  // A transcript alone does not establish which project it belongs to.
  if (requestedWorkspace !== undefined) return []

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
    try {
      const path = await transcriptPath(baseDir, entry)
      if (path === undefined) continue
      const s = await fs.stat(path)
      const handle = await fs.open(path, 'r')
      try {
        const firstLine = await readFirstLine(handle)
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

/** Remote conversation ids can select only a real transcript inside the AGY brain. */
async function transcriptPath(baseDir: string, conversationId: string): Promise<string | undefined> {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(conversationId)) return undefined
  try {
    const root = await fs.realpath(baseDir)
    const expected = join(root, conversationId, '.system_generated', 'logs', 'transcript.jsonl')
    return await fs.realpath(expected) === expected ? expected : undefined
  } catch { return undefined }
}
