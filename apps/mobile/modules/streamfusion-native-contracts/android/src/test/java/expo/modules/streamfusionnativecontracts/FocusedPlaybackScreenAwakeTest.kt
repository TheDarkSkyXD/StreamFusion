package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.os.Looper
import android.widget.FrameLayout
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

  private fun start(sessionId: String) {
    val view = StreamFusionPlaybackView(activity)
    view.setSessionId(sessionId)
    container.addView(view)
    views[sessionId] = view
    FocusedPlaybackSessionOwner.rememberActivity(activity)
    FocusedPlaybackSessionOwner.start(activity, mapOf(
      "sessionId" to sessionId,
      "sourceUri" to "https://127.0.0.1:1/awake.m3u8",
    ))
    shadowOf(Looper.getMainLooper()).idle()
  }

  private fun keepsScreenOn(sessionId: String): Boolean =
    requireNotNull(views[sessionId]).keepScreenOn
}
