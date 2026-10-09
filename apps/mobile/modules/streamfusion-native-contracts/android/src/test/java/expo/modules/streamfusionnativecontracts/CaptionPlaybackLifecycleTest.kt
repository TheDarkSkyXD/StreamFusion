package expo.modules.streamfusionnativecontracts

import android.app.Application
import android.os.Looper
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class CaptionPlaybackLifecycleTest {
  private val context: Application = RuntimeEnvironment.getApplication()

  @Test
  fun endingMatchingPlaybackStopsCaptionsAndClearsTheCue() = withCaptions { owner ->
    startPlayback("caption-player")
    startCaptions(owner)
    FocusedPlaybackSessionOwner.end("caption-player")
    assertStopped(owner)
  }

  @Test
  fun replacingMatchingPlaybackStopsCaptions() = withCaptions { owner ->
    startPlayback("caption-player")
    startCaptions(owner)
    startPlayback("caption-player")
    assertStopped(owner)
  }

  @Test
  fun releasingPlaybackStopsCaptions() = withCaptions { owner ->
    startPlayback("caption-player")
    startCaptions(owner)
    FocusedPlaybackSessionOwner.release()
    assertStopped(owner)
  }

  @Test
  fun endingAnotherPlaybackKeepsTheCaptionSessionActive() = withCaptions { owner ->
    startPlayback("caption-player")
    startPlayback("other-player")
    startCaptions(owner)
    FocusedPlaybackSessionOwner.end("other-player")
    assertEquals("active", owner.proof()["state"])
    assertEquals("caption-player", owner.proof()["sessionId"])
    assertEquals("Diagnostic caption fixture is running.", owner.proof()["cueText"])
    FocusedPlaybackSessionOwner.end("caption-player")
    assertStopped(owner)
  }

  @Test
  fun delayedEndCallbackCannotStopAReplacementCaptionSessionWithTheSameId() = withCaptions { owner ->
    startCaptions(owner)
    val previousEnded = requireNotNull(CaptionPcmTap.subscription).ended
    owner.stop("caption-player")
    startCaptions(owner)
    previousEnded()
    assertEquals("active", owner.proof()["state"])
    assertEquals("Diagnostic caption fixture is running.", owner.proof()["cueText"])
    CaptionPcmTap.endSession("caption-player")
    assertStopped(owner)
  }

  @Test
  fun endedPlaybackReleasesItsPlayerAndCaptionsBeforePublishing() {
    assertTerminalCleanup("ended") { it.onPlaybackStateChanged(Player.STATE_ENDED) }
  }

  @Test
  fun failedPlaybackReleasesItsPlayerAndCaptionsWithoutPublishingEnded() {
    assertTerminalCleanup("failed") { it.onPlayerError(playbackError()) }
  }

  @Test
  fun behindLiveWindowKeepsTheOwnedPlayerAndCaptionsActive() = withCaptions { owner ->
    val events = mutableListOf<Map<String, Any>>()
    FocusedPlaybackSessionOwner.attachEmitter { events.add(it) }
    startPlayback("caption-player")
    val player = playbackPlayer("caption-player")
    startCaptions(owner)

    playbackListener(player).onPlayerError(behindLiveWindowError())
    assertEquals(Player.STATE_BUFFERING, player.playbackState)
    shadowOf(Looper.getMainLooper()).idle()

    assertFalse(player.isReleased)
    assertTrue(player === playbackPlayer("caption-player"))
    assertTrue(player.playWhenReady)
    assertEquals("active", owner.proof()["state"])
    assertEquals("Diagnostic caption fixture is running.", owner.proof()["cueText"])
    assertEquals(emptyList<String>(), terminalEvents(events))
  }

  @Test
  fun behindLiveWindowKeepsAnAlreadyPausedSessionPaused() = withCaptions { owner ->
    startPlayback("caption-player")
    val player = playbackPlayer("caption-player")
    startCaptions(owner)
    FocusedPlaybackSessionOwner.setPlaying("caption-player", false)

    playbackListener(player).onPlayerError(behindLiveWindowError())

    assertFalse(player.isReleased)
    assertFalse(player.playWhenReady)
    assertEquals("active", owner.proof()["state"])
  }

  @Test
  fun repeatedTerminalCallbacksDisposeAndPublishOnlyOnce() = withCaptions { owner ->
    val events = mutableListOf<Map<String, Any>>()
    FocusedPlaybackSessionOwner.attachEmitter { events.add(it) }
    startPlayback("caption-player")
    val player = playbackPlayer("caption-player")
    val listener = playbackListener(player)
    startCaptions(owner)

    listener.onPlaybackStateChanged(Player.STATE_ENDED)
    listener.onPlaybackStateChanged(Player.STATE_ENDED)
    listener.onPlayerError(playbackError())

    assertTrue(player.isReleased)
    assertStopped(owner)
    assertEquals(listOf("ended"), terminalEvents(events))
  }

  @Test
  fun staleTerminalCallbacksCannotDisposeAReplacementPlaybackWithTheSameId() = withCaptions { owner ->
    val events = mutableListOf<Map<String, Any>>()
    FocusedPlaybackSessionOwner.attachEmitter { events.add(it) }
    startPlayback("caption-player")
    val previousPlayer = playbackPlayer("caption-player")
    val previousListener = playbackListener(previousPlayer)
    startPlayback("caption-player")
    val replacementPlayer = playbackPlayer("caption-player")
    startCaptions(owner)

    previousListener.onPlaybackStateChanged(Player.STATE_ENDED)
    previousListener.onPlayerError(playbackError())
    previousListener.onPlayerError(behindLiveWindowError())
    shadowOf(Looper.getMainLooper()).idle()

    assertTrue(previousPlayer.isReleased)
    assertFalse(replacementPlayer.isReleased)
    assertTrue(replacementPlayer.playWhenReady)
    assertEquals("completed", FocusedPlaybackSessionOwner.setPlaying("caption-player", true)["kind"])
    assertEquals("active", owner.proof()["state"])
    assertEquals("Diagnostic caption fixture is running.", owner.proof()["cueText"])
    assertEquals(emptyList<String>(), terminalEvents(events))
  }

  @Test
  fun anotherPlaybackFailureKeepsTheCaptionPlayerActive() = withCaptions { owner ->
    startPlayback("caption-player")
    startPlayback("other-player")
    val otherPlayer = playbackPlayer("other-player")
    startCaptions(owner)

    playbackListener(otherPlayer).onPlayerError(playbackError())

    assertTrue(otherPlayer.isReleased)
    assertFalse(playbackPlayer("caption-player").isReleased)
    assertEquals("active", owner.proof()["state"])
    assertEquals("caption-player", owner.proof()["sessionId"])
  }

  private fun assertTerminalCleanup(kind: String, trigger: (Player.Listener) -> Unit) = withCaptions { owner ->
    val events = mutableListOf<Map<String, Any>>()
    FocusedPlaybackSessionOwner.attachEmitter { event ->
      if (event["kind"] == kind) {
        assertEquals("stopped", owner.proof()["state"])
      }
      events.add(event)
    }
    startPlayback("caption-player")
    val player = playbackPlayer("caption-player")
    startCaptions(owner)

    trigger(playbackListener(player))

    assertTrue(player.isReleased)
    assertStopped(owner)
    assertEquals("missing", (FocusedPlaybackSessionOwner.setPlaying("caption-player", true)["value"] as Map<*, *>)["kind"])
    assertEquals(listOf(kind), terminalEvents(events))

    startPlayback("caption-retry")
    startCaptions(owner, "caption-retry")
    assertEquals("active", owner.proof()["state"])
    assertEquals("caption-retry", owner.proof()["sessionId"])
  }

  private fun terminalEvents(events: List<Map<String, Any>>) = events
    .filter { it["kind"] == "ended" || it["kind"] == "failed" }
    .map { it["kind"] as String }

  private fun playbackError() = PlaybackException("Fixture failure", null, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)

  private fun behindLiveWindowError() = PlaybackException(
    "Fixture live-window failure",
    null,
    PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW,
  )

  private fun playbackPlayer(id: String): ExoPlayer {
    val field = FocusedPlaybackSessionOwner.javaClass.getDeclaredField("sessions").apply { isAccessible = true }
    val session = requireNotNull((field.get(FocusedPlaybackSessionOwner) as Map<*, *>)[id])
    return session.javaClass.getDeclaredField("player").apply { isAccessible = true }.get(session) as ExoPlayer
  }

  private fun playbackListener(player: ExoPlayer): Player.Listener {
    val listeners = player.javaClass.getDeclaredField("listeners").apply { isAccessible = true }.get(player)
    val holders = listeners.javaClass.getDeclaredField("listeners").apply { isAccessible = true }.get(listeners) as Set<*>
    return holders.map { holder ->
      requireNotNull(holder).javaClass.getDeclaredField("listener").apply { isAccessible = true }.get(holder)
    }.filterIsInstance<Player.Listener>().single { it.javaClass.enclosingClass == FocusedPlaybackSessionOwner.javaClass }
  }

  private fun startPlayback(id: String) {
    val result = FocusedPlaybackSessionOwner.start(context, mapOf(
      "sessionId" to id,
      "sourceUri" to "https://127.0.0.1:1/lifecycle.m3u8",
    ))
    assertEquals("completed", result["kind"])
  }

  private fun startCaptions(owner: CaptionSessionOwner, id: String = "caption-player") {
    val result = owner.start(mapOf(
      "modelId" to "english-v1",
      "sessionId" to id,
      "sourceUri" to "${CaptionCatalog.FIXTURE_URI}?pcm",
    ))
    assertEquals("completed", result["kind"])
    val deadline = System.nanoTime() + 3_000_000_000L
    while (owner.proof()["cueText"] != "Diagnostic caption fixture is running." && System.nanoTime() < deadline) {
      Thread.sleep(10)
    }
    assertEquals("Diagnostic caption fixture is running.", owner.proof()["cueText"])
    assertTrue((owner.proof()["pcmBytesProcessed"] as Long) > 0L)
  }

  private fun assertStopped(owner: CaptionSessionOwner) {
    val stopped = owner.proof()
    assertEquals("stopped", stopped["state"])
    assertEquals("caption-player", stopped["sessionId"])
    assertEquals("", stopped["cueText"])
    assertEquals(null, CaptionPcmTap.subscription)
    Thread.sleep(100)
    assertEquals(stopped["pcmBytesProcessed"], owner.proof()["pcmBytesProcessed"])
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals("stopped", owner.proof()["state"])
  }

  private fun withCaptions(work: (CaptionSessionOwner) -> Unit) {
    val root = Files.createTempDirectory("caption-playback-lifecycle").toFile()
    val store = CaptionModelStore(root)
    store.install("${CaptionCatalog.FIXTURE_URI}?install")
    val owner = CaptionSessionOwner(context, store) { }
    try {
      work(owner)
    } finally {
      FocusedPlaybackSessionOwner.release()
      FocusedPlaybackSessionOwner.attachEmitter { }
      owner.dispose()
      root.deleteRecursively()
    }
  }
}
