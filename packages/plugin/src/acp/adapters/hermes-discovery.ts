import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

export interface HermesDiscoveredSession {
  sessionId: string
  cwd: string
  title: string
  updatedAt: string
}

function hermesStateDbPath(): string {
  const env = process.env.HERMES_HOME
  if (env && env.trim() !== '') return join(env.trim(), 'state.db')
  return join(homedir(), '.hermes', 'state.db')
}

async function querySqlite<T = unknown>(dbPath: string, sql: string, params: Array<string | number> = []): Promise<T[]> {
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

function normalizePath(p: string): string {
  try {
    return resolve(p).toLowerCase().split(String.fromCharCode(92)).join('/')
  } catch {
    return p.toLowerCase().split(String.fromCharCode(92)).join('/')
  }
}

export async function discoverHermesWorkspaces(): Promise<string[]> {
  const dbPath = hermesStateDbPath()
  try {
    const s = await stat(dbPath)
    if (!s.isFile()) return []
  } catch {
    return []
  }

  const sql = "SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL AND cwd != '' AND message_count > 0 ORDER BY rowid DESC;"
  interface Row { cwd: string }
  const rows = await querySqlite<Row>(dbPath, sql)
  const results = new Map<string, string>()
  for (const r of rows) {
    if (!r?.cwd) continue
    const norm = normalizePath(r.cwd)
    if (results.has(norm)) continue
    try {
      const dirStat = await stat(r.cwd)
      if (dirStat.isDirectory()) {
        results.set(norm, r.cwd)
      }
    } catch {
      // directory no longer exists on host
    }
  }
  return [...results.values()]
}

export async function discoverHermesSessions(cwd: string, limit: number = 30): Promise<HermesDiscoveredSession[]> {
  const dbPath = hermesStateDbPath()
  try {
    const s = await stat(dbPath)
    if (!s.isFile()) return []
  } catch {
    return []
  }

  const sql = "SELECT id, cwd, title, started_at, last_activity_at FROM sessions WHERE message_count > 0 ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT 1000;"
  interface Row {
    id: string
    cwd: string
    title: string | null
    started_at: number | null
    last_activity_at: number | null
  }
  const rows = await querySqlite<Row>(dbPath, sql)
  const targetNorm = normalizePath(cwd)
  const matched: HermesDiscoveredSession[] = []

  for (const r of rows) {
    if (!r?.cwd || !r.id) continue
    if (normalizePath(r.cwd) !== targetNorm) continue
    const tsSec = r.last_activity_at || r.started_at || 0
    const date = tsSec > 0 ? new Date(tsSec * 1000).toISOString() : new Date().toISOString()
    matched.push({
      sessionId: r.id,
      cwd,
      title: r.title?.trim() || 'Untitled Session',
      updatedAt: date,
    })
    if (matched.length >= limit) break
  }

  return matched
}
