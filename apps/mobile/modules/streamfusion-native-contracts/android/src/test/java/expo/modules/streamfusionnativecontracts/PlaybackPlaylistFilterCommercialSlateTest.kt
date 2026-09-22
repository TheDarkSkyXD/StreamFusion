package expo.modules.streamfusionnativecontracts

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Desktop-equivalent midroll commercial-slate hold proofs for
 * [PlaybackPlaylistFilter]. Requires Android unit-test classpath (Uri).
 * Run: `./gradlew :streamfusion-native-contracts:testDebugUnitTest`
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class PlaybackPlaylistFilterCommercialSlateTest {
  @Test
  fun holdsInterstitialOnlyMidroll() {
    val playlist =
      """
      #EXTM3U
      #EXT-X-VERSION:3
      #EXT-X-CUE-OUT:DURATION=30
      #EXT-X-DISCONTINUITY
      #EXTINF:2.000,
      https://neutral.synthetic.invalid/v1/segment/commercial-slate-900.ts
      """.trimIndent()
    val result = PlaybackPlaylistFilter.rewrite(playlist, "strip")
    assertTrue(result.adsDetected)
    assertTrue(result.applied)
    assertTrue(result.diagnostic.contains("unsafe-hold"))
    assertFalse(result.playlist.contains("#EXTINF"))
    assertFalse(result.playlist.contains("commercial-slate"))
  }

  @Test
  fun holdsScte35OnlyMidroll() {
    val playlist =
      """
      #EXTM3U
      #EXT-OATCLS-SCTE35:/DAvAAAAAAAA///wBQb+AAAAAA==
      #EXTINF:2.000,
      https://neutral.synthetic.invalid/v1/segment/scte-slate-500.ts
      """.trimIndent()
    val result = PlaybackPlaylistFilter.rewrite(playlist, "strip")
    assertTrue(result.diagnostic.contains("unsafe-hold"))
    assertFalse(result.playlist.contains("#EXTINF"))
    assertFalse(result.playlist.contains("scte-slate"))
  }

  @Test
  fun holdsXtvTwitchAdOnly() {
    val playlist =
      """
      #EXTM3U
      #EXT-X-DATERANGE:ID="ad-1",CLASS="twitch-stitched-ad",X-TV-TWITCH-AD-URL="https://ads.example/track",DURATION=6.0
      #EXTINF:2.000,
      https://neutral.synthetic.invalid/v1/segment/xtv-ad-700.ts
      """.trimIndent()
    val result = PlaybackPlaylistFilter.rewrite(playlist, "strip")
    assertTrue(result.diagnostic.contains("unsafe-hold"))
    assertFalse(result.playlist.contains("#EXTINF"))
    assertFalse(result.playlist.contains("xtv-ad-"))
  }

  @Test
  fun holdsStitchedCommercialOnly() {
    val playlist =
      """
      #EXTM3U
      #EXT-X-DATERANGE:ID="stitched-ad-mid",CLASS="twitch-stitched-ad",DURATION=6.0
      #EXTINF:2.000,stitched
      https://d2nvs31859zcd8.cloudfront.net/ad/midroll-0.ts
      """.trimIndent()
    val result = PlaybackPlaylistFilter.rewrite(playlist, "strip")
    assertTrue(result.diagnostic.contains("unsafe-hold"))
    assertFalse(result.playlist.contains("cloudfront.net"))
    assertFalse(result.playlist.contains("#EXTINF"))
  }

  @Test
  fun holdsStitchedEvenWhenLiveResidueRemains() {
    val playlist =
      """
      #EXTM3U
      #EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",DURATION=4.0
      #EXTINF:2.000,
      https://d2nvs31859zcd8.cloudfront.net/ad/seg0.ts
      #EXT-X-DISCONTINUITY
      #EXTINF:2.000,live
      https://video.twitch.tv/segment10.ts
      """.trimIndent()
    val result = PlaybackPlaylistFilter.rewrite(playlist, "strip")
    assertTrue(result.applied)
    assertTrue(result.diagnostic.contains("unsafe-hold"))
    assertFalse(result.playlist.contains("segment10.ts"))
    assertFalse(result.playlist.contains("cloudfront.net"))
    assertFalse(result.playlist.contains("#EXTINF"))
  }

  @Test
  fun holdsLiveTaggedCommercialSlateAfterAdDiscontinuity() {
    val playlist =
      """
      #EXTM3U
      #EXT-X-DATERANGE:ID="stitched-ad-mid",CLASS="twitch-stitched-ad",DURATION=6.0
      #EXTINF:2.000,
      https://d2nvs31859zcd8.cloudfront.net/ad/midroll-0.ts
      #EXT-X-DISCONTINUITY
      #EXTINF:2.000,live
      https://video-weaver.lax01.hls.ttvnw.net/v1/segment/commercial-break-slate-901.ts
      #EXTINF:2.000,live
      https://video-weaver.lax01.hls.ttvnw.net/v1/segment/commercial-break-slate-902.ts
      """.trimIndent()
    val result = PlaybackPlaylistFilter.rewrite(playlist, "strip")
    assertTrue(result.adsDetected)
    assertTrue(result.applied)
    assertTrue(result.diagnostic.contains("unsafe-hold"))
    assertFalse(result.playlist.contains("commercial-break-slate"))
    assertFalse(result.playlist.contains("cloudfront.net"))
    assertFalse(result.playlist.contains("#EXTINF"))
  }
}
