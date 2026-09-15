package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StreamFusionMediaJobsModule : Module() {
  private var exportPromise: Promise? = null
  private var exportJobId: String? = null

  override fun definition() = ModuleDefinition {
    Name("StreamFusionMediaJobs")
    Function("getContractVersion") { 3 }
    AsyncFunction("startRecoverableJob") { request: Map<String, Any> ->
      val headers = stringMap(request["requestHeaders"])
      engine().start(
        request["jobId"] as String,
        request["kind"] as String,
        request["sourceUri"] as String,
        headers,
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
    AsyncFunction("deleteRecoverableJob") { jobId: String -> engine().delete(jobId) }
    AsyncFunction("openRecoverableJob") { jobId: String -> engine().open(jobId) }
    AsyncFunction("hashRecoverableJob") { jobId: String -> engine().artifactSha256(jobId) }
    AsyncFunction("exportRecoverableJob") { jobId: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(
          mapOf(
            "kind" to "completed",
            "value" to mapOf("kind" to "unavailable", "jobId" to jobId),
          ),
        )
        return@AsyncFunction
      }
      exportPromise?.resolve(
        mapOf("kind" to "completed", "value" to mapOf("kind" to "cancelled")),
      )
      exportPromise = promise
      exportJobId = jobId
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "application/octet-stream"
        putExtra(Intent.EXTRA_TITLE, "$jobId.bin")
      }
      activity.startActivityForResult(intent, EXPORT_REQUEST)
    }
    OnActivityResult { _, payload ->
      if (payload.requestCode != EXPORT_REQUEST) return@OnActivityResult
      val promise = exportPromise ?: return@OnActivityResult
      val jobId = exportJobId
      exportPromise = null
      exportJobId = null
      if (payload.resultCode != Activity.RESULT_OK || jobId == null) {
        promise.resolve(mapOf("kind" to "completed", "value" to mapOf("kind" to "cancelled")))
        return@OnActivityResult
      }
      val uri = payload.data?.data
      if (uri == null) {
        promise.resolve(mapOf("kind" to "completed", "value" to mapOf("kind" to "cancelled")))
        return@OnActivityResult
      }
      promise.resolve(engine().exportTo(jobId, uri as Uri))
    }
  }

  private fun engine(): MediaJobEngine {
    val context = requireNotNull(appContext.reactContext) {
      "Media Jobs requires a React application context."
    }
    return MediaJobEngine.get(context)
  }

  private fun stringMap(value: Any?): Map<String, String> {
    val record = value as? Map<*, *> ?: return emptyMap()
    return record.entries.mapNotNull { entry ->
      val key = entry.key as? String ?: return@mapNotNull null
      val mapped = entry.value as? String ?: return@mapNotNull null
      key to mapped
    }.toMap()
  }

  companion object {
    private const val EXPORT_REQUEST = 7142
  }
}
