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
    }
    OnDestroy {
      FocusedPlaybackSessionOwner.release()
    }
    OnActivityEntersBackground {
      FocusedPlaybackSessionOwner.pauseForBackground()
    }
    AsyncFunction("startFocusedSession") { request: Map<String, Any> ->
      val context = requireNotNull(appContext.reactContext) {
        "Focused playback requires a React application context."
      }
      FocusedPlaybackSessionOwner.start(context, request)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("endFocusedSession") { sessionId: String ->
      FocusedPlaybackSessionOwner.end(sessionId)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("enterPictureInPicture") { _: String ->
      unsupported("Picture in Picture")
    }
    View(StreamFusionPlaybackView::class) {
      Prop("sessionId") { view: StreamFusionPlaybackView, sessionId: String? ->
        view.setSessionId(sessionId)
      }
    }
  }

  private fun unsupported(operation: String) = mapOf(
    "code" to "NATIVE_OPERATION_UNSUPPORTED",
    "diagnostic" to "$operation is not implemented in this development build.",
    "kind" to "unsupported",
  )
}
