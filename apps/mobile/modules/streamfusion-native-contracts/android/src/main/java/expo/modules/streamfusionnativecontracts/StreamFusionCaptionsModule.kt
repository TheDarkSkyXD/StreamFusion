package expo.modules.streamfusionnativecontracts

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap

class StreamFusionCaptionsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val store = CaptionModelStore(context.filesDir)
  private val sessions = CaptionSessionOwner(context, store) { event ->
    NativeBridge.emit(context, "onNativeCaptions", event)
  }

  override fun getName() = "StreamFusionCaptions"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getContractVersion() = 4

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun cancelEnglishModelInstall(): WritableMap =
    com.facebook.react.bridge.Arguments.makeNativeMap(
      mapOf("kind" to "completed", "value" to store.cancelInstall()),
    )

  @ReactMethod fun getEnglishModelState(promise: Promise) = NativeBridge.async(promise) {
    mapOf("kind" to "completed", "value" to store.snapshot())
  }

  @ReactMethod fun installEnglishModel(request: ReadableMap, promise: Promise) = NativeBridge.async(promise) {
    val params = NativeBridge.nonNullMap(request)
    if (params["modelId"] != CaptionCatalog.MODEL_ID) {
      mapOf("kind" to "invalid")
    } else {
      sessions.stopAll()
      mapOf("kind" to "completed", "value" to store.install(params["sourceUri"] as? String) { progress ->
        NativeBridge.emit(context, "onNativeCaptionModel", progress)
      })
    }
  }

  @ReactMethod fun removeEnglishModel(request: ReadableMap, promise: Promise) = NativeBridge.async(promise) {
    if (request.getString("modelId") != CaptionCatalog.MODEL_ID) {
      mapOf("kind" to "invalid")
    } else {
      sessions.stopAll()
      mapOf("kind" to "completed", "value" to store.remove())
    }
  }

  @ReactMethod fun startFocusedCaptionSession(request: ReadableMap, promise: Promise) = NativeBridge.async(promise) {
    sessions.start(NativeBridge.nonNullMap(request))
  }

  @ReactMethod fun stopFocusedCaptionSession(sessionId: String, promise: Promise) = NativeBridge.async(promise) {
    sessions.stop(sessionId)
  }

  @ReactMethod fun getCaptionProof(promise: Promise) = NativeBridge.async(promise) {
    mapOf("kind" to "completed", "value" to sessions.proof())
  }

  @ReactMethod fun queueDevelopmentCaptionConstraint(promise: Promise) = NativeBridge.async(promise) {
    store.queueConstraint()
    sessions.stopAll()
    mapOf("kind" to "completed", "value" to store.snapshot())
  }

  @ReactMethod fun clearDevelopmentCaptionConstraint(promise: Promise) = NativeBridge.async(promise) {
    store.clearConstraint()
    mapOf("kind" to "completed", "value" to store.snapshot())
  }

  override fun invalidate() {
    store.cancelInstall()
    sessions.dispose()
    super.invalidate()
  }
}
