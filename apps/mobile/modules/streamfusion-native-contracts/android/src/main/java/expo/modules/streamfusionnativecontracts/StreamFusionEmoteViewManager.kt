package expo.modules.streamfusionnativecontracts

import android.net.Uri
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.drawee.drawable.ScalingUtils
import com.facebook.drawee.view.SimpleDraweeView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class StreamFusionEmoteView(context: ThemedReactContext) : SimpleDraweeView(context) {
  var uri: String? = null
  var animated = true

  init { hierarchy.actualImageScaleType = ScalingUtils.ScaleType.FIT_CENTER }

  fun refreshController() {
    controller?.animatable?.stop()
    controller = uri?.let {
      Fresco.newDraweeControllerBuilder()
        .setUri(Uri.parse(it))
        .setAutoPlayAnimations(animated)
        .setOldController(controller)
        .build()
    }
  }
}

class StreamFusionEmoteViewManager : SimpleViewManager<StreamFusionEmoteView>() {
  override fun getName() = "StreamFusionEmoteImage"
  override fun createViewInstance(context: ThemedReactContext) = StreamFusionEmoteView(context)
  @ReactProp(name = "uri")
  fun setUri(view: StreamFusionEmoteView, uri: String?) {
    if (view.uri == uri) return
    view.uri = uri
    view.refreshController()
  }
  @ReactProp(name = "animated", defaultBoolean = true)
  fun setAnimated(view: StreamFusionEmoteView, animated: Boolean) {
    if (view.animated == animated) return
    view.animated = animated
    view.refreshController()
  }
  override fun onDropViewInstance(view: StreamFusionEmoteView) {
    view.controller?.animatable?.stop()
    view.controller = null
    super.onDropViewInstance(view)
  }
}
