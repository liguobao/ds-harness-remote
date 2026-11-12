import type { BotObject } from './bot-catalog'

/**
 * The two Host routes that can serve one group round's rows. `group-rows` reads the
 * group's book and also answers after the round settled; `room-progress` only knows
 * the rounds still running, which is all a Host from before 0.6.4 can answer.
 */
export type RoomRowsEndpoint = 'group-rows' | 'room-progress'
export type RoomRowsCall = (endpoint: RoomRowsEndpoint, payload: BotObject, signal?: AbortSignal) => Promise<unknown>

export interface RoomRowsRequest {
  roomId: string
  /** The `group_relay` call whose rows this ledger row draws. */
  callId: string
  range: { from: number; to?: number; anchor?: string }
}

export interface RoomRowsPoll {
  /** Rows to render. Absent when this poll learned nothing, so the snapshot stays. */
  rows?: BotObject[]
  /** A later poll may still add rows. */
  open: boolean
  /** The Host answered through `room-progress` because `group-rows` is unavailable. */
  legacy: boolean
  /** The Host answered (an entry was present or not); false means neither route replied. */
  answered: boolean
}

/**
 * Read one round's rows, preferring the persisted route. Two different Hosts answer
 * `group-rows` with an error instead of rows: a Remote Host built before the route was
 * allowlisted rejects the call itself (`The plugin route call is invalid for the remote
 * channel`), and a DS-Bot older than the route answers `Unknown endpoint group-rows`
 * with `ok: false`. Both mean the same thing to this client, so any failure falls back
 * to the live round instead of surfacing version-specific text and retrying forever.
 */
export async function pollRoomRows(call: RoomRowsCall, request: RoomRowsRequest, signal?: AbortSignal): Promise<RoomRowsPoll> {
  try {
    const value = await call('group-rows', { roomId: request.roomId, ...request.range }, signal)
    if (!isObject(value)) throw new Error('group-rows returned an unexpected payload')
    return { rows: objects(value.rows), open: value.open === true, legacy: false, answered: true }
  } catch (error) {
    if (signal?.aborted) throw error
  }
  try {
    const progress = objects(await call('room-progress', { roomId: request.roomId }, signal))
    const entry = progress.find(item => item.callId === request.callId)
    return entry === undefined
      ? { open: true, legacy: true, answered: true }
      : { rows: objects(entry.replies), open: true, legacy: true, answered: true }
  } catch (error) {
    if (signal?.aborted) throw error
    // Neither route answered; keep the snapshot and let the next poll try again.
    return { open: true, legacy: true, answered: false }
  }
}

/** How long each route waits before asking again. */
export const ROOM_ROWS_INTERVAL_MS = 1000
export const ROOM_ROWS_LEGACY_INTERVAL_MS = 2000
/** Consecutive empty legacy polls before a settled round stops being polled. */
export const ROOM_ROWS_LEGACY_MISSES = 2

function isObject(value: unknown): value is BotObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objects(value: unknown): BotObject[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}
