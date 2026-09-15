import { hostname } from 'node:os'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'

export const DEFAULT_REMOTE_SERVER_URL = 'https://dsh.r2049.cn'

export interface Config {
  enabled?: boolean
  role?: 'host' | 'client' | 'both'
  serverUrl?: string
  deviceName?: string
  forceRelay?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  reconnect?: boolean | {
    initialDelayMs?: number
    maxDelayMs?: number
    jitter?: number
  }
  /** Optional Codex domain carried by the existing authenticated Remote Plugin. */
  codex?: {
    enabled?: boolean
    binary?: string
  }
  /** Optional Cursor ACP domain carried by the existing authenticated Remote Plugin. */
  cursor?: {
    enabled?: boolean
    binary?: string
  }
}

export interface ResolvedCodexConfig {
  enabled: boolean
  binary: string
}

export interface ResolvedCursorConfig {
  enabled: boolean
  binary: string
}

export interface ResolvedConfig {
  enabled: boolean
  role: 'host' | 'client' | 'both'
  serverUrl?: string
  deviceName: string
  forceRelay: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  reconnect: {
    enabled: boolean
    initialDelayMs: number
    maxDelayMs: number
    jitter: number
  }
  codex: ResolvedCodexConfig
  cursor: ResolvedCursorConfig
}

/** Cordis-facing configuration shape; runtime bounds are enforced by resolveConfig. */
export const Config: s<Config> = s.object({
  enabled: s.boolean(),
  role: s.union(['host', 'client', 'both'] as const),
  serverUrl: s.string(),
  deviceName: s.string(),
  forceRelay: s.boolean(),
  logLevel: s.union(['debug', 'info', 'warn', 'error'] as const),
  reconnect: s.union([
    s.boolean(),
    s.object({
      initialDelayMs: s.number(),
      maxDelayMs: s.number(),
      jitter: s.number(),
    }),
  ]),
  codex: s.object({
    enabled: s.boolean(),
    binary: s.string(),
  }),
  cursor: s.object({
    enabled: s.boolean(),
    binary: s.string(),
  }),
})

const reconnectSchema = z.union([
  z.boolean(),
  z.object({
    initialDelayMs: z.number().int().min(100).max(60_000).optional(),
    maxDelayMs: z.number().int().min(1_000).max(300_000).optional(),
    jitter: z.number().min(0).max(1).optional(),
  }).strict(),
])

const configSchema = z.object({
  enabled: z.boolean().optional(),
  role: z.enum(['host', 'client', 'both']).optional(),
  serverUrl: z.string().url().optional(),
  deviceName: z.string().trim().min(1).max(80).optional(),
  forceRelay: z.boolean().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  reconnect: reconnectSchema.optional(),
  codex: z.object({
    enabled: z.boolean().optional(),
    binary: z.string().trim().min(1).max(4096).optional(),
  }).strict().optional(),
  cursor: z.object({
    enabled: z.boolean().optional(),
    binary: z.string().trim().min(1).max(4096).optional(),
  }).strict().optional(),
}).strict()

export function resolveConfig(input: Config = {}, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const parsed = configSchema.parse(input)
  const reconnect = typeof parsed.reconnect === 'object' ? parsed.reconnect : {}
  const configuredServerUrl = parsed.serverUrl ?? env.DSH_REMOTE_SERVER
  const serverUrl = configuredServerUrl === undefined ? undefined : normalizeServerUrl(configuredServerUrl)
  const initialDelayMs = reconnect.initialDelayMs ?? 1_000
  const maxDelayMs = reconnect.maxDelayMs ?? 30_000
  if (maxDelayMs < initialDelayMs) {
    throw new TypeError('reconnect.maxDelayMs must be greater than or equal to reconnect.initialDelayMs')
  }
  return {
    enabled: parsed.enabled ?? true,
    role: parsed.role ?? 'host',
    ...(serverUrl === undefined ? {} : { serverUrl }),
    deviceName: parsed.deviceName ?? hostname(),
    forceRelay: parsed.forceRelay ?? false,
    logLevel: parsed.logLevel ?? 'info',
    reconnect: {
      enabled: parsed.reconnect !== false,
      initialDelayMs,
      maxDelayMs,
      jitter: reconnect.jitter ?? 0.2,
    },
    codex: {
      enabled: parsed.codex?.enabled ?? true,
      binary: parsed.codex?.binary ?? 'codex',
    },
    cursor: {
      // Experimental: off by default until Host has `agent login` / API key ready.
      enabled: parsed.cursor?.enabled ?? false,
      binary: parsed.cursor?.binary ?? 'agent',
    },
  }
}

export function normalizeServerUrl(value: string): string {
  const url = new URL(value)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new TypeError('serverUrl must use HTTPS (HTTP is allowed only for localhost)')
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('serverUrl must not contain credentials')
  }
  if (url.search !== '' || url.hash !== '') {
    throw new TypeError('serverUrl must not contain query parameters or fragments')
  }
  if (url.pathname !== '' && url.pathname !== '/') {
    throw new TypeError('serverUrl must be an origin without a path')
  }
  return url.origin
}
