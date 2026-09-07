package expo.modules.streamfusionnativecontracts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StreamFusionMaintenanceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StreamFusionMaintenance")
    Function("getContractVersion") { 1 }
    AsyncFunction("verifyDownloadedApk") { _: Map<String, Any> -> unsupported("Downloaded APK verification") }
    AsyncFunction("handoffVerifiedApk") { _: Map<String, Any> -> unsupported("Android APK installation handoff") }
  }

  private fun unsupported(operation: String) = mapOf(
    "code" to "NATIVE_OPERATION_UNSUPPORTED",
    "diagnostic" to "$operation is not implemented in this development build.",
    "kind" to "unsupported",
  )
}
