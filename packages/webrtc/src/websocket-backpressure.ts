/** Bound Relay buffering without changing the encrypted frame order. Call from serialized data sends. */
export async function waitForRelayCapacity(socket: { readonly readyState: number; readonly bufferedAmount?: number }): Promise<void> {
  const started = Date.now()
  while ((socket.bufferedAmount ?? 0) > 512 * 1024) {
    if (socket.readyState !== 1 || Date.now() - started > 10_000) throw new Error('Relay consumer is too slow or disconnected')
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
  if (socket.readyState !== 1) throw new Error('Relay transport closed')
}
