import { requireOptionalNativeModule } from 'expo'
import { browserRtcFactory, type RtcBinarySender, type RtcPeerConnectionFactory } from '@dsh-remote/webrtc'

type NativeRtc = {
  isAvailable(): boolean
  send(peerConnectionId: number, reactTag: string, payload: Uint8Array): void
}

export function createNativeRtcSender(native: NativeRtc | undefined): RtcBinarySender | undefined {
  try { if (!native?.isAvailable()) return undefined } catch { return undefined }
  return (channel, data) => {
    // These fields belong to the pinned react-native-webrtc 124 data channel.
    // A different/native-less implementation retains its own public send method.
    const raw = channel as { _peerConnectionId?: unknown; _reactTag?: unknown } | null
    if (!raw || typeof raw._peerConnectionId !== 'number' || !Number.isSafeInteger(raw._peerConnectionId)
      || raw._peerConnectionId < 0 || raw._peerConnectionId > 0x7fffffff
      || typeof raw._reactTag !== 'string' || !raw._reactTag || raw._reactTag.length > 128) return false
    native.send(raw._peerConnectionId, raw._reactTag, new Uint8Array(data))
    return true
  }
}

let checked = false
let sender: RtcBinarySender | undefined
export function nativeRtcFactory(): RtcPeerConnectionFactory | undefined {
  if (!checked) {
    checked = true
    sender = createNativeRtcSender(requireOptionalNativeModule<NativeRtc>('RemoteWebRtcBinary') ?? undefined)
  }
  return sender ? browserRtcFactory({ sendBinary: sender }) : undefined
}
