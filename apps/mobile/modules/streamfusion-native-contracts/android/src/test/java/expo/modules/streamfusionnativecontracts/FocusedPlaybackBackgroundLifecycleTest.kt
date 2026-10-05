package expo.modules.streamfusionnativecontracts

import android.app.Application
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
class FocusedPlaybackBackgroundLifecycleTest {
  private val context: Application = RuntimeEnvironment.getApplication()

  @After
  fun releasePlayback() {
    FocusedPlaybackSessionOwner.release()
  }

  @Test
  fun requestedPictureInPictureKeepsOnlyItsSessionPlayingInBackground() {
    assertOnlyPipSessionKeepsPlaying(requested = true, active = false)
  }

  @Test
  fun activePictureInPictureKeepsOnlyItsSessionPlayingInBackground() {
    assertOnlyPipSessionKeepsPlaying(requested = false, active = true)
  }

  @Test
  fun backgroundWithoutPictureInPicturePausesEverySession() {
    val audible = startPlayback("audible-player", muted = false)
    val muted = startPlayback("muted-player", muted = true)

    FocusedPlaybackSessionOwner.pauseForBackground()

    assertFalse(audible.playWhenReady)
    assertFalse(muted.playWhenReady)
  }

  @Test
  fun backgroundDoesNotResumeAPausedPictureInPictureSession() {
    val audible = startPlayback("audible-player", muted = false)
    val muted = startPlayback("muted-player", muted = true)
    setPipState("audible-player", requested = false, active = true)
    FocusedPlaybackSessionOwner.setPlaying("audible-player", false)

    FocusedPlaybackSessionOwner.pauseForBackground()

    assertFalse(audible.playWhenReady)
    assertFalse(muted.playWhenReady)
  }

  private fun assertOnlyPipSessionKeepsPlaying(requested: Boolean, active: Boolean) {
    val audible = startPlayback("audible-player", muted = false)
    val muted = startPlayback("muted-player", muted = true)
    setPipState("audible-player", requested, active)

    FocusedPlaybackSessionOwner.pauseForBackground()
    FocusedPlaybackSessionOwner.pauseForBackground()

    assertTrue(audible.playWhenReady)
    assertFalse(muted.playWhenReady)
  }

  private fun startPlayback(id: String, muted: Boolean): ExoPlayer {
    val result = FocusedPlaybackSessionOwner.start(context, mapOf(
      "sessionId" to id,
      "sourceUri" to "https://127.0.0.1:1/lifecycle.m3u8",
      "muted" to muted,
    ))
    assertEquals("completed", result["kind"])
    val sessions = ownerField("sessions").get(FocusedPlaybackSessionOwner) as Map<*, *>
    val session = requireNotNull(sessions[id])
    val playerField = session.javaClass.getDeclaredField("player").apply { isAccessible = true }
    return (playerField.get(session) as ExoPlayer).also {
      assertTrue(it.playWhenReady)
      assertEquals(if (muted) 0f else 1f, it.volume, 0f)
    }
  }

  private fun setPipState(sessionId: String, requested: Boolean, active: Boolean) {
    ownerField("pictureInPictureSessionId").set(FocusedPlaybackSessionOwner, sessionId)
    ownerField("pictureInPictureRequested").setBoolean(FocusedPlaybackSessionOwner, requested)
    ownerField("pictureInPictureActive").setBoolean(FocusedPlaybackSessionOwner, active)
  }

  private fun ownerField(name: String) = FocusedPlaybackSessionOwner.javaClass
    .getDeclaredField(name).apply { isAccessible = true }
}
