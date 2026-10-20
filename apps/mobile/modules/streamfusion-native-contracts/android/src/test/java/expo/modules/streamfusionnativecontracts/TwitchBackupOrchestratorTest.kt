package expo.modules.streamfusionnativecontracts

import android.net.Uri
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
import java.io.ByteArrayInputStream
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class TwitchBackupOrchestratorTest {
  private val source = "https://usher.ttvnw.net/api/channel/hls/streamer.m3u8?parent_domains=twitch.tv"
  private val media = "https://origin.example/live/720p.m3u8"
  private val backupMedia = "https://backup.example/live/720p.m3u8"
  private val master = """
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60.0,CODECS="avc1.4d401f,mp4a.40.2"
    $media
  """.trimIndent()
  private val backupMaster = """
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60.0,CODECS="avc1.4d401f,mp4a.40.2"
    $backupMedia
  """.trimIndent()
  private val clean = """
    #EXTM3U
    #EXT-X-TARGETDURATION:2
    #EXT-X-MEDIA-SEQUENCE:100
    #EXTINF:2.0,
    live100.ts
    #EXTINF:2.0,
    live101.ts
  """.trimIndent()
  private val ad = """
    #EXTM3U
    #EXT-X-TARGETDURATION:2
    #EXT-X-MEDIA-SEQUENCE:0
    #EXT-X-DATERANGE:CLASS="twitch-stitched-ad"
    #EXTINF:2.0,
    commercial.ts
  """.trimIndent()

  @Test fun verifiedBackupReplacesAdWithAbsoluteUris() {
    val transport = FakeTransport(backupMaster, clean)
    val orchestrator = TwitchBackupOrchestrator(source, null, transport, InlineExecutor())
    assertEquals(master, orchestrator.process(source, master).playlist)
    orchestrator.process(media, clean)
    val result = orchestrator.process(media, ad)
    assertTrue(result.adsDetected)
    assertTrue(result.playlist.contains("https://backup.example/live/live100.ts"))
    assertTrue(result.playlist.contains("#EXT-X-MEDIA-SEQUENCE:102"))
    val parsed = parseMedia(result.playlist)
    assertEquals(102L, parsed.mediaSequence)
    assertEquals(1, parsed.discontinuitySequence)
    assertFalse(result.playlist.contains("commercial.ts"))
    assertEquals("streamer", transport.channel)
    assertTrue(transport.requestedMasterUrl.contains("sig=signature"))
    assertFalse(transport.requestedMasterUrl.contains("parent_domains"))
    orchestrator.dispose()
  }

  @Test fun missingBackupHoldsUnsafeMediaThenAllowsCleanRecovery() {
    val transport = FakeTransport(null, null)
    val orchestrator = TwitchBackupOrchestrator(source, null, transport, InlineExecutor())
    orchestrator.process(source, master)
    val held = orchestrator.process(media, ad)
    assertTrue(held.adsDetected)
    assertFalse(held.playlist.contains("commercial.ts"))
    assertFalse(held.playlist.contains("#EXTINF"))
    assertEquals(clean, orchestrator.process(media, clean).playlist)
    orchestrator.dispose()
    assertTrue(transport.cancelled)
  }

  @Test fun markerDropoutDoesNotReleasePreviouslyBlockedMedia() {
    val transport = FakeTransport(null, null)
    val orchestrator = TwitchBackupOrchestrator(source, null, transport, InlineExecutor())
    val marked = """
      #EXTM3U
      #EXT-X-TARGETDURATION:2
      #EXT-X-MEDIA-SEQUENCE:100
      #EXT-X-DATERANGE:ID="break-1",CLASS="twitch-stitched-ad",DURATION=30
      #EXTINF:2.0,live
      segment100.ts
      #EXTINF:2.0,live
      segment101.ts
    """.trimIndent()
    val overlap = """
      #EXTM3U
      #EXT-X-TARGETDURATION:2
      #EXT-X-MEDIA-SEQUENCE:101
      #EXTINF:2.0,live
      segment101.ts
      #EXTINF:2.0,live
      segment102.ts
    """.trimIndent()
    val recovered = """
      #EXTM3U
      #EXT-X-TARGETDURATION:2
      #EXT-X-MEDIA-SEQUENCE:102
      #EXTINF:2.0,live
      segment102.ts
      #EXTINF:2.0,live
      segment103.ts
    """.trimIndent()
    try {
      orchestrator.process(source, master)
      assertFalse(orchestrator.process(media, marked).playlist.contains("#EXTINF"))
      val held = orchestrator.process(media, overlap)
      assertTrue(held.adsDetected)
      assertFalse(held.playlist.contains("#EXTINF"))
      val live = orchestrator.process(media, recovered)
      assertFalse(live.adsDetected)
      assertEquals(recovered, live.playlist)
    } finally {
      orchestrator.dispose()
    }
  }

  @Test fun markerDropoutDoesNotReleaseBlockedPrefetchMedia() {
    val orchestrator = TwitchBackupOrchestrator(source, null, FakeTransport(null, null), InlineExecutor())
    try {
      orchestrator.process(source, master)
      orchestrator.process(media, ad + "\n#EXT-X-TWITCH-PREFETCH:blocked-prefetch.ts")
      val overlap = "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXT-X-TWITCH-PREFETCH:blocked-prefetch.ts"
      val held = orchestrator.process(media, overlap)
      assertTrue(held.adsDetected)
      assertFalse(held.playlist.contains("blocked-prefetch.ts"))
    } finally {
      orchestrator.dispose()
    }
  }

  @Test fun backupCannotReplayMediaFromTheBlockedAdWindow() {
    val marked = ad.replace("commercial.ts", "https://origin.example/live/blocked.ts")
    val taintedBackup = clean.replace("live100.ts", "https://origin.example/live/blocked.ts")
    val orchestrator = TwitchBackupOrchestrator(
      source, null, FakeTransport(backupMaster, taintedBackup), InlineExecutor(),
    )
    try {
      orchestrator.process(source, master)
      orchestrator.process(media, marked)
      val held = orchestrator.process(media, marked)
      assertTrue(held.adsDetected)
      assertFalse(held.playlist.contains("#EXTINF"))
      assertFalse(held.playlist.contains("blocked.ts"))
    } finally {
      orchestrator.dispose()
    }
  }

  @Test fun backupCannotReplayAnEarlierWindowFromTheSameAdBreak() {
    val firstWindow = ad.replace("commercial.ts", "https://origin.example/live/first-ad.ts")
    val nextWindow = ad.replace("commercial.ts", "https://origin.example/live/next-ad.ts")
    val transport = FakeTransport(backupMaster, ad)
    var time = 1_000L
    val orchestrator = TwitchBackupOrchestrator(source, null, transport, InlineExecutor(), { time })
    try {
      orchestrator.process(source, master)
      orchestrator.process(media, firstWindow)
      transport.backupPlaylist = clean.replace("live100.ts", "https://origin.example/live/first-ad.ts")
      time += 2_001
      orchestrator.process(media, nextWindow)
      val held = orchestrator.process(media, nextWindow)
      assertFalse(held.playlist.contains("first-ad.ts"))
      assertFalse(held.playlist.contains("#EXTINF"))
    } finally {
      orchestrator.dispose()
    }
  }

  @Test fun cleanAudioRenditionCannotClearBlockedVideoMedia() {
    var time = 1_000L
    val orchestrator = TwitchBackupOrchestrator(source, null, FakeTransport(null, null), InlineExecutor(), { time })
    val audio = "https://origin.example/live/audio.m3u8"
    val marked = ad.replace("commercial.ts", "https://origin.example/live/blocked-video.ts")
    try {
      orchestrator.process(source, master + "\n#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS=\"mp4a.40.2\"\n$audio")
      orchestrator.process(media, marked)
      orchestrator.process(audio, clean)
      time += 20_001
      orchestrator.process(audio, clean)
      val held = orchestrator.process(media, marked.replace("#EXT-X-DATERANGE:CLASS=\"twitch-stitched-ad\"\n", ""))
      assertTrue(held.adsDetected)
      assertFalse(held.playlist.contains("blocked-video.ts"))
    } finally {
      orchestrator.dispose()
    }
  }

  @Test fun backupRefreshCannotReplayBlockedMediaWhileOriginalRecoverySettles() {
    val marked = ad.replace("commercial.ts", "https://origin.example/live/blocked.ts")
    val transport = FakeTransport(backupMaster, clean)
    var time = 1_000L
    val orchestrator = TwitchBackupOrchestrator(source, null, transport, InlineExecutor(), { time })
    try {
      orchestrator.process(source, master)
      orchestrator.process(media, clean)
      orchestrator.process(media, marked)
      transport.backupPlaylist = clean.replace("SEQUENCE:100", "SEQUENCE:101")
        .replace("live100.ts", "https://origin.example/live/blocked.ts")
      time += 3_000
      orchestrator.process(media, clean)
      val output = orchestrator.process(media, clean)
      assertFalse(output.playlist.contains("blocked.ts"))
      assertFalse(output.playlist.contains("#EXTINF"))
    } finally {
      orchestrator.dispose()
    }
  }

  @Test fun backupStaysUntilTwoCleanPollsAcrossTwentySeconds() {
    val transport = FakeTransport(backupMaster, clean)
    var time = 1_000L
    val orchestrator = TwitchBackupOrchestrator(source, null, transport, InlineExecutor(), { time })
    orchestrator.process(source, master)
    orchestrator.process(media, clean)
    orchestrator.process(media, ad)
    time += 3_000
    assertTrue(orchestrator.process(media, clean).playlist.contains("https://backup.example"))
    time += 20_001
    val recovered = parseMedia(orchestrator.process(media, clean).playlist)
    assertEquals(104L, recovered.mediaSequence)
    assertEquals(2, recovered.discontinuitySequence)
    assertEquals(2, recovered.segments.size)
    orchestrator.dispose()
  }

  @Test fun unsafeRefreshInvalidatesBackup() {
    val transport = FakeTransport(backupMaster, clean)
    var time = 1_000L
    val orchestrator = TwitchBackupOrchestrator(source, null, transport, InlineExecutor(), { time })
    orchestrator.process(source, master)
    orchestrator.process(media, clean)
    orchestrator.process(media, ad)
    transport.backupPlaylist = ad
    time += 3_000
    orchestrator.process(media, ad)
    val held = orchestrator.process(media, ad)
    assertFalse(held.playlist.contains("https://backup.example"))
    assertFalse(held.playlist.contains("commercial.ts"))
    orchestrator.dispose()
  }

  @Test fun cleanRecoveryAfterBackupFailureStillRebasesSequence() {
    val transport = FakeTransport(backupMaster, clean)
    var time = 1_000L
    val orchestrator = TwitchBackupOrchestrator(source, null, transport, InlineExecutor(), { time })
    orchestrator.process(source, master)
    orchestrator.process(media, clean)
    orchestrator.process(media, ad)
    transport.backupPlaylist = ad
    time += 3_000
    orchestrator.process(media, ad)
    val held = orchestrator.process(media, clean)
    assertFalse(held.playlist.contains("live100.ts"))
    time += 20_001
    val recovered = parseMedia(orchestrator.process(media, clean).playlist)
    assertEquals(104L, recovered.mediaSequence)
    assertEquals(2, recovered.discontinuitySequence)
    orchestrator.dispose()
  }

  @Test fun ranksMatchingRenditionAndResolvesMediaAttributes() {
    val parsed = TwitchBackupPlaylist.renditions(backupMaster, "https://backup.example/master.m3u8")
    assertEquals("1280x720", parsed.single().resolution)
    assertEquals("avc1.4d401f,mp4a.40.2", parsed.single().codecs)
    val lower = parsed.single().copy(url = "https://backup.example/360.m3u8", resolution = "640x360")
    assertEquals(parsed.single(), TwitchBackupPlaylist.ranked(listOf(lower) + parsed, parsed.single()).first())
    assertTrue(TwitchBackupPlaylist.ranked(listOf(lower.copy(codecs = "hev1.1.6.L120")), parsed.single()).isEmpty())
    val absolute = TwitchBackupPlaylist.absoluteMedia(
      "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:2.0,\nsegment.ts",
      backupMedia,
    )!!
    assertTrue(absolute.contains("URI=\"https://backup.example/live/key.bin\""))
    assertTrue(absolute.contains("https://backup.example/live/segment.ts"))
  }

  @Test fun removesEmbedDomainsFromToken() {
    val token = TwitchBackupHttp.sanitizeToken("""{"parent_domains":["twitch.tv"],"parent_referrer_domains":["x"],"foo":"bar"}""")!!
    assertFalse(token.contains("parent_domains"))
    assertFalse(token.contains("parent_referrer_domains"))
    assertTrue(token.contains("foo"))
  }

  @Test fun disposalCancelsQueuedSearch() {
    val transport = FakeTransport(backupMaster, clean)
    val executor = QueuedExecutor()
    val orchestrator = TwitchBackupOrchestrator(source, null, transport, executor)
    orchestrator.process(source, master)
    orchestrator.process(media, clean)
    val pending = executor.queued.single()
    orchestrator.dispose()
    pending.run()
    assertTrue(transport.cancelled)
    assertEquals(0, transport.tokenCalls)
  }

  private class FakeTransport(
    private val backupMaster: String?,
    var backupPlaylist: String?,
  ) : TwitchBackupTransport {
    var channel = ""
    var requestedMasterUrl = ""
    var cancelled = false
    var tokenCalls = 0
    override fun token(channel: String, playerType: String): Pair<String, String>? {
      tokenCalls++
      this.channel = channel
      return if (backupMaster == null) null else "signature" to "{}"
    }
    override fun text(url: String): String? {
      return if (url.contains("usher.ttvnw.net")) {
        requestedMasterUrl = url
        backupMaster
      } else if (url == "https://backup.example/live/720p.m3u8") backupPlaylist else null
    }
    override fun cancel() { cancelled = true }
  }

  private fun parseMedia(text: String): HlsMediaPlaylist {
    val input = ByteArrayInputStream(text.toByteArray(Charsets.UTF_8))
    return HlsPlaylistParser().parse(Uri.parse(media), input) as HlsMediaPlaylist
  }

  private class InlineExecutor : AbstractExecutorService() {
    private var stopped = false
    override fun execute(command: Runnable) { if (!stopped) command.run() }
    override fun shutdown() { stopped = true }
    override fun shutdownNow(): MutableList<Runnable> { stopped = true; return mutableListOf() }
    override fun isShutdown() = stopped
    override fun isTerminated() = stopped
    override fun awaitTermination(timeout: Long, unit: TimeUnit) = stopped
  }

  private class QueuedExecutor : AbstractExecutorService() {
    val queued = mutableListOf<Runnable>()
    private var stopped = false
    override fun execute(command: Runnable) { if (!stopped) queued.add(command) }
    override fun shutdown() { stopped = true }
    override fun shutdownNow(): MutableList<Runnable> { stopped = true; return queued.toMutableList() }
    override fun isShutdown() = stopped
    override fun isTerminated() = stopped
    override fun awaitTermination(timeout: Long, unit: TimeUnit) = stopped
  }
}
