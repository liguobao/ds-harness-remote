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
import android.content.res.Configuration
import android.graphics.drawable.Icon
import android.provider.Settings
import org.json.JSONObject
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
import android.view.View
import android.text.format.DateUtils
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.security.MessageDigest
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
  val summary: String = "",
  val deepLinkUrl: String? = null,
  val extraCount: Int = 0,
  val phase: String = "",
  val startedAtMs: Long = 0,
  val countText: String = "",
)

/** Owns CPU and RN timer eligibility for the lifetime of the remote carrier. */
class RemoteForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var taskId: Int? = null
  private var taskContext: ReactContext? = null
  private var lifetimeId: String? = null
  private val stopWaiters = mutableListOf<Promise>()
  private var connectedHostId = ""
  private var workspaceLabel = ""
  private fun islandLabel(detail: String) = listOf(connectedHostName, detail).filter { it.isNotBlank() }.joinToString(" - ")
  private var connectedHostName = ""
  private var connectionStatus = "connecting"
  private var liveTask: LiveTaskData? = null

  private val samsungOngoing = Build.VERSION.SDK_INT >= 35 && Build.MANUFACTURER.equals("samsung", true)
  private fun configuredScene(key: String) = packageManager
    .getApplicationInfo(packageName, PackageManager.GET_META_DATA).metaData?.getString("$packageName.$key")
  private val huaweiEvent by lazy {
    if (Build.MANUFACTURER.equals("huawei", true)) configuredScene("HUAWEI_LIVE_EVENT") else null
  }
  private val vivoScene by lazy {
    if (listOf(Build.MANUFACTURER, Build.BRAND).any { it.equals("vivo", true) || it.equals("iQOO", true) }) {
      configuredScene("VIVO_ATOMIC_SCENE")
    } else null
  }
  private var vendorTaskActive = false

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

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    if (liveTask != null) {
      getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification())
    }
  }

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

  private fun addXiaomiFocus(notification: Notification, version: Int, detail: String, title: String) {
    val status = islandLabel(detail)
    val params = JSONObject()
      .put("protocol", 1)
      .put("business", "remote_task")
      .put("updatable", true)
      .put("reopen", "reopen")
      .put("islandFirstFloat", false)
      .put("ticker", status)
      .put("baseInfo", JSONObject().put("type", 2).put("title", status).put("content", title))
    if (version >= 3) {
      val iconKey = "miui.focus.pic_task"
      notification.extras.putBundle("miui.focus.pics", Bundle().apply {
        putParcelable(iconKey, Icon.createWithResource(this@RemoteForegroundService, R.mipmap.ic_launcher_foreground))
      })
      val pic = JSONObject().put("type", 1).put("pic", iconKey)
      val label = JSONObject().put("type", 1).put("picInfo", pic)
        .put("textInfo", JSONObject().put("title", connectedHostName.ifBlank { detail }))
      val area = JSONObject().put("imageTextInfoLeft", label)
      if (connectedHostName.isNotBlank() && detail.isNotBlank()) {
        area.put("imageTextInfoRight", JSONObject().put("type", 2)
          .put("textInfo", JSONObject().put("title", detail)))
      }
      params.put("param_island", JSONObject()
        .put("bigIslandArea", area)
        .put("smallIslandArea", JSONObject().put("picInfo", pic)))
    }
    notification.extras.putString("miui.focus.param", JSONObject().put("param_v2", params).toString())
  }

  private fun extendLiveTask(notification: Notification, status: String, title: String) {
    val extras = notification.extras
    if (samsungOngoing) {
      extras.putInt("android.ongoingActivityNoti.style", 1)
      extras.putParcelable("android.ongoingActivityNoti.secondIcon", notification.smallIcon)
      extras.putString("android.ongoingActivityNoti.chipExpandedText", status)
      extras.putString("android.ongoingActivityNoti.nowbarPrimaryInfo", status)
      extras.putString("android.ongoingActivityNoti.nowbarSecondaryInfo", title)
      extras.putString("android.ongoingActivityNoti.primaryInfo", status)
      extras.putString("android.ongoingActivityNoti.secondaryInfo", title)
    }
    huaweiEvent?.let { event ->
      extras.putString("notification.live.event", event)
      extras.putInt("notification.live.operation", if (vendorTaskActive) 1 else 0)
      extras.putInt("notification.live.type", 1)
      extras.putBundle("notification.live.capsule", Bundle().apply {
        putInt("notification.live.capsuleStatus", 1)
        putInt("notification.live.capsuleType", 1)
        putParcelable("notification.live.capsuleIcon", notification.smallIcon)
        putInt("notification.live.capsuleBgColor", Color.rgb(32, 58, 77))
        putString("notification.live.capsuleTitle", status)
        putString("notification.live.capsuleContent", title)
      })
      vendorTaskActive = true
    }
    vivoScene?.let { scene ->
      extras.putString("notification.superx.scene", scene)
      extras.putInt("notification.superx.operation", if (vendorTaskActive) 1 else 0)
      extras.putBoolean("notification.superx.showNotify", true)
      extras.putInt("notification.superx.template", 1)
      extras.putParcelable("notification.superx.clickResp", notification.contentIntent)
      extras.putBundle("notification.superx.baseInfos", Bundle().apply {
        putParcelable("notification.superx.baseInfos.icon", notification.smallIcon)
        putCharSequence("notification.superx.baseInfos.title", status)
        putCharSequence("notification.superx.baseInfos.content", title)
      })
      vendorTaskActive = true
    }
  }

  private fun notification(): Notification {
    val task = liveTask
    if (connectionStatus == "connected" && task != null) {
      val (intent, reqId) = if (task.deepLinkUrl != null) {
        val (safeIntent, targetKey) = buildSafeDeepLinkTarget(this, task.hostId, task.deepLinkUrl)
        Pair(safeIntent, pendingIntentRequestCode("live", task.hostId.trim(), targetKey))
      } else {
        val uri = Uri.Builder().scheme("dshremote").authority("conversation")
          .appendQueryParameter("host", task.hostId)
          .appendQueryParameter("session", task.sessionId)
          .build()
        val legacyIntent = Intent(this, MainActivity::class.java).apply {
          action = Intent.ACTION_VIEW
          data = uri
          addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        Pair(legacyIntent, (task.hostId + task.sessionId).hashCode() and 0x3fffffff)
      }
      val pendingIntent = PendingIntent.getActivity(
        this, reqId, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      val baseStatus = if (task.statusText.isNotBlank()) task.statusText else {
        try {
          if (task.isWaitingInput) getString(R.string.live_task_status_waiting) else getString(R.string.live_task_status_running)
        } catch (_: Exception) {
          if (task.isWaitingInput) "Waiting" else "Running"
        }
      }
      val safeExtraCount = task.extraCount.coerceAtLeast(0)
      val displayStatus = if (safeExtraCount > 0) "$baseStatus · +$safeExtraCount" else baseStatus
      val safeTitle = task.title.ifBlank { baseStatus }
      val titleWithCount = listOf(safeTitle, task.countText).filter { it.isNotBlank() }.joinToString(" · ")
      val timed = !task.isWaitingInput && task.startedAtMs in 1..System.currentTimeMillis()
      val status = task.phase.ifBlank { baseStatus }
      val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
      val statusColor = if (task.isWaitingInput) {
        Color.parseColor(if (night) "#F5C45E" else "#B45309")
      } else {
        Color.parseColor(if (night) "#6F89FF" else "#3A56E6")
      }
      val dotRes = if (task.isWaitingInput) R.drawable.dot_live_task_waiting else R.drawable.dot_live_task_running
      val badgeColor = Color.parseColor(if (night) "#6F89FF" else "#4D6BFE")
      val titleColor = if (night) Color.WHITE else Color.parseColor("#1F1F1F")
      val timeColor = if (night) Color.parseColor("#99FFFFFF") else Color.parseColor("#99000000")

      try {
        val publicNotification = NotificationCompat.Builder(this, LIVE_CHANNEL_ID)
          .setSmallIcon(R.mipmap.ic_launcher_foreground)
          .setContentTitle(displayStatus)
          .setCategory(NotificationCompat.CATEGORY_SERVICE)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .build()

        val builder = NotificationCompat.Builder(this, LIVE_CHANNEL_ID)
          .setPriority(NotificationCompat.PRIORITY_DEFAULT)
          .setSmallIcon(R.mipmap.ic_launcher_foreground)
          .setContentTitle("$status · $safeTitle")
          .setContentText(task.summary.ifBlank { displayStatus })
          .setPublicVersion(publicNotification)
          .setContentIntent(pendingIntent)
          .setCategory(NotificationCompat.CATEGORY_SERVICE)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
          .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)

        if (Build.VERSION.SDK_INT >= 36) {
          builder.setRequestPromotedOngoing(true)
          if (!timed) builder.setShortCriticalText(islandLabel(status))
          if (task.summary.isNotBlank()) {
            builder.setStyle(NotificationCompat.BigTextStyle().bigText(listOf(displayStatus, task.summary)
              .filter { it.isNotBlank() }.joinToString("\n")))
          }
        } else if (!samsungOngoing && vivoScene == null && huaweiEvent == null) {
          val expandedViews = RemoteViews(packageName, R.layout.notification_live_task).apply {
            setImageViewResource(R.id.live_task_status_dot, dotRes)
            setTextViewText(R.id.live_task_status_text, displayStatus)
            setTextColor(R.id.live_task_status_text, statusColor)
            setTextViewText(R.id.live_task_time, formatRelativeTime(task.updatedAtMs))
            setTextColor(R.id.live_task_time, timeColor)
            setTextViewText(R.id.live_task_badge, task.badge.ifBlank { "D" })
            setTextColor(R.id.live_task_badge, badgeColor)
            setTextViewText(R.id.live_task_title, titleWithCount)
            setTextColor(R.id.live_task_title, titleColor)
            setTextViewText(R.id.live_task_summary, task.summary)
            setTextColor(R.id.live_task_summary, timeColor)
            setViewVisibility(R.id.live_task_summary, if (task.summary.isBlank()) View.GONE else View.VISIBLE)
            setOnClickPendingIntent(R.id.live_task_card, pendingIntent)
          }

          val collapsedViews = RemoteViews(packageName, R.layout.notification_live_task_collapsed).apply {
            setImageViewResource(R.id.live_task_status_dot, dotRes)
            setTextViewText(R.id.live_task_status_text, displayStatus)
            setTextColor(R.id.live_task_status_text, statusColor)
            setTextViewText(R.id.live_task_badge, task.badge.ifBlank { "D" })
            setTextColor(R.id.live_task_badge, badgeColor)
            setTextViewText(R.id.live_task_title, safeTitle)
            setTextColor(R.id.live_task_title, titleColor)
            setOnClickPendingIntent(R.id.live_task_card_collapsed, pendingIntent)
          }

          builder.setCustomContentView(collapsedViews)
            .setCustomBigContentView(expandedViews)
            .setStyle(NotificationCompat.DecoratedCustomViewStyle())
        }

        if (timed) {
          builder.setWhen(task.startedAtMs).setShowWhen(true).setUsesChronometer(true)
        } else if (task.updatedAtMs > 0) {
          builder.setWhen(task.updatedAtMs).setShowWhen(true)
        }

        val notification = builder.build()
        val focusVersion = runCatching {
          Settings.System.getInt(contentResolver, "notification_focus_protocol", 0)
        }.getOrDefault(0)
        // Vendor lock-screen surfaces can render extras independently of publicVersion.
        val publicDetail = task.countText.ifBlank { getString(R.string.app_name) }
        if (focusVersion >= 2) {
          addXiaomiFocus(notification, focusVersion, status, publicDetail)
        }
        extendLiveTask(notification, status, publicDetail)
        return notification
      } catch (e: Exception) {
        Log.w("RemoteForegroundService", "Failed to build custom live task notification, falling back", e)
      }
    }

    val title = if (connectionStatus == "connected" && connectedHostName.isNotEmpty()) {
        getString(R.string.remote_status_connected_named, connectedHostName)
      } else getString(when (connectionStatus) {
        "connected" -> R.string.remote_status_connected
        "reconnecting" -> R.string.remote_status_reconnecting
        else -> R.string.remote_status_connecting
      })
    val showHost = connectionStatus == "connected" && connectedHostName.isNotEmpty()
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher_foreground)
      .setContentTitle(if (showHost) islandLabel(workspaceLabel) else title)
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
      .build().also { notification ->
        if (vendorTaskActive) {
          huaweiEvent?.let {
            notification.extras.putString("notification.live.event", it)
            notification.extras.putInt("notification.live.operation", 2)
            notification.extras.putInt("notification.live.type", 1)
          }
          vivoScene?.let {
            notification.extras.putString("notification.superx.scene", it)
            notification.extras.putInt("notification.superx.operation", 2)
          }
          vendorTaskActive = false
        }
      }
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
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    })
  }

  companion object {
    private const val ACTION_START = "io.github.liguobao.dshremote.action.START"
    private const val EXTRA_RESULT = "result"
    private const val CHANNEL_ID = "remote_connection"
    private const val LIVE_CHANNEL_ID = "live_tasks"
    private const val TASK_CHANNEL_ID = "remote_tasks"
    private const val TASK_GROUP = "dsh_remote_task_alerts"
    private const val ATTENTION_GROUP = "dsh_remote_attention_alerts"
    private const val NOTIFICATION_ID = 7401
    private const val ATTENTION_NOTIFICATION_ID = 7402
    private const val ATTENTION_TAG_PREFIX = "dsh-attention:"
    private const val EXTRA_ATTENTION_HOST_ID = "dsh_attention_host_id"
    private const val DEEP_LINK_PREFIX = "dshremote://"
    private const val MAX_DEEP_LINK_LENGTH = 2048
    private const val MAX_ATTENTION_TAGS_PER_HOST = 64
    private const val MAX_TRACKED_ATTENTION_HOSTS = 64
    private const val HEX_CHARS = "0123456789abcdef"
    private val SAFE_TAG_REGEX = Regex("^[A-Za-z0-9._:-]{1,100}$")
    private val UNSAFE_TAG_CHARS = Regex("[^A-Za-z0-9._:-]")
    private val attentionTagsLock = Any()
    private val activeAttentionTags = LinkedHashMap<String, LinkedHashSet<String>>()
    private var running: RemoteForegroundService? = null
    private var currentLiveTask: LiveTaskData? = null

    private fun shortSha256Hex(input: String): String {
      return try {
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        val hex = StringBuilder(12)
        for (i in 0 until 6) {
          val b = digest[i].toInt() and 0xff
          hex.append(HEX_CHARS[b ushr 4])
          hex.append(HEX_CHARS[b and 0x0f])
        }
        hex.toString()
      } catch (_: Exception) {
        (input.hashCode() and 0x7fffffff).toString(16)
      }
    }

    private fun parseSafeDeepLinkUri(deepLinkUrl: String): Uri? {
      val trimmed = deepLinkUrl.trim()
      if (trimmed.length > MAX_DEEP_LINK_LENGTH) return null
      if (!trimmed.startsWith(DEEP_LINK_PREFIX)) return null
      if (trimmed.any { ch -> ch.code < 0x20 || ch.code == 0x7f }) return null
      val uri = try {
        Uri.parse(trimmed)
      } catch (_: Exception) {
        return null
      }
      if (uri.scheme != "dshremote") return null
      if (uri.host.isNullOrBlank() || uri.userInfo != null || uri.port != -1) return null
      return uri
    }

    private fun buildSafeDeepLinkTarget(
      context: Context,
      hostId: String,
      deepLinkUrl: String,
    ): Pair<Intent, String> {
      val trimmedHost = hostId.trim()
      val safeUri = parseSafeDeepLinkUri(deepLinkUrl) ?: if (trimmedHost.isNotEmpty()) {
        Uri.Builder()
          .scheme("dshremote")
          .authority("conversation")
          .appendQueryParameter("host", trimmedHost)
          .build()
      } else {
        null
      }
      if (safeUri != null) {
        val intent = Intent(context, MainActivity::class.java).apply {
          action = Intent.ACTION_VIEW
          data = safeUri
          addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        return Pair(intent, safeUri.toString())
      }
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(context, MainActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
      return Pair(launchIntent, "launch")
    }

    private fun pendingIntentRequestCode(namespace: String, hostId: String, targetKey: String): Int {
      val seed = "$namespace\u0000$hostId\u0000$targetKey"
      val hash = try {
        val digest = MessageDigest.getInstance("SHA-256").digest(seed.toByteArray(Charsets.UTF_8))
        ((digest[0].toInt() and 0x3f) shl 24) or
          ((digest[1].toInt() and 0xff) shl 16) or
          ((digest[2].toInt() and 0xff) shl 8) or
          (digest[3].toInt() and 0xff)
      } catch (_: Exception) {
        seed.hashCode() and 0x3fffffff
      }
      return if (hash == 0) 1 else hash
    }

    private fun sanitizeAttentionTag(rawTag: String, hostKey: String, targetKey: String): String {
      if (SAFE_TAG_REGEX.matches(rawTag)) return rawTag
      if (rawTag.isNotBlank()) {
        val cleaned = rawTag.replace(UNSAFE_TAG_CHARS, "_").trim('_').take(64).ifBlank { "item" }
        return "$cleaned-${shortSha256Hex(rawTag)}"
      }
      return "item-${shortSha256Hex("$hostKey\u0000$targetKey")}"
    }

    fun updateLiveTask(
      hostId: String,
      sessionId: String,
      badge: String,
      title: String,
      statusText: String,
      isWaitingInput: Boolean,
      updatedAtMs: Long,
      summary: String = "",
      startedAtMs: Long = 0,
      countText: String = "",
    ) {
      val data = LiveTaskData(hostId, sessionId, badge, title, statusText, isWaitingInput, updatedAtMs, summary, startedAtMs = startedAtMs, countText = countText)
      currentLiveTask = data
      val service = running ?: return
      service.liveTask = data
      service.getSystemService(NotificationManager::class.java)
        .notify(NOTIFICATION_ID, service.notification())
    }

    fun updateLiveTaskV2(
      hostId: String,
      deepLinkUrl: String,
      badge: String,
      title: String,
      statusText: String,
      isWaitingInput: Boolean,
      updatedAtMs: Long,
      summary: String = "",
      extraCount: Int = 0,
      phase: String = "",
      startedAtMs: Long = 0,
      countText: String = "",
    ) {
      val safeExtraCount = extraCount.coerceAtLeast(0)
      val data = LiveTaskData(
        hostId = hostId,
        sessionId = "",
        badge = badge,
        title = title,
        statusText = statusText,
        isWaitingInput = isWaitingInput,
        updatedAtMs = updatedAtMs,
        summary = summary,
        deepLinkUrl = deepLinkUrl,
        extraCount = safeExtraCount,
        phase = phase,
        startedAtMs = startedAtMs,
        countText = countText,
      )
      currentLiveTask = data
      val service = running ?: return
      val previousTask = service.liveTask
      val previousVendorTaskActive = service.vendorTaskActive
      service.liveTask = data
      try {
        val manager = service.getSystemService(NotificationManager::class.java)
          ?: error("NotificationManager is unavailable")
        manager.notify(NOTIFICATION_ID, service.notification())
      } catch (e: Throwable) {
        // Never remove ongoing FGS notification 7401 on update failure.
        service.liveTask = previousTask
        service.vendorTaskActive = previousVendorTaskActive
        currentLiveTask = previousTask
        throw e
      }
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
      val channel = TASK_CHANNEL_ID
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(channel, "Remote tasks", NotificationManager.IMPORTANCE_DEFAULT))
      val uri = Uri.Builder().scheme("dshremote").authority("conversation").appendQueryParameter("host", hostId).appendQueryParameter("session", sessionId).build()
      val intent = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(uri).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val id = (hostId + sessionId).hashCode() and 0x3fffffff
      val pending = PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val notification = NotificationCompat.Builder(context, channel).setSmallIcon(R.mipmap.ic_launcher_foreground)
        .setContentTitle(title).setContentText(body).setContentIntent(pending).setAutoCancel(true)
        .setGroup(TASK_GROUP).setGroupSummary(false)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
      try {manager.notify("remote_task", id, notification)} catch (_: SecurityException) { }
    }

    @SuppressLint("MissingPermission")
    fun notifyAttention(
      context: Context,
      hostId: String,
      deepLinkUrl: String,
      tag: String,
      title: String,
      body: String,
    ) {
      if (Build.VERSION.SDK_INT >= 33 &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
      ) {
        return
      }
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(
          NotificationChannel(TASK_CHANNEL_ID, "Remote tasks", NotificationManager.IMPORTANCE_DEFAULT)
        )
      }

      val hostKey = hostId.trim()
      val (intent, targetKey) = buildSafeDeepLinkTarget(context, hostKey, deepLinkUrl)
      val safeTag = sanitizeAttentionTag(tag, hostKey, targetKey)
      val notificationTag = "$ATTENTION_TAG_PREFIX$safeTag"
      val reqId = pendingIntentRequestCode("attn", hostKey, targetKey)
      val pending = PendingIntent.getActivity(
        context,
        reqId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

      val boundedTitle = title.take(150).ifBlank { context.getString(R.string.app_name) }
      val boundedBody = body.take(400)
      val extras = Bundle().apply {
        putString(EXTRA_ATTENTION_HOST_ID, hostKey)
      }

      val notification = NotificationCompat.Builder(context, TASK_CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher_foreground)
        .setContentTitle(boundedTitle)
        .setContentText(boundedBody)
        .setContentIntent(pending)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setGroup(ATTENTION_GROUP)
        .setGroupSummary(false)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .addExtras(extras)
        .build()

      val nm = NotificationManagerCompat.from(context)
      try {
        nm.notify(notificationTag, ATTENTION_NOTIFICATION_ID, notification)
      } catch (_: SecurityException) {
        return
      }

      val evictedTags = mutableListOf<String>()
      synchronized(attentionTagsLock) {
        // Ensure each notificationTag is owned by at most one host bucket.
        val hostIter = activeAttentionTags.entries.iterator()
        while (hostIter.hasNext()) {
          val entry = hostIter.next()
          if (entry.key != hostKey && entry.value.remove(notificationTag) && entry.value.isEmpty()) {
            hostIter.remove()
          }
        }
        if (!activeAttentionTags.containsKey(hostKey) && activeAttentionTags.size >= MAX_TRACKED_ATTENTION_HOSTS) {
          val oldestHostIter = activeAttentionTags.entries.iterator()
          if (oldestHostIter.hasNext()) {
            val oldestHost = oldestHostIter.next()
            evictedTags.addAll(oldestHost.value)
            oldestHostIter.remove()
          }
        }
        val tags = activeAttentionTags.getOrPut(hostKey) { LinkedHashSet() }
        if (tags.contains(notificationTag)) {
          tags.remove(notificationTag)
          tags.add(notificationTag)
        } else {
          while (tags.size >= MAX_ATTENTION_TAGS_PER_HOST) {
            val tagIter = tags.iterator()
            if (!tagIter.hasNext()) break
            val oldestTag = tagIter.next()
            tagIter.remove()
            evictedTags.add(oldestTag)
          }
          tags.add(notificationTag)
        }
      }

      for (evicted in evictedTags) {
        try {
          nm.cancel(evicted, ATTENTION_NOTIFICATION_ID)
        } catch (_: Exception) {
        }
      }
    }

    fun clearAttentionAlerts(context: Context, hostId: String) {
      val hostKey = hostId.trim()
      val tagsToCancel = LinkedHashSet<String>()
      synchronized(attentionTagsLock) {
        if (hostKey.isEmpty()) {
          for (tags in activeAttentionTags.values) {
            tagsToCancel.addAll(tags)
          }
          activeAttentionTags.clear()
        } else {
          activeAttentionTags.remove(hostKey)?.let { tagsToCancel.addAll(it) }
        }
      }

      // Best-effort sweep of active attention alerts (ID 7402 only) that may have
      // outlived a process restart; never touch ongoing FGS notification 7401.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        try {
          val manager = context.getSystemService(NotificationManager::class.java)
          if (manager != null) {
            for (sbn in manager.activeNotifications) {
              if (sbn.id != ATTENTION_NOTIFICATION_ID) continue
              val sbnTag = sbn.tag ?: continue
              if (!sbnTag.startsWith(ATTENTION_TAG_PREFIX)) continue
              if (hostKey.isEmpty() || sbn.notification.extras?.getString(EXTRA_ATTENTION_HOST_ID) == hostKey) {
                tagsToCancel.add(sbnTag)
              }
            }
          }
        } catch (_: Throwable) {
        }
      }

      if (tagsToCancel.isEmpty()) return
      val nm = NotificationManagerCompat.from(context)
      for (tag in tagsToCancel) {
        try {
          nm.cancel(tag, ATTENTION_NOTIFICATION_ID)
        } catch (_: Exception) {
        }
      }
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

    fun setWorkspace(hostId: String, label: String) {
      val service = running ?: return
      if (hostId != service.connectedHostId) return
      service.workspaceLabel = label.lineSequence().firstOrNull()?.trim()?.take(100).orEmpty()
      service.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, service.notification())
    }

    fun setStatus(status: String, hostName: String, hostId: String) {
      if (status !in setOf("connecting", "connected", "reconnecting")) return
      val service = running ?: return
      if (hostId != service.connectedHostId) service.workspaceLabel = ""
      service.connectedHostId = hostId
      service.connectedHostName = hostName.lineSequence().firstOrNull()?.trim()?.take(100).orEmpty()
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
