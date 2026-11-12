import { describe, expect, it } from 'vitest'
import { pollRoomRows, preferredRoomRows, type RoomRowsCall, type RoomRowsRequest } from '../src/services/bot-room-rows'

const request: RoomRowsRequest = { roomId: 'room-1', callId: 'call-1', range: { from: 4 } }
const reply = { botId: 'session-1', name: 'Chief', text: '结论：通道常驻', time: 1 }
const progressEntry = (callId: string, replies: unknown[]) => ({ callId, replies, speaking: [] })

/** A transport that answers each endpoint from a script and records the order. */
function transport(answers: Partial<Record<'group-rows' | 'room-progress', (unknown | Error)[]>>): { call: RoomRowsCall; calls: string[] } {
  const calls: string[] = []
  const call: RoomRowsCall = async (endpoint, payload) => {
    calls.push(endpoint)
    const queue = answers[endpoint]
    if (queue === undefined) throw new Error(`unexpected ${endpoint}`)
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (next instanceof Error) throw next
    return next
  }
  return { call, calls }
}

describe('group round rows transport', () => {
  it('reads the persisted rows while the round is open', async () => {
    const { call, calls } = transport({ 'group-rows': [{ rows: [reply], open: true, speaking: [] }] })
    await expect(pollRoomRows(call, request)).resolves.toEqual({ rows: [reply], open: true, legacy: false, answered: true })
    expect(calls).toEqual(['group-rows'])
  })

  it('stops polling a settled newest round even though no later anchor exists', async () => {
    // DS-Bot keeps `open` true for the newest anchor until the next message; `active`
    // ends the poll once the group stops working.
    const { call } = transport({ 'group-rows': [{ rows: [reply], open: true, active: false, speaking: [] }] })
    await expect(pollRoomRows(call, request)).resolves.toEqual({ rows: [reply], open: false, legacy: false, answered: true })
  })

  it('keeps polling while the group reports itself active', async () => {
    const { call } = transport({ 'group-rows': [{ rows: [reply], open: true, active: true, speaking: ['session-1'] }] })
    await expect(pollRoomRows(call, request)).resolves.toEqual({ rows: [reply], open: true, legacy: false, answered: true })
  })

  it('stops polling once the round is settled', async () => {
    const { call } = transport({ 'group-rows': [{ rows: [], open: false }] })
    await expect(pollRoomRows(call, request)).resolves.toEqual({ rows: [], open: false, legacy: false, answered: true })
  })

  it('falls back to the live round when an older Remote Host rejects the route', async () => {
    const { call, calls } = transport({
      'group-rows': [new Error('The plugin route call is invalid for the remote channel')],
      'room-progress': [[progressEntry('call-1', [reply])]],
    })
    await expect(pollRoomRows(call, request)).resolves.toEqual({ rows: [reply], open: true, legacy: true, answered: true })
    expect(calls).toEqual(['group-rows', 'room-progress'])
  })

  it('falls back when an older DS-Bot answers group-rows as an unknown endpoint', async () => {
    // DS-Bot 0.3.1 answers `Unknown endpoint group-rows` instead of rows; the previous
    // client matched only the Remote Host rejection, so this reached the user as an error.
    const { call } = transport({
      'group-rows': [new Error('Unknown endpoint group-rows')],
      'room-progress': [[progressEntry('call-1', [reply])]],
    })
    await expect(pollRoomRows(call, request)).resolves.toEqual({ rows: [reply], open: true, legacy: true, answered: true })
  })

  it('keeps the snapshot while the live round has not started yet', async () => {
    const { call } = transport({ 'group-rows': [new Error('Unknown endpoint group-rows')], 'room-progress': [[]] })
    await expect(pollRoomRows(call, request)).resolves.toEqual({ open: true, legacy: true, answered: true })
  })

  it('ignores another round of the same group', async () => {
    const { call } = transport({
      'group-rows': [new Error('Unknown endpoint group-rows')],
      'room-progress': [[progressEntry('call-2', [reply])]],
    })
    await expect(pollRoomRows(call, request)).resolves.toEqual({ open: true, legacy: true, answered: true })
  })

  it('retries instead of failing when neither route answers', async () => {
    const { call } = transport({
      'group-rows': [new Error('The plugin route call is invalid for the remote channel')],
      'room-progress': [new Error('The Host is not connected')],
    })
    await expect(pollRoomRows(call, request)).resolves.toEqual({ open: true, legacy: true, answered: false })
  })

  it('rejects once the row is unmounted, so nothing is written after abort', async () => {
    const control = new AbortController()
    const { call } = transport({ 'group-rows': [new Error('aborted')] })
    control.abort()
    await expect(pollRoomRows(call, request, control.signal)).rejects.toThrow('aborted')
  })

  it('treats a malformed group-rows payload as unsupported instead of rendering it', async () => {
    const { call } = transport({ 'group-rows': ['not an object'], 'room-progress': [[]] })
    await expect(pollRoomRows(call, request)).resolves.toEqual({ open: true, legacy: true, answered: true })
  })
})

describe('which rows a ledger line draws', () => {
  it('prefers a live snapshot that already holds replies', async () => {
    expect(preferredRoomRows([{ text: 'live' }], [{ text: 'fetched' }])).toEqual([{ text: 'live' }])
  })

  it('falls back to the fetched rows when the live snapshot is empty', async () => {
    // A poll that caught the round before anyone spoke stored []; it must not hide the
    // rows the Host returns for the same round (the reply the web already shows).
    expect(preferredRoomRows([], [{ text: '2+2 is 4.' }])).toEqual([{ text: '2+2 is 4.' }])
    expect(preferredRoomRows(undefined, [{ text: '2+2 is 4.' }])).toEqual([{ text: '2+2 is 4.' }])
  })
})
