package expo.modules.streamfusionnativecontracts

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors

internal object NativeBridge {
  private val workers = Executors.newCachedThreadPool()

  fun map(value: ReadableMap): Map<String, Any?> = value.toHashMap()

  fun nonNullMap(value: ReadableMap): Map<String, Any> =
    value.toHashMap().mapNotNull { (key, item) ->
      if (item == null) null else key to item
    }.toMap()

  fun resolve(promise: Promise, value: Any?) {
    val result = when (value) {
      is Map<*, *> -> {
        val entries = value.entries.mapNotNull { (key, item) ->
          if (key is String) key to item else null
        }.toMap()
        Arguments.makeNativeMap(entries)
      }
      is List<*> -> Arguments.makeNativeArray(value)
      else -> value
    }
    promise.resolve(result)
  }

  fun async(promise: Promise, block: () -> Any?) {
    workers.execute {
      try {
        resolve(promise, block())
      } catch (error: Exception) {
        promise.reject("NATIVE_OPERATION_FAILED", error)
      }
    }
  }

  fun onMain(promise: Promise, block: () -> Any?) {
    UiThreadUtil.runOnUiThread {
      try {
        resolve(promise, block())
      } catch (error: Exception) {
        promise.reject("NATIVE_OPERATION_FAILED", error)
      }
    }
  }

  fun emit(context: ReactApplicationContext, name: String, event: Map<String, Any?>) {
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, Arguments.makeNativeMap(event))
  }
}
