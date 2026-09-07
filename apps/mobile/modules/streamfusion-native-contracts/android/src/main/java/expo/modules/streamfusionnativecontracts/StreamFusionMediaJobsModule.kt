package expo.modules.streamfusionnativecontracts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StreamFusionMediaJobsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StreamFusionMediaJobs")
    Function("getContractVersion") { 1 }
    AsyncFunction("startRecoverableJob") { _: Map<String, Any> -> unsupported("Recoverable Media Jobs") }
    AsyncFunction("recoverJobs") { unsupported("Media Job recovery") }
    AsyncFunction("cancelRecoverableJob") { _: String -> unsupported("Recoverable Media Jobs") }
  }

  private fun unsupported(operation: String) = mapOf(
    "code" to "NATIVE_OPERATION_UNSUPPORTED",
    "diagnostic" to "$operation is not implemented in this development build.",
    "kind" to "unsupported",
  )
}
