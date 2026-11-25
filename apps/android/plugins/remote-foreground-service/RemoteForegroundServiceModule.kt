package io.github.liguobao.dshremote

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import java.util.concurrent.atomic.AtomicBoolean

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
  fun notifyAttention(
    hostId: String,
    deepLinkUrl: String,
    tag: String,
    title: String,
    body: String,
  ) {
    try {
      RemoteForegroundService.notifyAttention(context, hostId, deepLinkUrl, tag, title, body)
    } catch (e: Throwable) {
      Log.w("RemoteForegroundService", "notifyAttention failed: ${e.javaClass.simpleName}")
    }
  }

  @ReactMethod
  fun clearAttentionAlerts(hostId: String) {
    try {
      RemoteForegroundService.clearAttentionAlerts(context, hostId)
    } catch (e: Throwable) {
      Log.w("RemoteForegroundService", "clearAttentionAlerts failed: ${e.javaClass.simpleName}")
    }
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
  fun updateLiveTask(
    hostId: String,
    sessionId: String,
    badge: String,
    title: String,
    statusText: String,
    isWaitingInput: Boolean,
    updatedAtMs: Double,
    summary: String,
    promise: Promise,
  ) {
    context.runOnUiQueueThread {
      try {
        val boundedTitle = title.take(150)
        val boundedBadge = badge.take(10)
        val boundedStatus = statusText.take(50)
        val safeTime = if (updatedAtMs.isFinite() && updatedAtMs > 0) updatedAtMs.toLong() else 0L
        val boundedSummary = summary.take(400)
        RemoteForegroundService.updateLiveTask(
          hostId, sessionId, boundedBadge, boundedTitle, boundedStatus, isWaitingInput, safeTime, boundedSummary
        )
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("UPDATE_LIVE_TASK_FAILED", e.message, e)
      }
    }
  }

  @ReactMethod
  fun updateLiveTaskV2(
    hostId: String,
    deepLinkUrl: String,
    badge: String,
    title: String,
    statusText: String,
    isWaitingInput: Boolean,
    updatedAtMs: Double,
    summary: String,
    extraCount: Int,
    promise: Promise,
  ) {
    updateLiveTaskV3(hostId, deepLinkUrl, badge, title, statusText, isWaitingInput, updatedAtMs, summary,
      extraCount, "", 0.0, "", promise)
  }

  @ReactMethod
  fun updateLiveTaskV3(
    hostId: String,
    deepLinkUrl: String,
    badge: String,
    title: String,
    statusText: String,
    isWaitingInput: Boolean,
    updatedAtMs: Double,
    summary: String,
    extraCount: Int,
    phase: String,
    startedAtMs: Double,
    countText: String,
    promise: Promise,
  ) {
    val settled = AtomicBoolean(false)
    fun resolveOnce() {
      if (settled.compareAndSet(false, true)) promise.resolve(null)
    }
    fun rejectOnce(code: String, error: Throwable) {
      if (settled.compareAndSet(false, true)) promise.reject(code, error.message ?: code, error)
    }
    try {
      context.runOnUiQueueThread {
        try {
          val boundedTitle = title.take(150)
          val boundedBadge = badge.take(10)
          val boundedStatus = statusText.take(50)
          val safeTime = if (updatedAtMs.isFinite() && updatedAtMs > 0) updatedAtMs.toLong() else 0L
          val boundedSummary = summary.take(400)
          val safeExtraCount = extraCount.coerceAtLeast(0)
          RemoteForegroundService.updateLiveTaskV2(
            hostId,
            deepLinkUrl,
            boundedBadge,
            boundedTitle,
            boundedStatus,
            isWaitingInput,
            safeTime,
            boundedSummary,
            safeExtraCount, phase.take(50), startedAtMs.toLong().coerceAtLeast(0), countText.take(100),
          )
          resolveOnce()
        } catch (e: Throwable) {
          rejectOnce("UPDATE_LIVE_TASK_V2_FAILED", e)
        }
      }
    } catch (e: Throwable) {
      rejectOnce("UPDATE_LIVE_TASK_V2_FAILED", e)
    }
  }

  @ReactMethod
  fun clearLiveTask(promise: Promise) {
    context.runOnUiQueueThread {
      try {
        RemoteForegroundService.clearLiveTask()
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("CLEAR_LIVE_TASK_FAILED", e.message, e)
      }
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

