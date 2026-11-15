package io.github.liguobao.dshremote

import android.app.Activity
import android.view.View
import android.view.ViewTreeObserver
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference
import kotlin.math.abs

class RemoteKeyboardInsetsModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context), LifecycleEventListener {

  companion object {
    const val MODULE_NAME = "DshRemoteKeyboardInsets"
    const val EVENT_NAME = "remoteKeyboardInsetsChanged"
  }

  private var attachedDecorRef: WeakReference<View>? = null
  private var attachedActivityRef: WeakReference<Activity>? = null
  private var globalLayoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null
  private var imeAnimating = false
  private var lastEmittedDp = -1.0
  private var lastEmittedImeVisible = false
  private var listenerCount = 0

  init {
    context.addLifecycleEventListener(this)
  }

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun addListener(eventName: String) {
    listenerCount += 1
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    listenerCount = maxOf(0, listenerCount - count)
  }

  @ReactMethod
  fun startObserving(promise: Promise) {
    context.runOnUiQueueThread {
      attachToCurrentActivity()
      val state = currentInsetPair()
      if (state != null) {
        lastEmittedDp = state.first
        lastEmittedImeVisible = state.second
        val map = Arguments.createMap().apply {
          putDouble("paddingBottom", state.first)
          putBoolean("imeVisible", state.second)
        }
        promise.resolve(map)
      } else {
        promise.resolve(null)
      }
    }
  }

  override fun onHostResume() {
    context.runOnUiQueueThread {
      attachToCurrentActivity()
      val state = currentInsetPair()
      if (state != null) {
        emitIfChanged(state.first, state.second)
      }
    }
  }

  override fun onHostPause() = Unit

  override fun onHostDestroy() {
    context.runOnUiQueueThread {
      detachFromView()
    }
  }

  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    context.runOnUiQueueThread {
      detachFromView()
    }
    super.invalidate()
  }

  private fun detachFromView() {
    val previousView = attachedDecorRef?.get()
    if (previousView != null) {
      ViewCompat.setWindowInsetsAnimationCallback(previousView, null)
      globalLayoutListener?.let { listener ->
        if (previousView.viewTreeObserver.isAlive) {
          previousView.viewTreeObserver.removeOnGlobalLayoutListener(listener)
        }
      }
    }
    attachedDecorRef = null
    attachedActivityRef = null
    globalLayoutListener = null
    imeAnimating = false
  }

  private fun attachToCurrentActivity() {
    val activity = context.currentActivity ?: return
    val decorView = activity.window?.decorView ?: return
    if (attachedDecorRef?.get() === decorView && attachedActivityRef?.get() === activity) {
      return
    }
    detachFromView()
    attachedDecorRef = WeakReference(decorView)
    attachedActivityRef = WeakReference(activity)

    ViewCompat.setWindowInsetsAnimationCallback(
      decorView,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onPrepare(animation: WindowInsetsAnimationCompat) {
          if ((animation.typeMask and WindowInsetsCompat.Type.ime()) != 0) {
            imeAnimating = true
          }
        }

        override fun onStart(
          animation: WindowInsetsAnimationCompat,
          bounds: WindowInsetsAnimationCompat.BoundsCompat,
        ): WindowInsetsAnimationCompat.BoundsCompat {
          if ((animation.typeMask and WindowInsetsCompat.Type.ime()) != 0) {
            imeAnimating = true
          }
          return bounds
        }

        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          val hasImeAnim = runningAnimations.any { (it.typeMask and WindowInsetsCompat.Type.ime()) != 0 }
          if (hasImeAnim) {
            val (dp, visible) = computeState(activity, decorView, insets)
            emitIfChanged(dp, visible)
          }
          return insets
        }

        override fun onEnd(animation: WindowInsetsAnimationCompat) {
          if ((animation.typeMask and WindowInsetsCompat.Type.ime()) != 0) {
            imeAnimating = false
            val rootInsets = ViewCompat.getRootWindowInsets(decorView) ?: return
            val (dp, visible) = computeState(activity, decorView, rootInsets)
            emitIfChanged(dp, visible)
          }
        }
      },
    )

    val layoutListener = ViewTreeObserver.OnGlobalLayoutListener {
      if (imeAnimating) return@OnGlobalLayoutListener
      val rootInsets = ViewCompat.getRootWindowInsets(decorView) ?: return@OnGlobalLayoutListener
      val (dp, visible) = computeState(activity, decorView, rootInsets)
      emitIfChanged(dp, visible)
    }
    globalLayoutListener = layoutListener
    decorView.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
  }

  private fun currentInsetPair(): Pair<Double, Boolean>? {
    val activity = attachedActivityRef?.get() ?: context.currentActivity ?: return null
    val decorView = attachedDecorRef?.get() ?: activity.window?.decorView ?: return null
    val rootInsets = ViewCompat.getRootWindowInsets(decorView) ?: return null
    return computeState(activity, decorView, rootInsets)
  }

  private fun computeState(activity: Activity, decorView: View, insets: WindowInsetsCompat): Pair<Double, Boolean> {
    val density = decorView.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
    val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    val navBottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
    val targetBottomPx = maxOf(imeBottom, navBottom)
    val content = activity.findViewById<View>(android.R.id.content)
    val clearedPx = if (content != null && decorView.height > 0 && content.height > 0) {
      val loc = IntArray(2)
      content.getLocationInWindow(loc)
      maxOf(0, decorView.height - (loc[1] + content.height))
    } else {
      0
    }
    val paddingDp = maxOf(0, targetBottomPx - clearedPx).toDouble() / density.toDouble()
    return paddingDp to (imeBottom > navBottom)
  }

  private fun emitIfChanged(paddingDp: Double, imeVisible: Boolean) {
    if (lastEmittedDp >= 0.0 && abs(paddingDp - lastEmittedDp) < 0.25 && imeVisible == lastEmittedImeVisible) {
      return
    }
    lastEmittedDp = paddingDp
    lastEmittedImeVisible = imeVisible
    if (!context.hasActiveReactInstance() || listenerCount <= 0) return
    val payload = Arguments.createMap().apply {
      putDouble("paddingBottom", paddingDp)
      putBoolean("imeVisible", imeVisible)
    }
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_NAME, payload)
  }
}
