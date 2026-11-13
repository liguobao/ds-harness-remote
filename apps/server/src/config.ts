/**
 * Gateway timing configuration: one normalization path for every entry point.
 *
 * Both the CLI (`main.ts` / `server.ts` parsing env vars) and programmatic
 * construction (`new Gateway(...)`, `createRemoteServer({ ... })`) must funnel
 * through these helpers. A raw `NaN`, `Infinity`, negative or absurdly large
 * value reaching `setTimeout`/`setInterval` is silently coerced by Node into
 * 1ms, which turns a misconfiguration into a connection storm, so every value
 * is range-checked and replaced with a documented fallback.
 */

export interface GatewayTimingOptions {
  helloTimeoutMs?: number
  heartbeatIntervalMs?: number
  heartbeatDisconnectMs?: number
  forceTerminateGraceMs?: number
}

export type NormalizedGatewayOptions = Required<GatewayTimingOptions>

export const HELLO_TIMEOUT_MS_RANGE = { min: 1000, max: 60_000, fallback: 5000 } as const
export const HEARTBEAT_INTERVAL_MS_RANGE = { min: 5000, max: 120_000, fallback: 25_000 } as const
export const FORCE_TERMINATE_GRACE_MS_RANGE = { min: 100, max: 10_000, fallback: 1000 } as const
export const MAX_FRAMES_PER_SEC_RANGE = { min: 64, max: 65_536, fallback: 512 } as const
/** A heartbeat disconnect threshold below two intervals drops healthy peers. */
export const HEARTBEAT_DISCONNECT_MS_MIN_FACTOR = 2
export const HEARTBEAT_DISCONNECT_MS_MAX = 600_000
export const HEARTBEAT_DISCONNECT_MS_FLOOR = 75_000
export const HEARTBEAT_DISCONNECT_MS_FACTOR = 3

type Range = { readonly min: number; readonly max: number; readonly fallback: number }

/**
 * Coerce one timing value. Accepts numbers and numeric strings (env vars), and
 * rejects everything that is not a finite integer inside [min, max].
 */
function normalizeMs(value: unknown, range: Range, label: string): number {
  if (value === undefined || value === null) return range.fallback
  let candidate = Number.NaN
  try {
    if (typeof value === 'number') candidate = value
    else if (typeof value === 'string' && value.trim() !== '') candidate = Number(value)
  } catch {
    candidate = Number.NaN
  }
  if (!Number.isFinite(candidate) || !Number.isInteger(candidate) || candidate < range.min || candidate > range.max) {
    // Never echo the offending input: it can be copy/pasted text that would
    // otherwise be injected into logs verbatim.
    console.warn(`[config] Invalid ${label}. Must be an integer between ${range.min} and ${range.max}. Falling back to ${range.fallback}.`)
    return range.fallback
  }
  return candidate
}

export function normalizeHelloTimeoutMs(value: unknown): number {
  return normalizeMs(value, HELLO_TIMEOUT_MS_RANGE, 'DSH_SERVER_HELLO_TIMEOUT_MS')
}

export function normalizeHeartbeatIntervalMs(value: unknown): number {
  return normalizeMs(value, HEARTBEAT_INTERVAL_MS_RANGE, 'DSH_SERVER_HEARTBEAT_INTERVAL_MS')
}

/** Fallback scales with the interval so a slower heartbeat still tolerates two missed rounds. */
export function heartbeatDisconnectFallback(heartbeatIntervalMs: number): number {
  return Math.min(
    HEARTBEAT_DISCONNECT_MS_MAX,
    Math.max(HEARTBEAT_DISCONNECT_MS_FLOOR, heartbeatIntervalMs * HEARTBEAT_DISCONNECT_MS_FACTOR),
  )
}

export function normalizeHeartbeatDisconnectMs(value: unknown, heartbeatIntervalMs: number): number {
  const min = heartbeatIntervalMs * HEARTBEAT_DISCONNECT_MS_MIN_FACTOR
  const fallback = heartbeatDisconnectFallback(heartbeatIntervalMs)
  if (value === undefined || value === null) return fallback
  let candidate = Number.NaN
  try {
    if (typeof value === 'number') candidate = value
    else if (typeof value === 'string' && value.trim() !== '') candidate = Number(value)
  } catch {
    candidate = Number.NaN
  }
  if (!Number.isFinite(candidate) || !Number.isInteger(candidate) || candidate < min || candidate > HEARTBEAT_DISCONNECT_MS_MAX) {
    console.warn(
      `[config] Invalid DSH_SERVER_HEARTBEAT_DISCONNECT_MS. Must be an integer between ${min} and ${HEARTBEAT_DISCONNECT_MS_MAX} (at least ${HEARTBEAT_DISCONNECT_MS_MIN_FACTOR}x the heartbeat interval). Falling back to ${fallback}.`,
    )
    return fallback
  }
  return candidate
}

export function normalizeForceTerminateGraceMs(value: unknown): number {
  return normalizeMs(value, FORCE_TERMINATE_GRACE_MS_RANGE, 'DSH_SERVER_FORCE_TERMINATE_GRACE_MS')
}

export function normalizeMaxFramesPerSec(value: unknown): number {
  return normalizeMs(value, MAX_FRAMES_PER_SEC_RANGE, 'DSH_SERVER_MAX_FRAMES_PER_SEC')
}

/**
 * Single normalization point shared by the Gateway constructor and
 * `createRemoteServer`, so no caller can inject an unsafe timer value.
 */
export function normalizeGatewayOptions(options?: GatewayTimingOptions | null): NormalizedGatewayOptions {
  const source: GatewayTimingOptions = options ?? {}
  const heartbeatIntervalMs = normalizeHeartbeatIntervalMs(source.heartbeatIntervalMs)
  return {
    helloTimeoutMs: normalizeHelloTimeoutMs(source.helloTimeoutMs),
    heartbeatIntervalMs,
    heartbeatDisconnectMs: normalizeHeartbeatDisconnectMs(source.heartbeatDisconnectMs, heartbeatIntervalMs),
    forceTerminateGraceMs: normalizeForceTerminateGraceMs(source.forceTerminateGraceMs),
  }
}
