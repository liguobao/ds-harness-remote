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
 * werift's package exports map hides its lib/ subpaths, so the patched
 * transport module has to be resolved physically from the installed package
 * root. Layout follows the pinned 0.24.4 entry `lib/webrtc/src/index.js`.
 */
function loadWeriftTcpTransport(): WeriftTransportModule['TcpTransport'] {
  const entry = require.resolve('werift')
  // Entry `lib/webrtc/src/index.js` sits three levels under the package root.
  const packageRoot = join(dirname(entry), '..', '..', '..')
  const module = require(join(packageRoot, 'lib', 'common', 'src', 'transport.js')) as unknown as WeriftTransportModule
  if (typeof module.TcpTransport?.init !== 'function') throw new Error(`werift TcpTransport.init is missing at ${packageRoot}`)
  return module.TcpTransport
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

describe('werift TURN TCP transport redial', () => {
  it('keeps a failed redial rejected for callers without an unhandled rejection (issue #241)', async () => {
    const TcpTransport = loadWeriftTcpTransport()
    const sockets: Socket[] = []
    const server = createServer(socket => {
      sockets.push(socket)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port

    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)

    let transport: WeriftTcpTransport | undefined
    try {
      transport = await TcpTransport.init(['127.0.0.1', port])
      const firstConnecting = transport.stream.connecting

      // The server-side accept can land after the client's connect event;
      // wait for it so the FIN below actually reaches werift.
      const acceptDeadline = Date.now() + 3_000
      while (sockets.length === 0) {
        if (Date.now() > acceptDeadline) throw new Error('server never observed the transport connection')
        await sleep(10)
      }

      // FIN the established connection; werift redials on "end". Closing the
      // listener first makes that redial fail. The patched StreamTransport
      // observes the rejection so the host process (DSH installFailLoud)
      // cannot die on it, while send() callers still see the failed
      // transport. server.close only stops accepting; its callback would
      // wait out the open socket.
      server.close()
      sockets[0]?.end()

      // Wait for the redial generation to appear (reference compare only —
      // attaching a handler here would mask the unhandled rejection this
      // test must catch).
      const redialDeadline = Date.now() + 3_000
      while (transport.stream.connecting === firstConnecting) {
        if (Date.now() > redialDeadline) throw new Error('werift did not start a redial after "end"')
        await sleep(10)
      }

      // The failing redial fires any unhandled rejection in its own
      // macrotask; settle before assertions attach handlers.
      await sleep(300)
      expect(unhandled).toEqual([])

      await expect(transport.stream.connecting).rejects.toThrow()
      await expect(transport.send(Buffer.from('x'))).rejects.toThrow()
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
      for (const socket of sockets) socket.destroy()
      await transport?.close().catch(() => undefined)
      await new Promise<void>(resolve => {
        server.close(() => resolve())
        for (const socket of sockets) socket.destroy()
      })
    }
  })

  it('ships the redial guard inside the committed Host bundle', () => {
    // The bundle inlines werift through its ESM entry, not the CJS file the
    // behavioral test loads; a rebuild without the pnpm patch applied would
    // silently drop the guard from the shipped artifact.
    const bundle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js'), 'utf8')
    expect(bundle).toContain('this.connecting.catch(')
  })
})
