package expo.modules.streamfusionnativecontracts

import android.net.Uri
import android.os.Looper
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.common.C
import androidx.media3.exoplayer.drm.ExoMediaDrm
import androidx.media3.exoplayer.drm.MediaDrmCallbackException
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class TwitchProtectedPlaybackTest {
  @After fun close() {
    FocusedPlaybackSessionOwner.release()
    FocusedPlaybackSessionOwner.attachEmitter { }
  }

  @Test fun unknownProtectionIsRejectedBeforeStartingAPlayer() {
    val result = FocusedPlaybackSessionOwner.start(RuntimeEnvironment.getApplication(), mapOf(
      "sessionId" to "protected", "sourceUri" to "https://127.0.0.1:1/live.m3u8",
      "protection" to mapOf("kind" to "unknown"),
    ))
    assertEquals("invalid", result["kind"])
  }

  @Test fun licenseHttpDenialIsTerminalEvenWhenLiveSourceRecoveryIsEnabled() {
    val events = mutableListOf<Map<String, Any>>()
    FocusedPlaybackSessionOwner.attachEmitter(events::add)
    FocusedPlaybackSessionOwner.start(RuntimeEnvironment.getApplication(), mapOf(
      "sessionId" to "protected", "sourceUri" to "https://127.0.0.1:1/live.m3u8",
      "sourceRecovery" to "resolve-live-source",
    ))
    val sessionsField = FocusedPlaybackSessionOwner.javaClass.getDeclaredField("sessions").apply { isAccessible = true }
    val session = (sessionsField.get(FocusedPlaybackSessionOwner) as Map<*, *>)["protected"]!!
    val player = session.javaClass.getDeclaredField("player").apply { isAccessible = true }.get(session) as ExoPlayer
    val listenerClass = Class.forName("expo.modules.streamfusionnativecontracts.FocusedPlaybackSessionOwner\$SessionListener")
    val listener = listenerClass.getDeclaredConstructor(String::class.java, ExoPlayer::class.java)
      .apply { isAccessible = true }.newInstance("protected", player) as Player.Listener
    listener.onPlayerError(PlaybackException("DRM denied", HttpDataSource.InvalidResponseCodeException(
      403, "Forbidden", null, emptyMap(), DataSpec(Uri.parse("https://license.example")), byteArrayOf(),
    ), PlaybackException.ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED))
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(events.any { it["kind"] == "failed" })
    assertFalse(events.any { it["kind"] == "source-recovery-required" })
    assertTrue(player.isReleased)
  }

  @Test fun protectedSourceReplacementAndEndRetireTheirOwnCallbacks() {
    val request = mapOf(
      "sessionId" to "protected", "sourceUri" to "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv&player_backend=mediaplayer&supported_codecs=h264&sig=test&token=test",
      "protection" to mapOf("kind" to "twitch-widevine", "channelName" to "primevideo"),
      "sourceRecovery" to "resolve-live-source",
      "filtering" to mapOf("enabled" to true, "platform" to "twitch", "mode" to "strip", "channelName" to "wrongchannel"),
    )
    val events = mutableListOf<Map<String, Any>>()
    FocusedPlaybackSessionOwner.attachEmitter(events::add)
    assertEquals("completed", FocusedPlaybackSessionOwner.start(RuntimeEnvironment.getApplication(), request)["kind"])
    val sessions = field(FocusedPlaybackSessionOwner, "sessions") as Map<*, *>
    val session = sessions["protected"]!!
    val player = field(session, "player") as ExoPlayer
    val original = field(session, "widevine") as TwitchWidevineSession
    assertEquals(C.WIDEVINE_UUID, player.currentMediaItem!!.localConfiguration!!.drmConfiguration!!.scheme)
    assertTrue(player.currentMediaItem!!.localConfiguration!!.drmConfiguration!!.multiSession)
    val factory = field(session, "filteringFactory")!!
    val backup = field(factory, "backup")!!
    assertEquals("primevideo", field(backup, "channel"))
    assertEquals(true, field(backup, "protected"))
    assertEquals(C.TIME_UNSET, field(original.manager, "sessionKeepaliveMs"))
    assertEquals(true, field(original.manager, "multiSession"))
    val listenerClass = Class.forName("expo.modules.streamfusionnativecontracts.FocusedPlaybackSessionOwner\$SessionListener")
    val listener = listenerClass.getDeclaredConstructor(String::class.java, ExoPlayer::class.java)
      .apply { isAccessible = true }.newInstance("protected", player) as Player.Listener
    listener.onPlayerError(PlaybackException("media", HttpDataSource.InvalidResponseCodeException(
      403, "Forbidden", null, emptyMap(), DataSpec(Uri.parse("https://media.example")), byteArrayOf(),
    ), PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS))
    shadowOf(Looper.getMainLooper()).idle()
    val interruption = events.last { it["kind"] == "source-recovery-required" }["interruptionId"]!!
    FocusedPlaybackSessionOwner.setPlaying("protected", false)
    val recovery = request + mapOf("interruptionId" to interruption)
    assertEquals("completed", FocusedPlaybackSessionOwner.recoverSource(recovery)["kind"])
    assertSame(player, field(session, "player"))
    assertFalse(player.playWhenReady)
    assertTrue(field(backup, "disposed") as Boolean)
    val next = field(session, "widevine") as TwitchWidevineSession
    assertNotSame(original, next)
    val challenge = ExoMediaDrm.KeyRequest(byteArrayOf(1), "")
    assertThrows(MediaDrmCallbackException::class.java) { original.executeKeyRequest(C.WIDEVINE_UUID, challenge) }
    FocusedPlaybackSessionOwner.end("protected")
    assertThrows(MediaDrmCallbackException::class.java) { next.executeKeyRequest(C.WIDEVINE_UUID, challenge) }
    assertTrue(player.isReleased)
  }

  private fun field(target: Any, name: String): Any? = target.javaClass.getDeclaredField(name)
    .apply { isAccessible = true }.get(target)
}
