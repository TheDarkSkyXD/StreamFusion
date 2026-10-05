package expo.modules.streamfusionnativecontracts

import android.app.ActivityManager
import android.app.Application
import android.os.PowerManager
import java.nio.file.Files
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class CaptionResourcePressureTest {
  private val context: Application = RuntimeEnvironment.getApplication()

  @Test
  fun lowMemoryRejectsStartBeforeModelLoading() {
    val info = ActivityManager.MemoryInfo().also { it.lowMemory = true }
    shadowOf(context.getSystemService(ActivityManager::class.java)).setMemoryInfo(info)
    withOwner { owner ->
      val result = owner.start(mapOf("modelId" to "english-v1", "sessionId" to "native-player"))
      val value = result["value"]
      require(value is Map<*, *>)
      assertEquals("rejected", value["state"])
      assertEquals("Captions paused because Android reported low memory.", value["reason"])
    }
  }

  @Test
  fun severeThermalPressureRejectsStartBeforeModelLoading() {
    shadowOf(context.getSystemService(PowerManager::class.java)).setCurrentThermalStatus(PowerManager.THERMAL_STATUS_SEVERE)
    withOwner { owner ->
      val result = owner.start(mapOf("modelId" to "english-v1", "sessionId" to "native-player"))
      val value = result["value"]
      require(value is Map<*, *>)
      assertEquals("rejected", value["state"])
      assertEquals("Captions paused because Android reported severe thermal pressure.", value["reason"])
    }
  }

  @Test
  fun androidReportedThermalChangeStopsAnActivePumpAtTheNextResourceSample() {
    withOwner { owner ->
      owner.start(mapOf("modelId" to "english-v1", "sessionId" to "fixture-player", "sourceUri" to "${CaptionCatalog.FIXTURE_URI}?pcm"))
      await {
        val processed = owner.proof()["pcmBytesProcessed"]
        processed is Long && processed > 0
      }
      shadowOf(context.getSystemService(PowerManager::class.java)).setCurrentThermalStatus(PowerManager.THERMAL_STATUS_SEVERE)
      ShadowSystemClock.advanceBy(Duration.ofSeconds(6))
      await { owner.proof()["state"] == "rejected" }
      assertEquals("Captions paused because Android reported severe thermal pressure.", owner.proof()["reason"])
      assertEquals(null, CaptionPcmTap.subscription)
    }
  }

  private fun withOwner(work: (CaptionSessionOwner) -> Unit) {
    val root = Files.createTempDirectory("caption-resource-proof").toFile()
    val store = CaptionModelStore(root)
    store.install("${CaptionCatalog.FIXTURE_URI}?install")
    val owner = CaptionSessionOwner(context, store) { }
    try { work(owner) } finally { owner.dispose(); root.deleteRecursively() }
  }

  private fun await(condition: () -> Boolean) {
    val deadline = System.nanoTime() + 3_000_000_000L
    while (!condition() && System.nanoTime() < deadline) Thread.sleep(10)
    assertTrue("Caption resource transition did not complete.", condition())
  }
}
