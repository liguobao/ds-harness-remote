import { requireOptionalNativeModule } from 'expo'

type NativeSocket = { isAvailable(): boolean; send(socketId:number, data:Uint8Array):void }
export type BinarySocketSender = (socket:unknown, data:Uint8Array) => void
export function createNativeWebSocketSender(native: NativeSocket | undefined): BinarySocketSender | undefined {
  try { if (!native?.isAvailable()) return undefined } catch { return undefined }
  return (socket, data) => {
    const id = (socket as {_socketId?:unknown} | null)?._socketId
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0 || id > 0x7fffffff
      || !data.byteLength || data.byteLength > 65535) throw new Error('Invalid native binary socket send')
    // Once attempted, errors propagate. Never retry ciphertext with the same nonce.
    native.send(id, data)
  }
}
let sender: BinarySocketSender | undefined
let checked = false
export function nativeWebSocketSender(): BinarySocketSender | undefined {
  if (!checked) {
    checked = true
    sender = createNativeWebSocketSender(requireOptionalNativeModule<NativeSocket>('RemoteWebSocketBinary') ?? undefined)
  }
  return sender
}
