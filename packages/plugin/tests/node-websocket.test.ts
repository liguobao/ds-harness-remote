import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { createNodeWebSocket } from '../src/node-websocket.js'

describe('createNodeWebSocket', () => {
  it('omits Origin so self-hosted Servers that reject mismatched Origin accept the upgrade', async () => {
    const origins: Array<string | undefined> = []
    const server = createServer((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
      origins.push(req.headers.origin)
      // Mirror apps/server Gateway: any Origin that is not the public URL is rejected.
      if (req.headers.origin && req.headers.origin !== 'http://10.10.10.30:8081') {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      wss.handleUpgrade(req, socket, head, ws => {
        ws.close(1000, 'ok')
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as { port: number }).port
    try {
      const socket = createNodeWebSocket(`ws://127.0.0.1:${port}/ws/v1/connect`)
      const opened = once(socket, 'open')
      const closed = once(socket, 'close')
      await opened
      await closed
      expect(origins).toEqual([undefined])
    } finally {
      wss.close()
      await new Promise<void>(resolve => {
        server.close(() => resolve())
      })
    }
  })
})
