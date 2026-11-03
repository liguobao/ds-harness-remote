import { createServer, type AddressInfo, type Socket } from 'node:net'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

interface WeriftStreamTransport {
  connecting: Promise<unknown>
}

interface WeriftTcpTransport {
  stream: WeriftStreamTransport
  send: (data: Buffer) => Promise<void>
  close: () => Promise<void>
}

interface WeriftTransportModule {
  TcpTransport: { init: (addr: [string, number]) => Promise<WeriftTcpTransport> }
}

/**
 * werift's package exports map hides its lib/ subpaths, so the transport
 * module has to be resolved physically from the installed package root.
 * Layout follows the pinned entry `lib/webrtc/src/index.js`.
 */
function loadWeriftTcpTransport(): WeriftTransportModule['TcpTransport'] {
  const entry = require.resolve('werift')
  const packageRoot = join(dirname(entry), '..', '..', '..')
  const module = require(join(packageRoot, 'lib', 'common', 'src', 'transport.js')) as unknown as WeriftTransportModule
  if (typeof module.TcpTransport?.init !== 'function') throw new Error(`werift TcpTransport.init is missing at ${packageRoot}`)
  return module.TcpTransport
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function trackUnhandledRejections(): { unhandled: unknown[]; stop: () => void } {
  const unhandled: unknown[] = []
  const listener = (reason: unknown): void => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', listener)
  return { unhandled, stop: () => process.off('unhandledRejection', listener) }
}

/**
 * Issue #241's crash class: a lost TURN-TCP connection must never surface as
 * an unhandled rejection. werift 0.26 replaced the old silent auto-redial
 * with terminal failure semantics, so these tests pin that behavior.
 */
describe('werift TURN TCP transport failures (issue #241 on werift 0.26)', () => {
  it('rejects init on a refused connect without an unhandled rejection', async () => {
    const TcpTransport = loadWeriftTcpTransport()
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    await new Promise<void>(resolve => server.close(() => resolve()))

    const tracker = trackUnhandledRejections()
    try {
      await expect(TcpTransport.init(['127.0.0.1', port])).rejects.toThrow()
      await sleep(200)
      expect(tracker.unhandled).toEqual([])
    } finally {
      tracker.stop()
    }
  })

  it('contains a reset TURN connection without redialing or an unhandled rejection', async () => {
    const TcpTransport = loadWeriftTcpTransport()
    const sockets: Socket[] = []
    const server = createServer(socket => {
      sockets.push(socket)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port

    const tracker = trackUnhandledRejections()
    let transport: WeriftTcpTransport | undefined
    try {
      transport = await TcpTransport.init(['127.0.0.1', port])
      const established = transport.stream.connecting

      // The server-side accept can land after the client's connect event;
      // wait for it so the reset below actually reaches werift.
      const acceptDeadline = Date.now() + 3_000
      while (sockets.length === 0) {
        if (Date.now() > acceptDeadline) throw new Error('server never observed the transport connection')
        await sleep(10)
      }

      // RST the connection — the TURN server / TUN proxy killing the socket.
      // 0.26 must neither start a redial (which 0.24.4 left unobserved) nor
      // leak any rejection; callers see the failure through send().
      sockets[0].destroy()
      await sleep(300)
      expect(tracker.unhandled).toEqual([])
      expect(transport.stream.connecting).toBe(established)

      await expect(transport.send(Buffer.from('x'))).rejects.toThrow()
      await sleep(200)
      expect(tracker.unhandled).toEqual([])
    } finally {
      tracker.stop()
      for (const socket of sockets) socket.destroy()
      await transport?.close().catch(() => undefined)
      await new Promise<void>(resolve => {
        server.close(() => resolve())
        for (const socket of sockets) socket.destroy()
      })
    }
  })

  it('ships the 0.26 StreamTransport inside the committed Host bundle', () => {
    // The bundle inlines werift through its ESM entry; assert it carries the
    // rewritten StreamTransport (built-in connect timeout) so a rebuild from
    // a stale 0.24.4 tree cannot silently ship the auto-redial defect.
    const bundle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js'), 'utf8')
    expect(bundle).toContain('connect timed out after')
    expect(bundle).not.toContain('this.connecting.catch(')
  })
})
