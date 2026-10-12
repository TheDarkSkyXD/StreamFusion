package expo.modules.streamfusionnativecontracts

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.annotations.ReactProp

class StreamFusionPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(
    StreamFusionPlaybackModule(context),
    StreamFusionMediaJobsModule(context),
    StreamFusionCaptionsModule(context),
    StreamFusionDiagnosticsModule(context),
    StreamFusionMaintenanceModule(context),
    StreamFusionConnectivityModule(context),
    StreamFusionUpdaterModule(context),
    StreamFusionStorageModule(context),
    StreamFusionPlatformModule(context),
    StreamFusionNotificationsModule(context),
  )

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(StreamFusionPlaybackViewManager(), StreamFusionEmoteViewManager())
}

class StreamFusionPlaybackViewManager : SimpleViewManager<StreamFusionPlaybackView>() {
  override fun getName() = "StreamFusionPlayback"

  override fun createViewInstance(context: ThemedReactContext) = StreamFusionPlaybackView(context)

  @ReactProp(name = "sessionId")
  fun setSessionId(view: StreamFusionPlaybackView, sessionId: String?) {
    view.setSessionId(sessionId)
  }
}
