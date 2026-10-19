package io.github.liguobao.dshremote

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class RemoteForegroundServiceModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "DshRemoteForegroundService"

  @ReactMethod
  fun start(promise: Promise) {
    context.runOnUiQueueThread { RemoteForegroundService.start(context, promise) }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    context.runOnUiQueueThread {
      RemoteForegroundService.stop(context)
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun waitUntilStopped(lifetimeId: String, promise: Promise) {
    context.runOnUiQueueThread { RemoteForegroundService.waitUntilStopped(lifetimeId, promise) }
  }

  override fun invalidate() {
    context.runOnUiQueueThread { RemoteForegroundService.stop(context) }
    super.invalidate()
  }
}

