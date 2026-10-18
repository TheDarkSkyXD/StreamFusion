package expo.modules.streamfusionnativecontracts

import android.app.Application
import android.os.Looper
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class FocusedPlaybackSourceRecoveryTest {
  private val context: Application = RuntimeEnvironment.getApplication()
  private val events = mutableListOf<Map<String, Any>>()
  private val firstUri = "https://127.0.0.1:1/first.m3u8"
  private val secondUri = "https://127.0.0.1:1/second.m3u8"

  @After
  fun releasePlayback() {
    FocusedPlaybackSessionOwner.release()
    FocusedPlaybackSessionOwner.attachEmitter { }
  }

  @Test
  fun forbiddenSourceCanBeReplacedOnTheSamePausedPlayerWithFreshFiltering() {
    start(filtering = true)
    val player = player()
    val oldFactory = filteringFactory()
    FocusedPlaybackSessionOwner.setPlaying("watch", false)
    FocusedPlaybackSessionOwner.setMuted("watch", true)
    FocusedPlaybackSessionOwner.setVolume("watch", 0.3f)
    FocusedPlaybackSessionOwner.setQuality("watch", "720p")
    val tracks = player.trackSelectionParameters
    listener(player).onPlayerError(httpError(403))
    val interruptionId = interruptionId()

    val result = FocusedPlaybackSessionOwner.recoverSource(mapOf(
      "sessionId" to "watch",
      "interruptionId" to interruptionId,
      "sourceUri" to secondUri,
      "requestHeaders" to mapOf("Authorization" to "fresh-token"),
      "filtering" to mapOf("enabled" to true, "platform" to "twitch", "mode" to "strip"),
    ))

    assertEquals("completed", result["kind"])
    assertSame(player, player())
    assertFalse(player.isReleased)
    assertFalse(player.playWhenReady)
    assertEquals(0f, player.volume)
    assertEquals(tracks, player.trackSelectionParameters)
    assertEquals("720p", completedValue(FocusedPlaybackSessionOwner.listQualities("watch"))["selected"])
    assertEquals(secondUri, player.currentMediaItem?.localConfiguration?.uri.toString())
    val newFactory = filteringFactory()
    assertNotSame(oldFactory, newFactory)
    assertEquals(secondUri, field(newFactory, "sourceUri"))
    assertTrue(field(field(oldFactory, "backup")!!, "disposed") as Boolean)
    assertFalse(field(field(newFactory, "backup")!!, "disposed") as Boolean)
  }

  @Test
  fun staleRecoveryCannotReplaceAnEndedOrNewerSession() {
    start()
    val firstPlayer = player()
    listener(firstPlayer).onPlayerError(httpError(503))
    val firstInterruption = interruptionId()
    assertEquals("invalid", FocusedPlaybackSessionOwner.recoverSource(recovery(firstInterruption + 1))["kind"])
    assertEquals(firstUri, firstPlayer.currentMediaItem?.localConfiguration?.uri.toString())
    FocusedPlaybackSessionOwner.end("watch")
    assertEquals("missing", completedValue(FocusedPlaybackSessionOwner.recoverSource(recovery(firstInterruption)))["kind"])

    start()
    val nextPlayer = player()
    listener(nextPlayer).onPlayerError(httpError(503))
    val nextInterruption = interruptionId()
    assertTrue(nextInterruption > firstInterruption)
    assertEquals("invalid", FocusedPlaybackSessionOwner.recoverSource(recovery(firstInterruption))["kind"])
    assertEquals(firstUri, nextPlayer.currentMediaItem?.localConfiguration?.uri.toString())
    assertEquals("completed", FocusedPlaybackSessionOwner.recoverSource(recovery(nextInterruption))["kind"])
    assertEquals("invalid", FocusedPlaybackSessionOwner.recoverSource(recovery(nextInterruption))["kind"])
  }

  @Test
  fun recoveryAcknowledgmentWaitsForReady() {
    start()
    val player = player()
    val playbackListener = listener(player)
    val error = httpError(503)
    playbackListener.onPlayerError(error)
    val id = interruptionId()
    assertEquals("completed", FocusedPlaybackSessionOwner.recoverSource(recovery(id))["kind"])
    playbackListener.onPlayerError(error)
    playbackListener.onPlayWhenReadyChanged(true, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(0, events.count { it["kind"] == "source-recovered" })
    assertEquals(1, events.count { it["kind"] == "source-recovery-required" })

    playbackListener.onPlaybackStateChanged(Player.STATE_READY)
    playbackListener.onPlaybackStateChanged(Player.STATE_READY)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(listOf(id), events.filter { it["kind"] == "source-recovered" }.map { it["interruptionId"] })
  }

  @Test
  fun decoderFailureRemainsTerminalAndAnUnoptedHttpFailureRemainsTerminal() {
    start()
    val player = player()
    listener(player).onPlayerError(PlaybackException(
      "Decoder failed", null, PlaybackException.ERROR_CODE_DECODING_FAILED,
    ))
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(player.isReleased)
    assertEquals(1, events.count { it["kind"] == "failed" })
    assertEquals(0, events.count { it["kind"] == "source-recovery-required" })

    start(sourceRecovery = false)
    val unopted = player()
    listener(unopted).onPlayerError(httpError(503))
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(unopted.isReleased)
    assertEquals(2, events.count { it["kind"] == "failed" })
  }

  @Test
  fun recoveryRequestRetainsTheExistingPipSession() {
    start()
    val player = player()
    ownerField("pictureInPictureActive", true)
    ownerField("pictureInPictureSessionId", "watch")

    listener(player).onPlayerError(httpError(503))

    assertFalse(player.isReleased)
    assertSame(player, player())
    assertEquals("watch", ownerField("pictureInPictureSessionId"))
    assertEquals(true, ownerField("pictureInPictureActive"))
  }

  private fun start(filtering: Boolean = false, sourceRecovery: Boolean = true) {
    FocusedPlaybackSessionOwner.attachEmitter(events::add)
    val request = mutableMapOf<String, Any>("sessionId" to "watch", "sourceUri" to firstUri)
    if (sourceRecovery) request["sourceRecovery"] = "resolve-live-source"
    if (filtering) {
      request["requestHeaders"] = mapOf("Authorization" to "old-token")
      request["filtering"] = mapOf("enabled" to true, "platform" to "twitch", "mode" to "strip")
    }
    assertEquals("completed", FocusedPlaybackSessionOwner.start(context, request)["kind"])
  }

  private fun recovery(id: Int) = mapOf<String, Any>(
    "sessionId" to "watch", "interruptionId" to id, "sourceUri" to secondUri,
  )

  private fun httpError(status: Int): PlaybackException {
    val cause = HttpDataSource.InvalidResponseCodeException(
      status, "HTTP $status", null, emptyMap(),
      DataSpec.Builder().setUri(firstUri).build(), byteArrayOf(),
    )
    return PlaybackException("HTTP $status", cause, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS)
  }

  private fun interruptionId(): Int {
    shadowOf(Looper.getMainLooper()).idle()
    return events.last { it["kind"] == "source-recovery-required" }["interruptionId"] as Int
  }

  private fun player(): ExoPlayer = field(session(), "player") as ExoPlayer

  private fun filteringFactory(): FilteringDataSource.Factory = field(session(), "filteringFactory") as FilteringDataSource.Factory

  private fun session(): Any {
    val sessions = ownerField("sessions") as Map<*, *>
    return requireNotNull(sessions["watch"])
  }

  private fun ownerField(name: String, value: Any? = null): Any? {
    val property = FocusedPlaybackSessionOwner.javaClass.getDeclaredField(name).apply { isAccessible = true }
    if (value != null) property.set(FocusedPlaybackSessionOwner, value)
    return property.get(FocusedPlaybackSessionOwner)
  }

  private fun field(owner: Any, name: String): Any? =
    owner.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(owner)

  private fun listener(player: ExoPlayer): Player.Listener {
    val listeners = field(player, "listeners")!!
    val holders = field(listeners, "listeners") as Set<*>
    return holders.map { field(requireNotNull(it), "listener") }
      .filterIsInstance<Player.Listener>()
      .single { it.javaClass.enclosingClass == FocusedPlaybackSessionOwner.javaClass }
  }

  private fun completedValue(result: Map<String, Any>) = result["value"] as Map<*, *>
}
