import { describe, expect, it } from 'vitest'
import { SerialSend } from '../src/serial-send.js'
import { waitForRelayCapacity } from '../src/websocket-backpressure.js'

describe('Relay backpressure and ordered encrypted sending', () => {
  it('serializes concurrent sends and bounds pending bytes', async () => {
    const queue = new SerialSend(); const seen: number[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const first = queue.run(5 * 1024 * 1024, async () => { seen.push(1); await gate; seen.push(2) })
    const second = queue.run(1, async () => { seen.push(3) })
    await expect(queue.run(4 * 1024 * 1024, async () => {})).rejects.toThrow(/limit/)
    await Promise.resolve(); expect(seen).toEqual([1])
    release(); await Promise.all([first, second]); expect(seen).toEqual([1, 2, 3])
  })
  it('waits for Relay capacity and fails closed on disconnect', async () => {
    const socket = { readyState: 1, bufferedAmount: 600_000 }
    const pending = waitForRelayCapacity(socket)
    socket.bufferedAmount = 0; await pending
    socket.readyState = 3
    await expect(waitForRelayCapacity(socket)).rejects.toThrow(/closed/)
  })
})
