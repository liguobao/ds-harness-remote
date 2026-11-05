import { createHmac } from 'node:crypto'

/**
 * Public ICE configuration for the self-hosted Server.
 *
 * The Server hands out short-lived TURN credentials (coturn REST API) or the
 * configured static pair; `DSH_SERVER_TURN_SECRET` never leaves the process.
 * STUN/TURN URLs are deployment configuration because this repository does
 * not hardcode public relay or TURN addresses.
 */
export interface IceConfig {
  readonly stunUrls: readonly string[]
  readonly turnUrls: readonly string[]
  readonly turnSecret: string | undefined
  /** Static TURN credentials for deployments that cannot use a shared secret. */
  readonly turnUsername: string | undefined
  readonly turnPassword: string | undefined
  readonly turnTtlSeconds: number
}

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export const DEFAULT_TURN_TTL_SECONDS = 300
const MAX_TURN_TTL_SECONDS = 3600
const MIN_TURN_TTL_SECONDS = 60
const TURN_URL_PATTERN = /^turns?:[^\s]+$/i
const STUN_URL_PATTERN = /^stuns?:[^\s]+$/i

function splitUrls(value: string | undefined, pattern: RegExp, name: string): string[] {
  if (value === undefined) return []
  const urls = value.split(',').map(entry => entry.trim()).filter(Boolean)
  for (const url of urls) {
    if (!pattern.test(url)) throw new Error(`Invalid ${name} entry "${url}": expected a stun:/stuns: or turn:/turns: URL.`)
  }
  return [...new Set(urls)]
}

function parseTtl(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_TURN_TTL_SECONDS
  const ttl = Number(value)
  if (!Number.isSafeInteger(ttl) || ttl < MIN_TURN_TTL_SECONDS || ttl > MAX_TURN_TTL_SECONDS) {
    throw new Error(`Invalid DSH_SERVER_TURN_TTL_SECONDS: expected an integer between ${MIN_TURN_TTL_SECONDS} and ${MAX_TURN_TTL_SECONDS}.`)
  }
  return ttl
}

/**
 * Parse and validate the environment. TURN is enabled only when the URLs and
 * a complete credential source (shared secret or static pair) are present; a
 * partial configuration fails startup so a deployment cannot silently
 * advertise TURN it cannot serve.
 */
export function parseIceConfig(env: Record<string, string | undefined>): IceConfig {
  const stunUrls = splitUrls(env.DSH_SERVER_STUN_URLS, STUN_URL_PATTERN, 'DSH_SERVER_STUN_URLS')
  const turnUrls = splitUrls(env.DSH_SERVER_TURN_URLS, TURN_URL_PATTERN, 'DSH_SERVER_TURN_URLS')
  const secret = env.DSH_SERVER_TURN_SECRET?.trim() || undefined
  const turnUsername = env.DSH_SERVER_TURN_USERNAME?.trim() || undefined
  const turnPassword = env.DSH_SERVER_TURN_PASSWORD?.trim() || undefined
  const staticPair = turnUsername !== undefined && turnPassword !== undefined
  if (secret !== undefined && (turnUsername !== undefined || turnPassword !== undefined)) {
    throw new Error('Set either DSH_SERVER_TURN_SECRET or DSH_SERVER_TURN_USERNAME + DSH_SERVER_TURN_PASSWORD, not both.')
  }
  if (!staticPair && (turnUsername !== undefined || turnPassword !== undefined)) {
    throw new Error('DSH_SERVER_TURN_USERNAME and DSH_SERVER_TURN_PASSWORD must be configured together.')
  }
  if (turnUrls.length > 0 && secret === undefined && !staticPair) {
    throw new Error('DSH_SERVER_TURN_URLS requires DSH_SERVER_TURN_SECRET or DSH_SERVER_TURN_USERNAME + DSH_SERVER_TURN_PASSWORD.')
  }
  if ((secret !== undefined || staticPair) && turnUrls.length === 0) {
    throw new Error('DSH_SERVER_TURN_URLS is required when TURN credentials are configured.')
  }
  return { stunUrls, turnUrls, turnSecret: secret, turnUsername, turnPassword, turnTtlSeconds: parseTtl(env.DSH_SERVER_TURN_TTL_SECONDS) }
}

/**
 * Build the ICE server list for one device. With a shared secret the TURN
 * username is `<expiryUnixSeconds>:<deviceId>` and the credential is
 * `base64(HMAC-SHA1(secret, username))`, matching the coturn REST API; a
 * static pair is passed through as configured.
 */
export function buildIceServers(config: IceConfig, deviceId: string, now = Date.now()): IceServer[] {
  const servers: IceServer[] = []
  if (config.stunUrls.length > 0) {
    servers.push({ urls: config.stunUrls.length === 1 ? config.stunUrls[0]! : [...config.stunUrls] })
  }
  if (config.turnUrls.length > 0) {
    if (config.turnSecret !== undefined) {
      const expiresAt = Math.floor((now + config.turnTtlSeconds * 1000) / 1000)
      const username = `${expiresAt}:${deviceId}`
      servers.push({
        urls: config.turnUrls.length === 1 ? config.turnUrls[0]! : [...config.turnUrls],
        username,
        credential: createHmac('sha1', config.turnSecret).update(username).digest('base64'),
      })
    } else if (config.turnUsername !== undefined && config.turnPassword !== undefined) {
      servers.push({
        urls: config.turnUrls.length === 1 ? config.turnUrls[0]! : [...config.turnUrls],
        username: config.turnUsername,
        credential: config.turnPassword,
      })
    }
  }
  return servers
}
