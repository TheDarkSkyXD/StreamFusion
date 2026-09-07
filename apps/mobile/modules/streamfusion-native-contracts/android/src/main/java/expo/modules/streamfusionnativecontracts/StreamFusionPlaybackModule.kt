package expo.modules.streamfusionnativecontracts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StreamFusionPlaybackModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StreamFusionPlayback")
    Function("getContractVersion") { 1 }
    AsyncFunction("startFocusedSession") { _: Map<String, Any> -> unsupported("Focused playback sessions") }
    AsyncFunction("enterPictureInPicture") { _: String -> unsupported("Picture in Picture") }
    AsyncFunction("endFocusedSession") { _: String -> unsupported("Focused playback sessions") }
  }

  private fun unsupported(operation: String) = mapOf(
    "code" to "NATIVE_OPERATION_UNSUPPORTED",
    "diagnostic" to "$operation is not implemented in this development build.",
    "kind" to "unsupported",
  )
}
