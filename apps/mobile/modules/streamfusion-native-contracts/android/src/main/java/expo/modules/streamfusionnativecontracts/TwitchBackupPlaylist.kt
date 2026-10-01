package expo.modules.streamfusionnativecontracts

import java.net.URI
import java.util.Locale

internal data class TwitchRendition(
  val url: String,
  val resolution: String,
  val frameRate: Double,
  val bandwidth: Long,
  val codecs: String,
) {
  val height: Int get() = resolution.substringAfter('x', "0").toIntOrNull() ?: 0
}

internal object TwitchBackupPlaylist {
  private val attribute = Regex("([A-Z-]+)=(?:\"([^\"]*)\"|([^,]*))")
  private val uriAttribute = Regex("URI=\"([^\"]+)\"")

  fun isMaster(playlist: String): Boolean = playlist.contains("#EXT-X-STREAM-INF:")

  fun renditions(playlist: String, baseUrl: String): List<TwitchRendition> {
    val lines = playlist.replace("\r", "").lines()
    return lines.dropLast(1).mapIndexedNotNull { index, line ->
      if (!line.startsWith("#EXT-X-STREAM-INF:")) return@mapIndexedNotNull null
      val attrs = attribute.findAll(line).associate { it.groupValues[1] to (it.groupValues[2].ifEmpty { it.groupValues[3] }) }
      val resolution = attrs["RESOLUTION"] ?: return@mapIndexedNotNull null
      val reference = lines[index + 1].trim()
      if (!reference.contains(".m3u8")) return@mapIndexedNotNull null
      val url = resolve(baseUrl, reference) ?: return@mapIndexedNotNull null
      TwitchRendition(
        url,
        resolution,
        attrs["FRAME-RATE"]?.toDoubleOrNull() ?: 30.0,
        attrs["BANDWIDTH"]?.toLongOrNull() ?: 0,
        attrs["CODECS"].orEmpty(),
      )
    }
  }

  fun ranked(candidates: List<TwitchRendition>, target: TwitchRendition?): List<TwitchRendition> {
    val compatible = candidates.filter { target == null || target.codecs.isBlank() ||
      it.codecs.substringBefore(',').substringBefore('.') == target.codecs.substringBefore(',').substringBefore('.') }
    val floor = compatible.filter { it.height >= 480 }
    val emergency = compatible.filter { it.height in 360..479 }
    val exact = if (target != null && target.height >= 480) floor.filter { it.resolution == target.resolution } else emptyList()
    val fallbackHeight = floor.filterNot { it in exact }.minOfOrNull { it.height }
    val fallback = floor.filterNot { it in exact }.filter { it.height == fallbackHeight }
    val emergencyHeight = emergency.maxOfOrNull { it.height }
    val last = emergency.filter { it.height == emergencyHeight }
    return (exact + fallback + last).sortedWith(compareBy<TwitchRendition> {
      when {
        target != null && it.resolution == target.resolution -> 0
        it.height >= 480 -> 1
        else -> 2
      }
    }.thenBy { if (target == null || it.codecs == target.codecs) 0 else 1 }
      .thenBy { if (target == null) 0.0 else kotlin.math.abs(it.frameRate - target.frameRate) }
      .thenBy { if (target == null) 0L else kotlin.math.abs(it.bandwidth - target.bandwidth) })
  }

  fun hasPlayableSegment(playlist: String): Boolean {
    var waiting = false
    var gap = false
    for (line in playlist.lineSequence().map(String::trim)) {
      if (line.startsWith("#EXT-X-TWITCH-PREFETCH:") && line.substringAfter(':').isNotBlank()) return true
      if (line.startsWith("#EXTINF:")) {
        waiting = true
        gap = false
      } else if (waiting && line == "#EXT-X-GAP") {
        gap = true
      } else if (waiting && line.isNotEmpty() && !line.startsWith('#')) {
        if (!gap) return true
        waiting = false
      }
    }
    return false
  }

  fun absoluteMedia(playlist: String, baseUrl: String): String? {
    val lines = playlist.replace("\r", "").lines().map { line ->
      when {
        line.isBlank() -> line
        !line.startsWith('#') -> resolve(baseUrl, line.trim()) ?: return null
        line.startsWith("#EXT-X-TWITCH-PREFETCH:") -> {
          val url = resolve(baseUrl, line.substringAfter(':').trim()) ?: return null
          "#EXT-X-TWITCH-PREFETCH:$url"
        }
        line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-MAP:") ||
          line.startsWith("#EXT-X-PART:") || line.startsWith("#EXT-X-PRELOAD-HINT:") ||
          line.startsWith("#EXT-X-RENDITION-REPORT:") -> {
          val match = uriAttribute.find(line)
          if (match == null) line else {
            val url = resolve(baseUrl, match.groupValues[1]) ?: return null
            line.replaceRange(match.range, "URI=\"$url\"")
          }
        }
        else -> line
      }
    }
    return lines.joinToString("\n")
  }

  fun aligned(active: String, candidate: String): Boolean {
    val activeTimes = active.lineSequence().filter { it.startsWith("#EXT-X-PROGRAM-DATE-TIME:") }.toSet()
    val candidateTimes = candidate.lineSequence().filter { it.startsWith("#EXT-X-PROGRAM-DATE-TIME:") }.toSet()
    if (activeTimes.isNotEmpty() && candidateTimes.isNotEmpty()) return activeTimes.any { it in candidateTimes }
    val activeSequence = sequence(active) ?: return false
    val candidateSequence = sequence(candidate) ?: return false
    val activeCount = active.lineSequence().count { it.startsWith("#EXTINF:") }
    val candidateCount = candidate.lineSequence().count { it.startsWith("#EXTINF:") }
    return activeSequence < candidateSequence + candidateCount && candidateSequence < activeSequence + activeCount
  }

  fun sequence(playlist: String): Long? = playlist.lineSequence()
    .firstOrNull { it.startsWith("#EXT-X-MEDIA-SEQUENCE:") }
    ?.substringAfter(':')?.trim()?.toLongOrNull()

  fun endSequence(playlist: String): Long? = sequence(playlist)?.plus(
    playlist.lineSequence().count { it.startsWith("#EXTINF:") },
  )

  fun discontinuitySequence(playlist: String): Long = playlist.lineSequence()
    .firstOrNull { it.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:") }
    ?.substringAfter(':')?.trim()?.toLongOrNull() ?: 0

  fun endDiscontinuitySequence(playlist: String): Long = discontinuitySequence(playlist) +
    playlist.lineSequence().count { it.trim() == "#EXT-X-DISCONTINUITY" }

  fun rebase(playlist: String, offset: Long, discontinuityOffset: Long): String? {
    val sequence = sequence(playlist) ?: return null
    val rebased = sequence + offset
    val discontinuity = discontinuitySequence(playlist) + discontinuityOffset
    if (rebased < 0 || discontinuity < 0) return null
    val sequenced = playlist.replace(
      Regex("(?m)^#EXT-X-MEDIA-SEQUENCE:[0-9]+"),
      "#EXT-X-MEDIA-SEQUENCE:$rebased",
    )
    return if (sequenced.contains("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
      sequenced.replace(
        Regex("(?m)^#EXT-X-DISCONTINUITY-SEQUENCE:[0-9]+"),
        "#EXT-X-DISCONTINUITY-SEQUENCE:$discontinuity",
      )
    } else {
      sequenced.replace(Regex("(?m)^#EXT-X-MEDIA-SEQUENCE:[0-9]+")) { match ->
        "${match.value}\n#EXT-X-DISCONTINUITY-SEQUENCE:$discontinuity"
      }
    }
  }

  fun channelFromUsher(url: String): String? {
    val uri = runCatching { URI(url) }.getOrNull() ?: return null
    if (!uri.host.equals("usher.ttvnw.net", true)) return null
    return Regex("/api/(?:v2/)?channel/hls/([a-zA-Z0-9_]+)\\.m3u8")
      .find(uri.path)?.groupValues?.get(1)?.lowercase(Locale.US)
  }

  private fun resolve(baseUrl: String, reference: String): String? = runCatching {
    URI(baseUrl).resolve(reference).toString().takeIf { URI(it).scheme.equals("https", true) }
  }.getOrNull()
}
