package io.github.liguobao.dshremote

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.ResultReceiver
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.util.UUID

/** Owns CPU and RN timer eligibility for the lifetime of the remote carrier. */
class RemoteForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var taskId: Int? = null
  private var taskContext: ReactContext? = null
  private var lifetimeId: String? = null
  private val stopWaiters = mutableListOf<Promise>()

  @Suppress("DEPRECATION")
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val receiver = intent?.getParcelableExtra<ResultReceiver>(EXTRA_RESULT)
    if (intent?.action != ACTION_START) {
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      createChannel()
      startForeground(NOTIFICATION_ID, notification())
      startRuntime()
      running = this
      receiver?.send(0, Bundle.EMPTY)
    } catch (_: Exception) {
      releaseRuntime()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      receiver?.send(1, Bundle.EMPTY)
    }
    // The JavaScript Runtime owns reconnect and session restoration. Do not
    // resurrect a notification-only service after the process is killed.
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  @SuppressLint("WakelockTimeout")
  private fun startRuntime() {
    if (taskId != null) return
    // Expo SDK 57 uses ReactHost. Do not create a replacement React runtime:
    // the authenticated connection belongs to the existing JS instance.
    val context = (application as ReactApplication).reactHost?.currentReactContext
      ?: error("The connection React runtime is unavailable")
    val powerManager = getSystemService(POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:remote-connection").apply {
      setReferenceCounted(false)
      // This continuous connection has no fixed deadline. releaseRuntime is
      // called on every stop/failure/destroy path; no screen wake lock is used.
      acquire()
    }
    taskContext = context
    lifetimeId = UUID.randomUUID().toString()
    taskId = HeadlessJsTaskContext.getInstance(context).startTask(
      HeadlessJsTaskConfig("DshRemoteConnection", Arguments.createMap().apply {
        putString("lifetimeId", lifetimeId)
      }, 0, true),
    )
  }

  private fun releaseRuntime() {
    if (running === this) running = null
    val context = taskContext
    val id = taskId
    taskContext = null
    taskId = null
    lifetimeId = null
    if (context != null && id != null) HeadlessJsTaskContext.getInstance(context).finishTask(id)
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    val waiters = stopWaiters.toList()
    stopWaiters.clear()
    for (promise in waiters) promise.resolve(null)
  }

  override fun onDestroy() {
    releaseRuntime()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun notification(): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
    .setSmallIcon(applicationInfo.icon)
    .setContentTitle(getString(R.string.app_name))
    .setContentText("Remote connection is active")
    .setCategory(NotificationCompat.CATEGORY_SERVICE)
    .setOngoing(true)
    .setOnlyAlertOnce(true)
    .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    .apply {
      packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
        setContentIntent(PendingIntent.getActivity(
          this@RemoteForegroundService, 0, intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ))
      }
    }
    .build()

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(
      CHANNEL_ID,
      "Remote connection",
      NotificationManager.IMPORTANCE_LOW,
    ))
  }

  companion object {
    private const val ACTION_START = "io.github.liguobao.dshremote.action.START"
    private const val EXTRA_RESULT = "result"
    private const val CHANNEL_ID = "remote_connection"
    private const val NOTIFICATION_ID = 7401
    private var running: RemoteForegroundService? = null

    fun start(context: Context, promise: Promise) {
      val receiver = object : ResultReceiver(Handler(Looper.getMainLooper())) {
        override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
          if (resultCode == 0) promise.resolve(null)
          else promise.reject("FOREGROUND_SERVICE_START_FAILED", "Android could not start the remote connection service.")
        }
      }
      try {
        val intent = Intent(context, RemoteForegroundService::class.java)
          .setAction(ACTION_START).putExtra(EXTRA_RESULT, receiver)
        ContextCompat.startForegroundService(context, intent)
      } catch (_: Exception) {
        promise.reject("FOREGROUND_SERVICE_START_FAILED", "Android did not allow the remote connection service to start. Open the app and reconnect.")
      }
    }

    fun stop(context: Context) {
      running?.releaseRuntime()
      context.stopService(Intent(context, RemoteForegroundService::class.java))
    }

    fun waitUntilStopped(lifetimeId: String, promise: Promise) {
      val service = running
      // A task queued by a retired service must not attach to its replacement.
      if (service == null || service.lifetimeId != lifetimeId) promise.resolve(null)
      else service.stopWaiters.add(promise)
    }
  }
}

