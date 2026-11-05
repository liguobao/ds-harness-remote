package io.github.liguobao.dshremote

import android.Manifest
import android.content.pm.PackageManager
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.ResultReceiver
import android.os.Bundle
import android.util.Log
import android.text.format.DateUtils
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.util.UUID

/** Snapshot of the remote task displayed as a live activity card on lock screen. */
data class LiveTaskData(
  val hostId: String,
  val sessionId: String,
  val badge: String,
  val title: String,
  val statusText: String,
  val isWaitingInput: Boolean,
  val updatedAtMs: Long,
)

/** Owns CPU and RN timer eligibility for the lifetime of the remote carrier. */
class RemoteForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var taskId: Int? = null
  private var taskContext: ReactContext? = null
  private var lifetimeId: String? = null
  private val stopWaiters = mutableListOf<Promise>()
  private var connectionStatus = "connecting"
  private var liveTask: LiveTaskData? = null

  @Suppress("DEPRECATION")
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val receiver = intent?.getParcelableExtra<ResultReceiver>(EXTRA_RESULT)
    if (intent?.action != ACTION_START) {
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      createChannel()
      liveTask = currentLiveTask
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(NOTIFICATION_ID, notification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
      } else {
        startForeground(NOTIFICATION_ID, notification())
      }
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
    if (wifiLock == null) {
      val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      if (wifiManager != null) {
        @Suppress("DEPRECATION")
        val mode = WifiManager.WIFI_MODE_FULL_HIGH_PERF
        try {
          wifiLock = wifiManager.createWifiLock(mode, "$packageName:remote-wifi").apply {
            setReferenceCounted(false)
            acquire()
          }
        } catch (e: Exception) {
          Log.w("RemoteForegroundService", "Could not acquire WifiLock: ${e.message}")
        }
      }
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
    try {
      if (context != null && id != null) HeadlessJsTaskContext.getInstance(context).finishTask(id)
    } catch (e: Exception) {
      Log.w("RemoteForegroundService", "Error finishing task: ${e.message}")
    } finally {
      val currentWifiLock = wifiLock
      wifiLock = null
      try {
        if (currentWifiLock?.isHeld == true) currentWifiLock.release()
      } catch (e: Exception) {
        Log.w("RemoteForegroundService", "Could not release WifiLock: ${e.message}")
      }
      try {
        wakeLock?.let { if (it.isHeld) it.release() }
      } catch (e: Exception) {
        Log.w("RemoteForegroundService", "Could not release WakeLock: ${e.message}")
      }
      wakeLock = null
    }
    val waiters = stopWaiters.toList()
    stopWaiters.clear()
    for (promise in waiters) promise.resolve(null)
  }

  override fun onDestroy() {
    releaseRuntime()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun formatRelativeTime(updatedAtMs: Long): String {
    if (updatedAtMs <= 0L) return ""
    val diffSec = maxOf(0L, (System.currentTimeMillis() - updatedAtMs) / 1000)
    return try {
      when {
        diffSec < 60 -> getString(R.string.live_task_time_just_now)
        diffSec < 3600 -> getString(R.string.live_task_time_minutes_ago, (diffSec / 60).toInt())
        diffSec < 86400 -> getString(R.string.live_task_time_hours_ago, (diffSec / 3600).toInt())
        else -> getString(R.string.live_task_time_days_ago, (diffSec / 86400).toInt())
      }
    } catch (_: Exception) {
      DateUtils.getRelativeTimeSpanString(
        updatedAtMs,
        System.currentTimeMillis(),
        DateUtils.MINUTE_IN_MILLIS
      ).toString()
    }
  }

  private fun notification(): Notification {
    val task = liveTask
    if (connectionStatus == "connected" && task != null) {
      val uri = Uri.Builder().scheme("dshremote").authority("conversation")
        .appendQueryParameter("host", task.hostId)
        .appendQueryParameter("session", task.sessionId)
        .build()
      val intent = Intent(this, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        data = uri
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      val reqId = (task.hostId + task.sessionId).hashCode() and 0x3fffffff
      val pendingIntent = PendingIntent.getActivity(
        this, reqId, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      val status = if (task.statusText.isNotBlank()) task.statusText else {
        try {
          if (task.isWaitingInput) getString(R.string.live_task_status_waiting) else getString(R.string.live_task_status_running)
        } catch (_: Exception) {
          if (task.isWaitingInput) "Waiting" else "Running"
        }
      }
      val statusColor = if (task.isWaitingInput) Color.parseColor("#FFAA00") else Color.parseColor("#00C2FF")
      val dotRes = if (task.isWaitingInput) R.drawable.dot_live_task_waiting else R.drawable.dot_live_task_running

      try {
        val expandedViews = RemoteViews(packageName, R.layout.notification_live_task).apply {
          setImageViewResource(R.id.live_task_app_icon, applicationInfo.icon)
          setTextViewText(R.id.live_task_app_name, getString(R.string.app_name))
          setImageViewResource(R.id.live_task_status_dot, dotRes)
          setTextViewText(R.id.live_task_status_text, status)
          setTextColor(R.id.live_task_status_text, statusColor)
          setTextViewText(R.id.live_task_time, formatRelativeTime(task.updatedAtMs))
          setTextViewText(R.id.live_task_badge, task.badge.ifBlank { "D" })
          setTextViewText(R.id.live_task_title, task.title.ifBlank { getString(R.string.app_name) })
          setOnClickPendingIntent(R.id.live_task_card, pendingIntent)
        }

        val collapsedViews = RemoteViews(packageName, R.layout.notification_live_task_collapsed).apply {
          setImageViewResource(R.id.live_task_status_dot, dotRes)
          setTextViewText(R.id.live_task_status_text, status)
          setTextColor(R.id.live_task_status_text, statusColor)
          setTextViewText(R.id.live_task_badge, task.badge.ifBlank { "D" })
          setTextViewText(R.id.live_task_title, task.title.ifBlank { getString(R.string.app_name) })
          setOnClickPendingIntent(R.id.live_task_card_collapsed, pendingIntent)
        }

        val builder = NotificationCompat.Builder(this, LIVE_CHANNEL_ID)
          .setPriority(NotificationCompat.PRIORITY_DEFAULT)
          .setSmallIcon(applicationInfo.icon)
          .setContentTitle("${getString(R.string.app_name)} · $status")
          .setContentText("[${task.badge}] ${task.title}")
          .setCustomContentView(collapsedViews)
          .setCustomBigContentView(expandedViews)
          .setStyle(NotificationCompat.DecoratedCustomViewStyle())
          .setContentIntent(pendingIntent)
          .setCategory(NotificationCompat.CATEGORY_SERVICE)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
          .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)

        if (task.updatedAtMs > 0) {
          builder.setWhen(task.updatedAtMs).setShowWhen(true)
        }

        return builder.build()
      } catch (e: Exception) {
        Log.w("RemoteForegroundService", "Failed to build custom live task notification, falling back", e)
      }
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(getString(R.string.app_name))
      .setContentText(when (connectionStatus) {
        "connected" -> "Remote connected"
        "reconnecting" -> "Remote disconnected · reconnecting"
        else -> "Connecting to remote Host"
      })
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
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
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(
      CHANNEL_ID,
      "Remote connection",
      NotificationManager.IMPORTANCE_LOW,
    ))
    manager.createNotificationChannel(NotificationChannel(
      LIVE_CHANNEL_ID,
      "Live tasks",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    })
  }

  companion object {
    private const val ACTION_START = "io.github.liguobao.dshremote.action.START"
    private const val EXTRA_RESULT = "result"
    private const val CHANNEL_ID = "remote_connection"
    private const val LIVE_CHANNEL_ID = "live_tasks"
    private const val NOTIFICATION_ID = 7401
    private var running: RemoteForegroundService? = null
    private var currentLiveTask: LiveTaskData? = null

    fun updateLiveTask(
      hostId: String,
      sessionId: String,
      badge: String,
      title: String,
      statusText: String,
      isWaitingInput: Boolean,
      updatedAtMs: Long,
    ) {
      val data = LiveTaskData(hostId, sessionId, badge, title, statusText, isWaitingInput, updatedAtMs)
      currentLiveTask = data
      val service = running ?: return
      service.liveTask = data
      service.getSystemService(NotificationManager::class.java)
        .notify(NOTIFICATION_ID, service.notification())
    }

    fun clearLiveTask() {
      currentLiveTask = null
      val service = running ?: return
      service.liveTask = null
      service.getSystemService(NotificationManager::class.java)
        .notify(NOTIFICATION_ID, service.notification())
    }

    fun notifyTask(context: Context, hostId: String, sessionId: String, title: String, body: String) {
      if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
      val manager = context.getSystemService(NotificationManager::class.java)
      val channel = "remote_tasks"
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(channel, "Remote tasks", NotificationManager.IMPORTANCE_DEFAULT))
      val uri = Uri.Builder().scheme("dshremote").authority("conversation").appendQueryParameter("host", hostId).appendQueryParameter("session", sessionId).build()
      val intent = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(uri).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val id = (hostId + sessionId).hashCode() and 0x3fffffff
      val pending = PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val notification = NotificationCompat.Builder(context, channel).setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(title).setContentText(body).setContentIntent(pending).setAutoCancel(true)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
      try {manager.notify("remote_task", id, notification)} catch (_: SecurityException) { }
    }

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

    fun setStatus(status: String) {
      if (status !in setOf("connecting", "connected", "reconnecting")) return
      val service = running ?: return
      service.connectionStatus = status
      service.getSystemService(NotificationManager::class.java)
        .notify(NOTIFICATION_ID, service.notification())
    }

    fun waitUntilStopped(lifetimeId: String, promise: Promise) {
      val service = running
      // A task queued by a retired service must not attach to its replacement.
      if (service == null || service.lifetimeId != lifetimeId) promise.resolve(null)
      else service.stopWaiters.add(promise)
    }
  }
}
