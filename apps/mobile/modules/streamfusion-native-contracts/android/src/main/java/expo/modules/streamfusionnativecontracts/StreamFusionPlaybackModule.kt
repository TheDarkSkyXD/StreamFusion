package expo.modules.streamfusionnativecontracts

import android.app.Activity
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class StreamFusionPlaybackModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {
  init {
    context.addLifecycleEventListener(this)
    FocusedPlaybackSessionOwner.attachEmitter { event ->
      NativeBridge.emit(context, "onNativePlayback", event)
    }
    FocusedPlaybackSessionOwner.rememberActivity(context.currentActivity)
  }

  override fun getName() = "StreamFusionPlayback"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getContractVersion() = 6

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit

  override fun onHostResume() {
    val activity = context.currentActivity
    FocusedPlaybackSessionOwner.rememberActivity(activity)
    FocusedPlaybackSessionOwner.onForeground(activity)
  }

  override fun onHostPause() = FocusedPlaybackSessionOwner.pauseForBackground()
  override fun onHostDestroy() = Unit

  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    FocusedPlaybackSessionOwner.release()
    super.invalidate()
  }

  @ReactMethod fun startFocusedSession(request: ReadableMap, promise: Promise) = NativeBridge.onMain(promise) {
    val activity = context.currentActivity
    FocusedPlaybackSessionOwner.rememberActivity(activity)
    FocusedPlaybackSessionOwner.start(activity ?: context, NativeBridge.nonNullMap(request))
  }

  @ReactMethod fun endFocusedSession(sessionId: String, promise: Promise) = NativeBridge.onMain(promise) {
    FocusedPlaybackSessionOwner.end(sessionId)
  }

  @ReactMethod fun recoverSource(request: ReadableMap, promise: Promise) = NativeBridge.onMain(promise) {
    FocusedPlaybackSessionOwner.recoverSource(NativeBridge.nonNullMap(request))
  }

  @ReactMethod fun setPlaying(sessionId: String, playing: Boolean, promise: Promise) = NativeBridge.onMain(promise) {
    FocusedPlaybackSessionOwner.setPlaying(sessionId, playing)
  }

  @ReactMethod fun setMuted(sessionId: String, muted: Boolean, promise: Promise) = NativeBridge.onMain(promise) {
    FocusedPlaybackSessionOwner.setMuted(sessionId, muted)
  }

  @ReactMethod fun readPlaybackObservation(sessionId: String, promise: Promise) = NativeBridge.onMain(promise) {
    FocusedPlaybackSessionOwner.readObservation(sessionId)
  }

  @ReactMethod fun setPlaybackSpeed(sessionId: String, speed: Double, promise: Promise) = NativeBridge.onMain(promise) {
    FocusedPlaybackSessionOwner.setSpeed(sessionId, speed.toFloat())
  }

  @ReactMethod fun setVolume(sessionId: String, volume: Double, promise: Promise) = NativeBridge.onMain(promise) {
    FocusedPlaybackSessionOwner.setVolume(sessionId, volume.toFloat())
  }

  @ReactMethod fun listQualities(sessionId: String, promise: Promise) = NativeBridge.onMain(promise) {
    FocusedPlaybackSessionOwner.listQualities(sessionId)
  }

  @ReactMethod fun setQuality(sessionId: String, quality: String, promise: Promise) = NativeBridge.onMain(promise) {
    FocusedPlaybackSessionOwner.setQuality(sessionId, quality)
  }

  @ReactMethod fun seekTo(sessionId: String, positionMs: Double, promise: Promise) = NativeBridge.onMain(promise) {
    FocusedPlaybackSessionOwner.seekTo(sessionId, positionMs)
  }

  @ReactMethod fun enterPictureInPicture(sessionId: String, promise: Promise) = NativeBridge.onMain(promise) {
    val activity = context.currentActivity
    FocusedPlaybackSessionOwner.rememberActivity(activity)
    FocusedPlaybackSessionOwner.enterPictureInPicture(activity, sessionId)
  }

  companion object {
    fun onUserLeavesActivity(activity: Activity?) {
      FocusedPlaybackSessionOwner.onUserLeavesActivity(activity)
    }
  }
}
