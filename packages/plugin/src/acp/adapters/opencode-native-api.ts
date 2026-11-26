import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { realpath } from 'node:fs/promises'
import { stripVTControlCharacters } from 'node:util'
import { RpcError } from '../../safe-error.js'
import { execFileCommand } from '../windows-spawn.js'

const MAX_RESPONSE_BYTES = 64 * 1024
const MAX_LIST_RESPONSE_BYTES = 4 * 1024 * 1024
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/

/** Probe the installed CLI, since ACP builds do not all expose a native HTTP listener. */
export async function opencodeHasNativeApi(binary: string, args: readonly string[], cwd: string | undefined, signal: AbortSignal): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileCommand(binary, [...opencodePrivateArgs(args), '--help'], {
      cwd, signal, timeout: 20_000, maxBuffer: MAX_RESPONSE_BYTES, windowsHide: true, killSignal: 'SIGKILL',
    })
    const help = stripVTControlCharacters(`${stdout}\n${stderr}`)
    const hasFlag = (name: string) => new RegExp(`^\\s*(?:-[A-Za-z],?\\s+)?--${name}(?=[\\s=,\\[]|$)`, 'm').test(help)
    const network = ['hostname', 'port', 'mdns'].map(hasFlag)
    // An incomplete/failed probe must never remove the private bind from an older CLI.
    if (!/\bacp\b/i.test(help) || !hasFlag('help') || (network.some(Boolean) && !network.every(Boolean))) throw new Error('Invalid ACP help')
    return network.every(Boolean)
  } catch (error) {
    // Do not expose captured CLI output or inherited configuration in errors/logs.
    if (signal.aborted) throw new RpcError('OPENCODE_CLOSED', 'OpenCode ACP was closed.')
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new RpcError('OPENCODE_BINARY_UNAVAILABLE', 'The Host OpenCode executable is unavailable.')
    throw new RpcError('OPENCODE_CLI_PROBE_FAILED', 'Could not inspect OpenCode ACP options. Check opencode acp --help on the Host.')
  }
}

/** The native HTTP listener belongs to the same Host-local `opencode acp` process. */
export class OpencodeNativeApi {
  readonly password = randomBytes(32).toString('hex')
  private readonly shutdown = new AbortController()
  constructor(private readonly origin: string, private readonly request: typeof fetch = fetch) {
    if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin) || Number(new URL(origin).port) > 65535) throw unavailable()
  }

  async isArchived(sessionId: string, cwd: string): Promise<boolean> {
    const session = await this.session('GET', sessionId, cwd)
    return typeof session.time.archived === 'number' && Number.isFinite(session.time.archived)
  }

  async listArchived(sessionIds: readonly string[], cwd: string): Promise<Map<string, boolean>> {
    if (sessionIds.some(id => !SESSION_ID_PATTERN.test(id))) throw new RpcError('INVALID_MESSAGE', 'The OpenCode session ID is invalid.')
    const wanted = new Set(sessionIds)
    try {
      const result = await this.requestJson('GET', '/session', cwd, MAX_LIST_RESPONSE_BYTES)
      if (!Array.isArray(result)) throw unavailable()
      const archived = new Map<string, boolean>()
      const paths = new Map<string, Promise<string>>()
      for (const row of result) {
        if (!isNativeRecord(row) || typeof row.id !== 'string' || !wanted.has(row.id)) continue
        if (archived.has(row.id) || typeof row.directory !== 'string' || !isNativeRecord(row.time)) throw unavailable()
        let path = paths.get(row.directory)
        if (!path) {
          path = realpath(row.directory)
          paths.set(row.directory, path)
        }
        if (await path !== cwd) throw unavailable()
        const value = row.time.archived
        if (value != null && (typeof value !== 'number' || !Number.isFinite(value))) throw unavailable()
        archived.set(row.id, value != null)
      }
      return archived
    } catch {
      throw unavailable()
    }
  }

  async archive(sessionId: string, cwd: string): Promise<void> {
    if (await this.isArchived(sessionId, cwd)) return
    const session = await this.session('PATCH', sessionId, cwd)
    if (typeof session.time.archived !== 'number' || !Number.isFinite(session.time.archived)) throw unavailable()
  }

  close(): void { this.shutdown.abort() }

  private async session(method: 'GET' | 'PATCH', sessionId: string, cwd: string): Promise<{ time: { archived?: number } }> {
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new RpcError('INVALID_MESSAGE', 'The OpenCode session ID is invalid.')
    try {
      const result = await this.requestJson(method, `/session/${encodeURIComponent(sessionId)}`, cwd, MAX_RESPONSE_BYTES,
        method === 'PATCH' ? JSON.stringify({ time: { archived: Date.now() } }) : undefined)
      if (!isNativeRecord(result) || result.id !== sessionId || typeof result.directory !== 'string' || !isNativeRecord(result.time)
        || await realpath(result.directory) !== cwd) throw unavailable()
      return result as { time: { archived?: number } }
    } catch {
      throw unavailable()
    }
  }

  private async requestJson(method: 'GET' | 'PATCH', path: string, cwd: string, maxBytes: number, body?: string): Promise<unknown> {
    const url = new URL(path, this.origin)
    url.searchParams.set('directory', cwd)
    const response = await this.request(url, {
      method, redirect: 'error', signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(20_000)]),
      headers: { authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body }),
    })
    if (!response.ok) { await response.body?.cancel(); throw unavailable() }
    const reader = response.body?.getReader()
    if (!reader) throw unavailable()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > maxBytes) throw unavailable()
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel().catch(() => undefined) }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
}

function isNativeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function opencodeLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  if (!address || typeof address === 'string') throw unavailable()
  return address.port
}

/** Strip stale network flags; only add a private listener when the CLI advertises it. */
export function opencodePrivateArgs(args: readonly string[], port?: number): string[] {
  if (args.includes('--')) throw unavailable()
  const kept: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (/^--(?:port|hostname|mdns|no-mdns)(?:=|$)/.test(arg)) {
      if ((arg === '--port' || arg === '--hostname') || ((arg === '--mdns' || arg === '--no-mdns') && /^(true|false)$/.test(args[i + 1] ?? ''))) i++
    } else kept.push(arg)
  }
  return port === undefined ? kept : [...kept, `--hostname=127.0.0.1`, `--port=${port}`, '--mdns=false']
}

function unavailable(): RpcError {
  return new RpcError('OPENCODE_ARCHIVE_UNAVAILABLE', 'OpenCode did not confirm the archive operation. Check the Host OpenCode version and retry after refreshing its session list.')
}
