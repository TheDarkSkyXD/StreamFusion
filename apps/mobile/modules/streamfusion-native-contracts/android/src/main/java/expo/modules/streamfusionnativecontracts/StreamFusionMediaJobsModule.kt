package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil

class StreamFusionMediaJobsModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), ActivityEventListener {
  private var exportPromise: Promise? = null
  private var exportJobId: String? = null

  init { context.addActivityEventListener(this) }

  override fun getName() = "StreamFusionMediaJobs"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getContractVersion() = 3

  @ReactMethod fun startRecoverableJob(request: ReadableMap, promise: Promise) = NativeBridge.async(promise) {
    val values = NativeBridge.nonNullMap(request)
    engine().start(
      values["jobId"] as String,
      values["kind"] as String,
      values["sourceUri"] as String,
      stringMap(values["requestHeaders"]),
    )
  }

  @ReactMethod fun recoverJobs(promise: Promise) = NativeBridge.async(promise) {
    mapOf("kind" to "completed", "value" to engine().recover())
  }

  @ReactMethod fun cancelRecoverableJob(jobId: String, promise: Promise) = NativeBridge.async(promise) { engine().cancel(jobId) }
  @ReactMethod fun pauseRecoverableJob(jobId: String, promise: Promise) = NativeBridge.async(promise) { engine().pause(jobId) }
  @ReactMethod fun resumeRecoverableJob(jobId: String, promise: Promise) = NativeBridge.async(promise) { engine().resume(jobId) }
  @ReactMethod fun retryRecoverableJob(jobId: String, promise: Promise) = NativeBridge.async(promise) { engine().retry(jobId) }
  @ReactMethod fun finalizeRecoverableJob(jobId: String, promise: Promise) = NativeBridge.async(promise) { engine().finalize(jobId) }
  @ReactMethod fun getRecoverableJob(jobId: String, promise: Promise) = NativeBridge.async(promise) { engine().get(jobId) }
  @ReactMethod fun deleteRecoverableJob(jobId: String, promise: Promise) = NativeBridge.async(promise) { engine().delete(jobId) }
  @ReactMethod fun openRecoverableJob(jobId: String, promise: Promise) = NativeBridge.async(promise) { engine().open(jobId) }
  @ReactMethod fun hashRecoverableJob(jobId: String, promise: Promise) = NativeBridge.async(promise) { engine().artifactSha256(jobId) }

  @ReactMethod fun exportRecoverableJob(jobId: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val activity = context.currentActivity
        if (activity == null) {
          NativeBridge.resolve(promise, mapOf("kind" to "completed", "value" to mapOf("kind" to "unavailable", "jobId" to jobId)))
          return@runOnUiThread
        }
        exportPromise?.let { NativeBridge.resolve(it, mapOf("kind" to "completed", "value" to mapOf("kind" to "cancelled"))) }
        exportPromise = promise
        exportJobId = jobId
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "application/octet-stream"
          putExtra(Intent.EXTRA_TITLE, "$jobId.bin")
        }
        activity.startActivityForResult(intent, EXPORT_REQUEST)
      } catch (error: Exception) {
        exportPromise = null
        exportJobId = null
        promise.reject("NATIVE_OPERATION_FAILED", error)
      }
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != EXPORT_REQUEST) return
    val promise = exportPromise ?: return
    val jobId = exportJobId
    exportPromise = null
    exportJobId = null
    if (resultCode != Activity.RESULT_OK || jobId == null || data?.data == null) {
      NativeBridge.resolve(promise, mapOf("kind" to "completed", "value" to mapOf("kind" to "cancelled")))
    } else {
      NativeBridge.async(promise) { engine().exportTo(jobId, data.data!!) }
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  override fun invalidate() {
    context.removeActivityEventListener(this)
    exportPromise?.let { NativeBridge.resolve(it, mapOf("kind" to "completed", "value" to mapOf("kind" to "cancelled"))) }
    exportPromise = null
    exportJobId = null
    super.invalidate()
  }

  private fun engine(): MediaJobEngine = MediaJobEngine.get(context)

  private fun stringMap(value: Any?): Map<String, String> {
    val record = value as? Map<*, *> ?: return emptyMap()
    return record.entries.mapNotNull { entry ->
      val key = entry.key as? String ?: return@mapNotNull null
      val mapped = entry.value as? String ?: return@mapNotNull null
      key to mapped
    }.toMap()
  }

  companion object { private const val EXPORT_REQUEST = 7142 }
}
