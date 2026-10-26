package io.github.liguobao.dshremote

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
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
  fun notifyTask(hostId: String, sessionId: String, title: String, body: String) {
    RemoteForegroundService.notifyTask(context, hostId, sessionId, title, body)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    context.runOnUiQueueThread {
      RemoteForegroundService.stop(context)
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun setStatus(status: String, promise: Promise) {
    context.runOnUiQueueThread {
      RemoteForegroundService.setStatus(status)
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun waitUntilStopped(lifetimeId: String, promise: Promise) {
    context.runOnUiQueueThread { RemoteForegroundService.waitUntilStopped(lifetimeId, promise) }
  }

  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      promise.resolve(pm?.isIgnoringBatteryOptimizations(context.packageName) ?: false)
    } else {
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun requestIgnoreBatteryOptimizations(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (pm != null && pm.isIgnoringBatteryOptimizations(context.packageName)) {
        promise.resolve(true)
        return
      }
      try {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        promise.resolve(true)
      } catch (_: Exception) {
        try {
          val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          context.startActivity(fallback)
          promise.resolve(true)
        } catch (_: Exception) {
          try {
            val appDetails = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
              data = Uri.parse("package:${context.packageName}")
              addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(appDetails)
            promise.resolve(true)
          } catch (e: Exception) {
            promise.reject("BATTERY_SETTING_FAILED", e.message)
          }
        }
      }
    } else {
      promise.resolve(true)
    }
  }

  override fun invalidate() {
    context.runOnUiQueueThread { RemoteForegroundService.stop(context) }
    super.invalidate()
  }
}

