package expo.modules.streamfusionnativecontracts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StreamFusionDiagnosticsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StreamFusionDiagnostics")
    Function("getContractVersion") { 1 }
    AsyncFunction("readResourceSnapshot") { unsupported("Android resource diagnostics") }
  }

  private fun unsupported(operation: String) = mapOf(
    "code" to "NATIVE_OPERATION_UNSUPPORTED",
    "diagnostic" to "$operation is not implemented in this development build.",
    "kind" to "unsupported",
  )
}
