import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Cloudflare Tunnel ("方案 B"): a named tunnel gives the embedded Server a
 * stable HTTPS origin (https://remote.example.com) reachable from anywhere.
 * cloudflared is a small static binary we cache under the plugin directory and
 * spawn on demand; the tunnel's DNS/ingress stays configured in the Cloudflare
 * dashboard.
 */
export interface CloudflareTunnelOptions {
  /** Tunnel token from Cloudflare Zero Trust → Tunnels → (tunnel) → Install. */
  token: string
  /** Directory that caches the cloudflared executable. */
  binaryDirectory: string
  logger: {
    info(message: string, extra?: unknown): void
    warn(message: string, extra?: unknown): void
    error(message: string, extra?: unknown): void
  }
}

export interface CloudflareTunnelRuntime {
  /** Stops the tunnel process (the embedded Server keeps running). */
  close(): Promise<void>
}

const DOWNLOAD_URLS = [
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64',
]

function binaryPath(directory: string): string {
  const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  return join(directory, name)
}

async function downloadBinary(directory: string, logger: CloudflareTunnelOptions['logger']): Promise<string> {
  const target = binaryPath(directory)
  if (existsSync(target)) return target
  mkdirSync(directory, { recursive: true })
  let lastError: unknown
  for (const url of DOWNLOAD_URLS) {
    try {
      logger.info('downloading cloudflared', { url })
      const response = await fetch(url, { redirect: 'follow' })
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`)
      const partial = `${target}.partial`
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(partial))
      rmSync(target, { force: true })
      const { renameSync } = await import('node:fs')
      renameSync(partial, target)
      return target
    } catch (error) {
      lastError = error
      logger.warn('cloudflared download failed', { url, message: error instanceof Error ? error.message : String(error) })
    }
  }
  throw new Error(`Could not download cloudflared (${lastError instanceof Error ? lastError.message : String(lastError)}). `
    + `Place cloudflared manually in ${directory} or set a tunnel origin manually.`)
}

export async function startCloudflareTunnel(options: CloudflareTunnelOptions): Promise<CloudflareTunnelRuntime> {
  if (options.token.trim().length === 0) throw new Error('Cloudflare Tunnel requires a tunnel token.')
  const executable = await downloadBinary(options.binaryDirectory, options.logger)
  let child: ChildProcess | undefined
  let stopping = false
  const spawnTunnel = () => {
    child = spawn(executable, ['tunnel', '--no-autoupdate', 'run', '--token', options.token], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdout?.on('data', chunk => options.logger.info('cloudflared', { line: String(chunk).trim().slice(0, 200) }))
    child.stderr?.on('data', chunk => options.logger.warn('cloudflared stderr', { line: String(chunk).trim().slice(0, 200) }))
    child.on('exit', code => {
      if (stopping) return
      options.logger.warn('cloudflared exited unexpectedly', { code })
      // Restart with backoff; a tunnel drop should not require a plugin reload.
      setTimeout(() => {
        if (!stopping) {
          try { spawnTunnel() } catch (error) {
            options.logger.error('cloudflared restart failed', { message: error instanceof Error ? error.message : String(error) })
          }
        }
      }, 5_000)
    })
  }
  spawnTunnel()
  return {
    async close() {
      stopping = true
      if (child !== undefined && child.exitCode === null) {
        child.kill()
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 3_000)
          child?.once('exit', () => { clearTimeout(timer); resolve() })
        })
      }
    },
  }
}
