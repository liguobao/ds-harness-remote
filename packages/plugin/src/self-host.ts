import { mkdirSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { createRemoteServer } from '@dsh-remote/server'

/**
 * Embedded self-hosted Server: the plugin starts the open-source single-account
 * Relay server in-process, so the Host and its clients no longer depend on a
 * third-party deployment. The server speaks the same wire protocol as the
 * hosted one (Relay-only: no WebRTC/TURN signaling).
 */
export interface SelfHostOptions {
  port: number
  account: string
  password: string
  /** Directory that persists device credentials (state.json). */
  dataDirectory: string
  /**
   * Explicit public origin (HTTPS tunnel / DDNS hostname). When omitted the
   * LAN IPv4 origin is used, which only works while clients share the LAN.
   */
  publicUrl?: string
}

export interface SelfHostRuntime {
  /** Origin both the Host and its clients must use. */
  publicUrl: string
  close(): Promise<void>
}

/** First non-internal IPv4 address; the Host and LAN clients share it. */
function detectLanIpv4(): string {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (/^(loopback|vethernet|vmware|virtualbox|docker)/i.test(name)) continue
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return '127.0.0.1'
}

export function startSelfHost(options: SelfHostOptions): SelfHostRuntime {
  if (options.account.trim().length === 0) {
    throw new Error('Self-hosted server requires an account.')
  }
  if (options.password.length < 12) {
    throw new Error('Self-hosted server requires a password with at least 12 characters.')
  }
  const publicUrl = options.publicUrl?.trim() || `http://${detectLanIpv4()}:${options.port}`
  const dataFile = join(options.dataDirectory, 'state.json')
  mkdirSync(options.dataDirectory, { recursive: true })
  const app = createRemoteServer({
    account: options.account.trim(),
    password: options.password,
    publicUrl,
    dataFile,
  })
  app.server.listen(options.port, '0.0.0.0')
  return {
    publicUrl,
    close: () => app.close(),
  }
}
