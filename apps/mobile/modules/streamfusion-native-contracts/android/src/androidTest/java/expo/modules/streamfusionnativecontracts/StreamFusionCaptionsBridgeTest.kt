package expo.modules.streamfusionnativecontracts

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.NativeModule
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StreamFusionCaptionsBridgeTest {
  @Test
  fun captionsExposeTheirContractThroughReactNativeInterop() {
    val context = BridgeReactContext(InstrumentationRegistry.getInstrumentation().targetContext)
    val module = StreamFusionCaptionsModule(context)
    try {
      val interop = Class.forName("com.facebook.react.internal.turbomodule.core.TurboModuleInteropUtils")
      val readMethods = interop.getDeclaredMethod("getMethodDescriptorsFromModule", NativeModule::class.java)
      val descriptors = readMethods.invoke(null, module) as List<*>
      val methods = descriptors.map { descriptor ->
        requireNotNull(descriptor).javaClass.getField("methodName").get(descriptor)
      }.toSet()
      assertTrue(methods.containsAll(setOf("getContractVersion", "cancelEnglishModelInstall", "stopFocusedCaptionSession", "getCaptionProof")))
    } finally {
      module.invalidate()
    }
  }
}
