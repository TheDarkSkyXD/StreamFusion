package expo.modules.streamfusionnativecontracts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StreamFusionCaptionsModule : Module() {
  private var sessions: CaptionSessionOwner? = null
  private var store: CaptionModelStore? = null

  override fun definition() = ModuleDefinition {
    Name("StreamFusionCaptions")
    Events("onNativeCaptions")
    Function("getContractVersion") { 2 }
    OnCreate {
      val filesDir = requireNotNull(appContext.reactContext?.filesDir) {
        "Caption model storage requires an application files directory."
      }
      val modelStore = CaptionModelStore(filesDir)
      store = modelStore
      sessions = CaptionSessionOwner(modelStore) { event ->
        sendEvent("onNativeCaptions", event)
      }
    }
    AsyncFunction("getEnglishModelState") {
      mapOf("kind" to "completed", "value" to store().snapshot())
    }
    AsyncFunction("installEnglishModel") { request: Map<String, Any> ->
      if (request["modelId"] != CaptionCatalog.MODEL_ID) {
        return@AsyncFunction mapOf("kind" to "invalid")
      }
      mapOf("kind" to "completed", "value" to store().install(request["sourceUri"] as? String))
    }
    AsyncFunction("removeEnglishModel") { request: Map<String, Any> ->
      if (request["modelId"] != CaptionCatalog.MODEL_ID) {
        return@AsyncFunction mapOf("kind" to "invalid")
      }
      sessions()?.stop("captions-removed")
      mapOf("kind" to "completed", "value" to store().remove())
    }
    AsyncFunction("startFocusedCaptionSession") { request: Map<String, Any> ->
      sessions().start(request)
    }
    AsyncFunction("stopFocusedCaptionSession") { sessionId: String ->
      sessions().stop(sessionId)
    }
    AsyncFunction("getCaptionProof") {
      mapOf("kind" to "completed", "value" to sessions().proof())
    }
    AsyncFunction("queueDevelopmentCaptionConstraint") {
      store().queueConstraint()
      mapOf("kind" to "completed", "value" to store().snapshot())
    }
    AsyncFunction("clearDevelopmentCaptionConstraint") {
      store().clearConstraint()
      mapOf("kind" to "completed", "value" to store().snapshot())
    }
  }

  private fun store(): CaptionModelStore = requireNotNull(store)
  private fun sessions(): CaptionSessionOwner = requireNotNull(sessions)
}
