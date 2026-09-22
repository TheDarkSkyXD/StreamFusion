package expo.modules.streamfusionnativecontracts

import androidx.media3.common.MimeTypes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class PlaybackSourceUriTest {
  @Test
  fun acceptsUsherM3u8AndMp4() {
    assertTrue(
      PlaybackSourceUri.isAcceptedHttpsMedia(
        "https://usher.ttvnw.net/api/channel/hls/live.m3u8",
      ),
    )
    assertTrue(
      PlaybackSourceUri.isAcceptedHttpsMedia("https://cdn.example/clip.mp4"),
    )
  }

  @Test
  fun acceptsPlaylistProxyLiveTemplatesWithoutM3u8() {
    assertTrue(
      PlaybackSourceUri.isAcceptedHttpsMedia("https://eu.luminous.dev/live/tumblurr"),
    )
    assertTrue(
      PlaybackSourceUri.isAcceptedHttpsMedia(
        "https://eu2.luminous.dev/live/tumblurr?allow_source=true",
      ),
    )
    assertEquals(
      MimeTypes.APPLICATION_M3U8,
      PlaybackSourceUri.mimeTypeFor("https://eu.luminous.dev/live/tumblurr"),
    )
  }

  @Test
  fun rejectsNonHttps() {
    assertFalse(PlaybackSourceUri.isAcceptedHttpsMedia("http://eu.luminous.dev/live/x"))
    assertFalse(PlaybackSourceUri.isAcceptedHttpsMedia("file:///tmp/live.m3u8"))
  }
}
