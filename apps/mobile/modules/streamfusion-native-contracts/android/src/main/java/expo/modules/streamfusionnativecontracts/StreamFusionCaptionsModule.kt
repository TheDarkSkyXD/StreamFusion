package expo.modules.streamfusionnativecontracts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StreamFusionCaptionsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StreamFusionCaptions")
    Function("getContractVersion") { 1 }
    AsyncFunction("installEnglishModel") { _: Map<String, Any> -> unsupported("The English caption model") }
    AsyncFunction("startFocusedCaptionSession") { _: Map<String, Any> -> unsupported("Focused captions") }
    AsyncFunction("stopFocusedCaptionSession") { _: String -> unsupported("Focused captions") }
    AsyncFunction("removeEnglishModel") { _: Map<String, Any> -> unsupported("The English caption model") }
  }

  private fun unsupported(operation: String) = mapOf(
    "code" to "NATIVE_OPERATION_UNSUPPORTED",
    "diagnostic" to "$operation is not implemented in this development build.",
    "kind" to "unsupported",
  )
}
