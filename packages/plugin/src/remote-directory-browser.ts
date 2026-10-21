import { mkdir, readdir, stat } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { basename, dirname, isAbsolute, parse, resolve } from 'node:path'

interface DirectoryEntry { name: string; path: string; hidden: boolean }
export interface DirectoryListing {
  path: string
  home: string
  crumbs: DirectoryEntry[]
  entries: DirectoryEntry[]
  truncated: boolean
}

const MAX_ENTRIES = 500

/**
 * Native Harness `workspace/create` realpath's the folder and fails with ENOENT
 * when parent directories are missing. Create them on the Host before forwarding.
 * Only absolute, non-root paths are accepted.
 */
export async function ensureHostWorkspaceDirectory(path: string | undefined): Promise<void> {
  const raw = String(path || '').trim()
  if (!raw || raw.includes('\0')) return
  const target = resolve(raw)
  if (!isAbsolute(target) || target === parse(target).root) return
  await mkdir(target, { recursive: true })
}

/** Read-only fallback used only over an authenticated Host channel when Harness has a native-only picker. */
export async function listRemoteDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
  signal?.throwIfAborted()
  const home = resolve(homedir())
  const target = path === undefined || path.trim() === '' ? home : resolve(path)
  if (!isAbsolute(target)) throw new Error('The remote directory path must be absolute.')
  const rows = await readdir(target, { withFileTypes: true })
  const directories: DirectoryEntry[] = []
  for (const row of rows) {
    signal?.throwIfAborted()
    const child = resolve(target, row.name)
    let directory = row.isDirectory()
    if (!directory && row.isSymbolicLink()) directory = await stat(child).then(value => value.isDirectory()).catch(() => false)
    if (!directory) continue
    directories.push({ name: row.name, path: child, hidden: platform() !== 'win32' && row.name.startsWith('.') })
  }
  directories.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
  return {
    path: target,
    home,
    crumbs: crumbs(target),
    entries: directories.slice(0, MAX_ENTRIES),
    truncated: directories.length > MAX_ENTRIES,
  }
}

function crumbs(path: string): DirectoryEntry[] {
  const root = parse(path).root
  const result: DirectoryEntry[] = [{ name: root, path: root, hidden: false }]
  const segments: string[] = []
  let current = path
  while (current !== root) {
    segments.unshift(basename(current))
    current = dirname(current)
  }
  for (const segment of segments) {
    current = resolve(current, segment)
    result.push({ name: segment, path: current, hidden: false })
  }
  return result
}
