package expo.modules.streamfusionnativecontracts

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class FocusedPlaybackObservationTest {
  @After fun release() { FocusedPlaybackSessionOwner.release() }

  @Test fun speedChangesTheOwnedPlayerAndObservationKeepsItsSessionIdentity() {
    val context = RuntimeEnvironment.getApplication()
    FocusedPlaybackSessionOwner.start(context, mapOf("sessionId" to "recorded-one", "sourceUri" to "https://127.0.0.1:1/recorded.mp4"))
    FocusedPlaybackSessionOwner.start(context, mapOf("sessionId" to "recorded-two", "sourceUri" to "https://127.0.0.1:1/other.mp4", "muted" to true))
    val changed = FocusedPlaybackSessionOwner.setSpeed("recorded-one", 1.5f)["value"] as Map<*, *>
    assertEquals("recorded-one", changed["sessionId"])
    assertEquals(1.5, changed["speed"])
    val first = FocusedPlaybackSessionOwner.readObservation("recorded-one")["value"] as Map<*, *>
    val second = FocusedPlaybackSessionOwner.readObservation("recorded-two")["value"] as Map<*, *>
    assertEquals(1.5, first["speed"])
    assertEquals(1.0, second["speed"])
    assertEquals("recorded-two", second["sessionId"])
    assertNull(first["codec"])
    assertNull(first["width"])
    assertEquals("unsupported", FocusedPlaybackSessionOwner.setSpeed("recorded-one", 3f)["kind"])
    FocusedPlaybackSessionOwner.end("recorded-one")
    assertEquals("missing", (FocusedPlaybackSessionOwner.readObservation("recorded-one")["value"] as Map<*, *>)["kind"])
  }
}
