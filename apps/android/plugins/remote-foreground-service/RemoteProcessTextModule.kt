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

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "DshProcessText"

  @ReactMethod
  fun getInitialText(promise: Promise) {
    val currentActivity = reactContext.currentActivity
    val text = extractProcessText(currentActivity?.intent)
    promise.resolve(text)
  }

  override fun onNewIntent(intent: Intent?) {
    val text = extractProcessText(intent)
    if (!text.isNullOrEmpty()) {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("onProcessText", text)
    }
  }

  override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {}

  private fun extractProcessText(intent: Intent?): String? {
    if (intent?.action == Intent.ACTION_PROCESS_TEXT) {
      val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
      return text?.toString()
    }
    return null
  }
}
