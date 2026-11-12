import WebSocket from 'ws'

/**
 * Node Host / Client sockets for the Server control and Relay data planes.
 *
 * Do not use the process-global `WebSocket` inside `dsh web`: that implementation
 * attaches an `Origin` header from the Harness page. Self-hosted Servers compare
 * Origin to `DSH_SERVER_PUBLIC_URL` and reject the mismatch (`origin_mismatch`).
 * The bundled `ws` client omits Origin unless `origin` is set explicitly (#353).
 */
export function createNodeWebSocket(url: string): WebSocket {
  return new WebSocket(url, { perMessageDeflate: false })
}
