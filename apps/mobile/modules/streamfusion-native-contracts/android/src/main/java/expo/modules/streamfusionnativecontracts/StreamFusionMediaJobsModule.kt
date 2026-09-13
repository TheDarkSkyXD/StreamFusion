package expo.modules.streamfusionnativecontracts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StreamFusionMediaJobsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StreamFusionMediaJobs")
    Function("getContractVersion") { 2 }
    AsyncFunction("startRecoverableJob") { request: Map<String, Any> ->
      engine().start(
        request["jobId"] as String,
        request["kind"] as String,
        request["sourceUri"] as String,
      )
    }
    AsyncFunction("recoverJobs") {
      mapOf("kind" to "completed", "value" to engine().recover())
    }
    AsyncFunction("cancelRecoverableJob") { jobId: String -> engine().cancel(jobId) }
    AsyncFunction("pauseRecoverableJob") { jobId: String -> engine().pause(jobId) }
    AsyncFunction("resumeRecoverableJob") { jobId: String -> engine().resume(jobId) }
    AsyncFunction("retryRecoverableJob") { jobId: String -> engine().retry(jobId) }
    AsyncFunction("finalizeRecoverableJob") { jobId: String -> engine().finalize(jobId) }
    AsyncFunction("getRecoverableJob") { jobId: String -> engine().get(jobId) }
  }

  private fun engine(): MediaJobEngine {
    val context = requireNotNull(appContext.reactContext) {
      "Media Jobs requires a React application context."
    }
    return MediaJobEngine.get(context)
  }
}
