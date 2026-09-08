package expo.modules.streamfusionnativecontracts

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaCodecList
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

class StreamFusionDiagnosticsModule : Module() {
  private val developmentResourceSnapshotFailureQueued = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("StreamFusionDiagnostics")
    Function("getContractVersion") { 3 }
    AsyncFunction("queueDevelopmentResourceSnapshotFailure") {
      if (!BuildConfig.DEBUG) {
        mapOf(
          "code" to "NATIVE_OPERATION_UNSUPPORTED",
          "diagnostic" to "Development diagnostics failure proof is unavailable in release builds.",
          "kind" to "unsupported",
        )
      } else {
        developmentResourceSnapshotFailureQueued.set(true)
        mapOf("kind" to "completed", "value" to mapOf("queued" to true))
      }
    }
    AsyncFunction("readResourceSnapshot") { readResourceSnapshot() }
  }

  private fun readResourceSnapshot(): Map<String, Any> {
    if (developmentResourceSnapshotFailureQueued.compareAndSet(true, false)) {
      throw IllegalStateException("Development resource snapshot failure proof consumed its queued failure.")
    }
    val context = requireNotNull(appContext.reactContext) {
      "Android resource diagnostics requires a React application context."
    }
    val activityManager = requireNotNull(
      context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager,
    ) { "Android resource diagnostics requires ActivityManager." }
    val powerManager = requireNotNull(
      context.getSystemService(Context.POWER_SERVICE) as? PowerManager,
    ) { "Android resource diagnostics requires PowerManager." }
    val memoryInfo = ActivityManager.MemoryInfo()
    activityManager.getMemoryInfo(memoryInfo)
    val runtime = Runtime.getRuntime()
    val storage = StatFs(context.filesDir.absolutePath)
    val environment = executionEnvironment()
    return mapOf(
      "kind" to "completed",
      "value" to mapOf(
        "decoders" to MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos
          .asSequence()
          .filter { !it.isEncoder }
          .sortedBy { it.name }
          .map {
            mapOf(
              "hardwareAccelerated" to it.isHardwareAccelerated,
              "mimeTypes" to it.supportedTypes.sorted(),
              "name" to it.name,
              "softwareOnly" to it.isSoftwareOnly,
            )
          }
          .toList(),
        "memory" to mapOf(
          "availableBytes" to memoryInfo.availMem,
          "lowMemory" to memoryInfo.lowMemory,
          "runtimeFreeBytes" to runtime.freeMemory(),
          "runtimeMaxBytes" to runtime.maxMemory(),
          "runtimeTotalBytes" to runtime.totalMemory(),
          "thresholdBytes" to memoryInfo.threshold,
          "totalBytes" to memoryInfo.totalMem,
        ),
        "observedAtEpochMs" to System.currentTimeMillis(),
        "runtime" to mapOf(
          "apiLevel" to Build.VERSION.SDK_INT,
          "applicationId" to context.packageName,
          "executionEnvironment" to environment,
          "formFactor" to mapOf(
            "automotive" to context.packageManager.hasSystemFeature(
              PackageManager.FEATURE_AUTOMOTIVE,
            ),
            "pc" to context.packageManager.hasSystemFeature(
              PackageManager.FEATURE_PC,
            ),
            "touchscreen" to context.packageManager.hasSystemFeature(
              PackageManager.FEATURE_TOUCHSCREEN,
            ),
            "television" to context.packageManager.hasSystemFeature(
              PackageManager.FEATURE_TELEVISION,
            ),
            "uiModeType" to (context.resources.configuration.uiMode and 0x0f),
            "watch" to context.packageManager.hasSystemFeature(
              PackageManager.FEATURE_WATCH,
            ),
          ),
          "supportedAbis" to Build.SUPPORTED_ABIS.toList(),
          "versionCode" to versionCode(context),
        ),
        "storage" to mapOf(
          "availableBytes" to storage.availableBytes,
          "totalBytes" to storage.totalBytes,
        ),
        "thermal" to thermalObservation(powerManager.currentThermalStatus),
      ),
    )
  }

  private fun versionCode(context: Context): Long {
    val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
    return packageInfo.longVersionCode
  }

  private fun executionEnvironment(): String = when {
    Build.FINGERPRINT.startsWith("generic") ||
      Build.FINGERPRINT.startsWith("unknown") ||
      Build.HARDWARE.contains("goldfish", ignoreCase = true) ||
      Build.HARDWARE.contains("ranchu", ignoreCase = true) ||
      Build.MODEL.contains("Emulator", ignoreCase = true) -> "emulator"
    Build.SUPPORTED_ABIS.contains("arm64-v8a") -> "physical"
    else -> "unknown"
  }

  private fun thermalObservation(status: Int): Map<String, String> {
    val state = when (status) {
      PowerManager.THERMAL_STATUS_NONE -> "none"
      PowerManager.THERMAL_STATUS_LIGHT -> "light"
      PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
      PowerManager.THERMAL_STATUS_SEVERE -> "severe"
      PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
      PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
      PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
      else -> null
    }
    return if (state == null) {
      mapOf(
        "detail" to "Android reported an unrecognized thermal status.",
        "kind" to "unavailable",
      )
    } else {
      mapOf("kind" to "observed", "state" to state)
    }
  }
}
