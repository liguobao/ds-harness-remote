package io.github.liguobao.dshremote.transport

import android.util.Base64
import com.facebook.react.bridge.ReactApplicationContext
import com.oney.WebRTCModule.WebRTCModule
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Keeps ciphertext binary across JSI, forwarding to the existing WebRTC executor/API. */
class RemoteWebRtcBinaryModule : Module() {
  private fun webRtc(): WebRTCModule? = (appContext.reactContext as? ReactApplicationContext)
    ?.getNativeModule(WebRTCModule::class.java)

  override fun definition() = ModuleDefinition {
    Name("RemoteWebRtcBinary")
    Function("isAvailable") { webRtc() != null }
    Function("send") { peerConnectionId: Int, reactTag: String, payload: ByteArray ->
      require(peerConnectionId >= 0 && reactTag.isNotEmpty() && reactTag.length <= 128 && payload.size <= 16384)
      val module = requireNotNull(webRtc()) { "WebRTC module unavailable" }
      // Preserve react-native-webrtc 124's ordered executor, ownership and buffer events.
      // Its Java API takes base64; keep that inexpensive conversion entirely native.
      module.dataChannelSend(peerConnectionId, reactTag, Base64.encodeToString(payload, Base64.NO_WRAP), "binary")
    }
  }
}
