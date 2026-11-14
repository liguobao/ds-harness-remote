package io.github.liguobao.dshremote.transport

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.websocket.WebSocketModule
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okio.ByteString.Companion.toByteString

/** Byte-only adapter to the existing RN socket; no keys, reconnect or retry ownership. */
class RemoteWebSocketBinaryModule : Module() {
  private fun webSocket(): WebSocketModule? = (appContext.reactContext as? ReactApplicationContext)
    ?.getNativeModule(WebSocketModule::class.java)

  override fun definition() = ModuleDefinition {
    Name("RemoteWebSocketBinary")
    Function("isAvailable") { webSocket() != null }
    Function("send") { socketId: Int, payload: ByteArray ->
      require(socketId >= 0 && payload.isNotEmpty() && payload.size <= 65535)
      requireNotNull(webSocket()) { "WebSocket module unavailable" }.sendBinary(payload.toByteString(), socketId)
    }
  }
}
