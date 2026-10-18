package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.os.Looper
import android.widget.FrameLayout
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class FocusedPlaybackScreenAwakeTest {
  private val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
  private val container = FrameLayout(activity).also(activity::setContentView)
  private val views = mutableMapOf<String, StreamFusionPlaybackView>()

  @After
  fun releasePlayback() {
    FocusedPlaybackSessionOwner.release()
  }

  @Test
  fun playingAndBufferingKeepTheDisplayAwakeButPausingDoesNot() {
    start("watch")
    assertTrue(keepsScreenOn("watch"))

    FocusedPlaybackSessionOwner.setPlaying("watch", false)
    shadowOf(Looper.getMainLooper()).idle()
    assertFalse(keepsScreenOn("watch"))

    FocusedPlaybackSessionOwner.setPlaying("watch", true)
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(keepsScreenOn("watch"))
  }

  @Test
  fun endingOnlyTheLastPlayingSessionAllowsDisplaySleep() {
    start("watch")
    start("second")
    FocusedPlaybackSessionOwner.end("watch")
    assertFalse(keepsScreenOn("watch"))
    assertTrue(keepsScreenOn("second"))

    FocusedPlaybackSessionOwner.end("second")
    assertFalse(keepsScreenOn("second"))
  }

  @Test
  fun backgroundPauseAndReleaseRemoveTheAwakeRequest() {
    start("watch")
    assertTrue(keepsScreenOn("watch"))
    FocusedPlaybackSessionOwner.pauseForBackground()
    shadowOf(Looper.getMainLooper()).idle()
    assertFalse(keepsScreenOn("watch"))

    FocusedPlaybackSessionOwner.setPlaying("watch", true)
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(keepsScreenOn("watch"))
    FocusedPlaybackSessionOwner.release()
    assertFalse(keepsScreenOn("watch"))
  }

  @Test
  fun detachedViewReleasesAwakeRequestAndRebindRestoresIt() {
    start("watch")
    val view = requireNotNull(views["watch"])
    assertTrue(view.keepScreenOn)

    container.removeView(view)
    assertFalse(view.keepScreenOn)

    container.addView(view)
    assertTrue(view.keepScreenOn)
  }

  @Test
  fun pendingLiveSourceRecoveryKeepsTheScreenAwakeUntilPausedOrEnded() {
    val sessionId = "watch"
    start(sessionId, sourceRecovery = true)
    val player = player(sessionId)
    player.stop()
    assertTrue(player.playWhenReady)
    listener(player).onPlayerError(httpError())

    assertTrue(keepsScreenOn(sessionId))
    FocusedPlaybackSessionOwner.setPlaying(sessionId, false)
    assertFalse(keepsScreenOn(sessionId))
    FocusedPlaybackSessionOwner.setPlaying(sessionId, true)
    assertTrue(keepsScreenOn(sessionId))
    FocusedPlaybackSessionOwner.end(sessionId)
    assertFalse(keepsScreenOn(sessionId))
  }

  private fun start(sessionId: String, sourceRecovery: Boolean = false) {
    val view = StreamFusionPlaybackView(activity)
    view.setSessionId(sessionId)
    container.addView(view)
    views[sessionId] = view
    FocusedPlaybackSessionOwner.rememberActivity(activity)
    val request = mutableMapOf<String, Any>(
      "sessionId" to sessionId,
      "sourceUri" to "https://127.0.0.1:1/awake.m3u8",
    )
    if (sourceRecovery) request["sourceRecovery"] = "resolve-live-source"
    FocusedPlaybackSessionOwner.start(activity, request)
    shadowOf(Looper.getMainLooper()).idle()
  }

  private fun player(sessionId: String): ExoPlayer {
    val sessions = field(FocusedPlaybackSessionOwner, "sessions") as Map<*, *>
    return field(requireNotNull(sessions[sessionId]), "player") as ExoPlayer
  }

  private fun listener(player: ExoPlayer): Player.Listener {
    val listeners = field(player, "listeners")!!
    val holders = field(listeners, "listeners") as Set<*>
    return holders.map { field(requireNotNull(it), "listener") }
      .filterIsInstance<Player.Listener>()
      .single { it.javaClass.enclosingClass == FocusedPlaybackSessionOwner.javaClass }
  }

  private fun field(owner: Any, name: String): Any? =
    owner.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(owner)

  private fun httpError(): PlaybackException {
    val cause = HttpDataSource.InvalidResponseCodeException(
      503, "Unavailable", null, emptyMap(),
      DataSpec.Builder().setUri("https://127.0.0.1:1/awake.m3u8").build(), byteArrayOf(),
    )
    return PlaybackException("HTTP 503", cause, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS)
  }

  private fun keepsScreenOn(sessionId: String): Boolean =
    requireNotNull(views[sessionId]).keepScreenOn
}
