package expo.modules.streamfusionnativecontracts

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StreamFusionPlaybackModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StreamFusionPlayback")
    Events("onNativePlayback")
    Function("getContractVersion") { 2 }
    OnCreate {
      FocusedPlaybackSessionOwner.attachEmitter { event ->
        sendEvent("onNativePlayback", event)
      }
      FocusedPlaybackSessionOwner.rememberActivity(appContext.currentActivity)
    }
    OnDestroy {
      FocusedPlaybackSessionOwner.release()
    }
    OnActivityEntersBackground {
      FocusedPlaybackSessionOwner.pauseForBackground()
    }
    OnActivityEntersForeground {
      val activity = appContext.currentActivity
      FocusedPlaybackSessionOwner.rememberActivity(activity)
      FocusedPlaybackSessionOwner.onForeground(activity)
    }
    AsyncFunction("startFocusedSession") { request: Map<String, Any> ->
      val activity = appContext.currentActivity
      FocusedPlaybackSessionOwner.rememberActivity(activity)
      val context = requireNotNull(activity ?: appContext.reactContext) {
        "Focused playback requires a React application context."
      }
      FocusedPlaybackSessionOwner.start(context, request)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("endFocusedSession") { sessionId: String ->
      FocusedPlaybackSessionOwner.end(sessionId)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setPlaying") { sessionId: String, playing: Boolean ->
      FocusedPlaybackSessionOwner.setPlaying(sessionId, playing)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setMuted") { sessionId: String, muted: Boolean ->
      FocusedPlaybackSessionOwner.setMuted(sessionId, muted)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setVolume") { sessionId: String, volume: Double ->
      FocusedPlaybackSessionOwner.setVolume(sessionId, volume.toFloat())
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("listQualities") { sessionId: String ->
      FocusedPlaybackSessionOwner.listQualities(sessionId)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setQuality") { sessionId: String, quality: String ->
      FocusedPlaybackSessionOwner.setQuality(sessionId, quality)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("enterPictureInPicture") { sessionId: String ->
      val activity = appContext.currentActivity
      FocusedPlaybackSessionOwner.rememberActivity(activity)
      FocusedPlaybackSessionOwner.enterPictureInPicture(activity, sessionId)
    }.runOnQueue(Queues.MAIN)
    View(StreamFusionPlaybackView::class) {
      Prop("sessionId") { view: StreamFusionPlaybackView, sessionId: String? ->
        view.setSessionId(sessionId)
      }
    }
  }
}
