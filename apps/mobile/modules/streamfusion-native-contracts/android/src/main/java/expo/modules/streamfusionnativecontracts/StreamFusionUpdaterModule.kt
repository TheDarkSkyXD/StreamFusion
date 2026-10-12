package expo.modules.streamfusionnativecontracts

import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class StreamFusionUpdaterModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val listener: (Long) -> Unit = { revision ->
    NativeBridge.emit(context, "onUpdateRevision", mapOf("revision" to revision))
  }

  init {
    context.addLifecycleEventListener(this)
    engine().listen(listener)
    context.currentActivity?.let { engine().onForeground(it) }
  }

  override fun getName() = "StreamFusionUpdater"

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit

  override fun onHostResume() = engine().onForeground(context.currentActivity)
  override fun onHostPause() = engine().onBackground()
  override fun onHostDestroy() = Unit

  override fun invalidate() {
    engine().unlisten(listener)
    context.removeLifecycleEventListener(this)
    super.invalidate()
  }

  @ReactMethod fun snapshot(promise: Promise) = NativeBridge.async(promise) { engine().snapshot() }

  @ReactMethod fun command(command: ReadableMap, promise: Promise) = NativeBridge.async(promise) {
    engine().command(NativeBridge.nonNullMap(command), context.currentActivity)
  }

  private fun engine(): UpdaterEngine = UpdaterEngine.get(context)
}
