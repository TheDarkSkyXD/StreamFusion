package expo.modules.streamfusionnativecontracts

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.ExoPlayer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class FocusedPlaybackQualityTest {
  @After
  fun release() {
    FocusedPlaybackSessionOwner.release()
  }

  @Test
  fun highestRequestedBeforeTracksSelectsTheHighestSupportedQualityWhenTracksArrive() {
    start()
    val requested = FocusedPlaybackSessionOwner.setQuality("watch", "highest")

    assertEquals("completed", requested["kind"])
    assertTrue(player().trackSelectionParameters.forceHighestSupportedBitrate)
    assertEquals(Int.MAX_VALUE, player().trackSelectionParameters.maxVideoHeight)

    listener().onTracksChanged(videoTracks())

    val catalog = catalog()
    assertEquals("1080p", catalog["selected"])
    assertFalse((catalog["qualities"] as List<*>).contains("highest"))
    assertEquals(
      TrackSelectionOverride(videoTracks().groups.single().mediaTrackGroup, 1),
      player().trackSelectionParameters.overrides.values.single(),
    )
  }

  @Test
  fun autoAndManualQualityClearTheHighestPolicy() {
    start()
    assertEquals("completed", FocusedPlaybackSessionOwner.setQuality("watch", "highest")["kind"])
    listener().onTracksChanged(videoTracks())

    val auto = FocusedPlaybackSessionOwner.setQuality("watch", "auto")
    assertEquals("completed", auto["kind"])
    assertEquals("auto", catalog()["selected"])
    assertFalse(player().trackSelectionParameters.forceHighestSupportedBitrate)
    assertEquals(Int.MAX_VALUE, player().trackSelectionParameters.maxVideoHeight)
    assertTrue(player().trackSelectionParameters.overrides.isEmpty())

    assertEquals("completed", FocusedPlaybackSessionOwner.setQuality("watch", "highest")["kind"])
    val manual = FocusedPlaybackSessionOwner.setQuality("watch", "720p")
    assertEquals("completed", manual["kind"])
    assertEquals("720p", catalog()["selected"])
    assertFalse(player().trackSelectionParameters.forceHighestSupportedBitrate)
    assertEquals(720, player().trackSelectionParameters.maxVideoHeight)
    assertTrue(player().trackSelectionParameters.overrides.isEmpty())
  }

  private fun start() {
    val result = FocusedPlaybackSessionOwner.start(
      RuntimeEnvironment.getApplication(),
      mapOf("sessionId" to "watch", "sourceUri" to "https://127.0.0.1:1/live.m3u8"),
    )
    assertEquals("completed", result["kind"])
  }

  private fun catalog(): Map<*, *> =
    FocusedPlaybackSessionOwner.listQualities("watch")["value"] as Map<*, *>

  private fun player(): ExoPlayer {
    val sessions = FocusedPlaybackSessionOwner.javaClass.getDeclaredField("sessions")
      .apply { isAccessible = true }.get(FocusedPlaybackSessionOwner) as Map<*, *>
    val session = requireNotNull(sessions["watch"])
    return session.javaClass.getDeclaredField("player").apply { isAccessible = true }
      .get(session) as ExoPlayer
  }

  private fun listener(): Player.Listener {
    val listeners = player().javaClass.getDeclaredField("listeners")
      .apply { isAccessible = true }.get(player())!!
    val holders = listeners.javaClass.getDeclaredField("listeners")
      .apply { isAccessible = true }.get(listeners) as Set<*>
    return holders.map {
      requireNotNull(it).javaClass.getDeclaredField("listener")
        .apply { isAccessible = true }.get(it)
    }.filterIsInstance<Player.Listener>()
      .single { it.javaClass.enclosingClass == FocusedPlaybackSessionOwner.javaClass }
  }

  private fun videoTracks(): Tracks {
    val formats = listOf(720, 1080, 1440).map { height ->
      Format.Builder()
        .setSampleMimeType(MimeTypes.VIDEO_H264)
        .setWidth(height * 16 / 9)
        .setHeight(height)
        .build()
    }
    return Tracks(listOf(Tracks.Group(
      TrackGroup("variants", *formats.toTypedArray()),
      false,
      intArrayOf(C.FORMAT_HANDLED, C.FORMAT_HANDLED, C.FORMAT_UNSUPPORTED_TYPE),
      booleanArrayOf(false, true, false),
    )))
  }
}
