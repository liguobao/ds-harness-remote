package io.github.liguobao.dshremote

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class RemoteProcessTextModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var pendingText: String? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "DshProcessText"

  @ReactMethod
  fun getInitialText(promise: Promise) {
    val currentActivity = reactContext.currentActivity
    val fromIntent = extractProcessText(currentActivity?.intent)
    if (fromIntent != null) {
      // Consume once so it doesn't replay when remounting or switching sessions
      currentActivity?.intent?.removeExtra(Intent.EXTRA_PROCESS_TEXT)
    }
    val text = fromIntent ?: pendingText
    pendingText = null
    promise.resolve(text)
  }

  override fun onNewIntent(intent: Intent) {
    try {
      val text = extractProcessText(intent)
      if (!text.isNullOrEmpty()) {
        if (reactContext.hasActiveReactInstance()) {
          reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onProcessText", text)
        } else {
          pendingText = text
        }
      }
    } catch (_: Throwable) {
      val text = extractProcessText(intent)
      if (!text.isNullOrEmpty()) {
        pendingText = text
      }
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {}

  override fun invalidate() {
    super.invalidate()
    reactContext.removeActivityEventListener(this)
  }

  private fun extractProcessText(intent: Intent?): String? {
    if (intent?.action == Intent.ACTION_PROCESS_TEXT) {
      val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
      return text?.toString()
    }
    return null
  }
}
