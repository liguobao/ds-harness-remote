import { hostname } from 'node:os'
import type { Volatile, VolatileSnapshot } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'

export const DEFAULT_REMOTE_SERVER_URL = 'https://dsh.r2049.cn'

export interface Config {
  enabled?: boolean
  role?: 'host' | 'client' | 'both'
  serverUrl?: string
  deviceName?: string
  terminal?: { enabled?: boolean }
  loopback?: { ports?: number[] }
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
  acp?: { enabled?: boolean; backends?: Array<{ id:string; enabled?: boolean; command?: string; args?: string[]; cwd?: string }>; backend?: string; command?: string; args?: string[]; cwd?: string }
}

export interface ResolvedCodexConfig {
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
  terminal: { enabled: boolean }
  loopback: { ports: number[] }
  codex: ResolvedCodexConfig
  acp?: { enabled: boolean; backends: Array<{ id:string; enabled:boolean; command:string; args:string[]; cwd?:string }> }
}

/** The entry's volatile Cordis config: one stable reference for the whole section. */
export type EntryConfig = Volatile<Config>

/** Config accepted by {@link resolveConfig}: the composition seed or a live snapshot. */
export type ConfigInput = Config | VolatileSnapshot<Config>

/**
 * Schemastery schema for the plugin entry. The whole section is `.volatile()`
 * (DSH 0.1.7-rc.1, DSH-0.1.7-RC1-04): the Loader hands `apply` a single live
 * reference whose `.get()` always returns the latest committed value, and the
 * settings service persists edits in the active profile's `cordis.patch.yml`
 * under this entry id. The namespace-registration API was removed in rc.1.
 */
export const Config: s<Config> = s.object({
  enabled: s.boolean(),
  role: s.union(['host', 'client', 'both'] as const),
  serverUrl: s.string(),
  deviceName: s.string(),
  terminal: s.object({ enabled: s.boolean() }),
  loopback: s.object({ ports: s.array(s.number()) }),
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
  acp: s.object({ enabled: s.boolean(), backends: s.array(s.object({ id:s.string(), enabled:s.boolean(), command:s.string(), args:s.array(s.string()), cwd:s.string() })) }),
}).volatile() as unknown as s<Config>

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
  terminal: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  loopback: z.object({ ports: z.array(z.number().int().min(1024).max(65535)).max(16).optional() }).strict().optional(),
  forceRelay: z.boolean().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  reconnect: reconnectSchema.optional(),
  codex: z.object({
    enabled: z.boolean().optional(),
    binary: z.string().trim().min(1).max(4096).optional(),
  }).strict().optional(),
  acp: z.object({ enabled:z.boolean().optional(), backends:z.array(z.object({ id:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/i), enabled:z.boolean().optional(), command:z.string().trim().min(1).max(4096).optional(), args:z.array(z.string().max(4096)).max(32).optional(), cwd:z.string().max(4096).optional() }).strict()).max(12).optional(), backend:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/i).optional(), command:z.string().trim().min(1).max(4096).optional(), args:z.array(z.string().max(4096)).max(32).optional(), cwd:z.string().max(4096).optional() }).strict().optional(),
}).strict()

export function resolveConfig(input: ConfigInput = {}, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
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
    terminal: { enabled: parsed.terminal?.enabled ?? false },
    loopback: { ports: [...new Set(parsed.loopback?.ports ?? [])] },
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
    acp: { enabled: parsed.acp?.enabled ?? true, backends: [...new Set(['codex','cursor','kimi',...(parsed.acp?.backends?.map(item => item.id) ?? [])])].map(id => { const d = parsed.acp?.backends?.find(x => x.id === id); const legacy = parsed.acp?.backend === id ? parsed.acp : undefined; return { id, enabled: d?.enabled ?? legacy?.enabled ?? true, command: d?.command ?? legacy?.command ?? ({codex:'codex',cursor:'agent',kimi:'kimi'} as Record<string,string>)[id] ?? id, args: d?.args ?? legacy?.args ?? ['acp'], ...(d?.cwd ?? legacy?.cwd ? { cwd: d?.cwd ?? legacy?.cwd } : {}) } }) },
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
