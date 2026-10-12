package expo.modules.streamfusionnativecontracts

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class StreamFusionMaintenanceModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "StreamFusionMaintenance"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getContractVersion() = 1

  @ReactMethod fun verifyDownloadedApk(request: ReadableMap, promise: Promise) =
    NativeBridge.resolve(promise, unsupported("Downloaded APK verification"))

  @ReactMethod fun handoffVerifiedApk(request: ReadableMap, promise: Promise) =
    NativeBridge.resolve(promise, unsupported("Android APK installation handoff"))

  private fun unsupported(operation: String) = mapOf(
    "code" to "NATIVE_OPERATION_UNSUPPORTED",
    "diagnostic" to "$operation is not implemented in this development build.",
    "kind" to "unsupported",
  )
}
