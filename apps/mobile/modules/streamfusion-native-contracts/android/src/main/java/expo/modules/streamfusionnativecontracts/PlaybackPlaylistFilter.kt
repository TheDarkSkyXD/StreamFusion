package expo.modules.streamfusionnativecontracts

object PlaybackPlaylistFilter {
  private const val PREFETCH_PREFIX = "#EXT-X-TWITCH-PREFETCH:"
  private val adHosts = setOf(
    "d2nvs31859zcd8.cloudfront.net",
    "d2vjef5jvl6bfs.cloudfront.net",
  )
  private val dateRangePatterns = listOf(
    "stitched-ad",
    "twitch-stitched-ad",
    "amazon-ad",
    "com.twitch.tv/ad",
  )

  data class Result(
    val adsDetected: Boolean,
    val applied: Boolean,
    val diagnostic: String,
    val playlist: String,
  )

  fun rewrite(playlist: String, mode: String): Result {
    if (mode == "passthrough") {
      return keep(playlist, "Filtering is off.")
    }
    val adsDetected = hasAds(playlist)
    if (!adsDetected) {
      return keep(playlist, "No Twitch ad markers in this playlist.")
    }
    if (mode == "canary") {
      return keep(
        playlist,
        "Canary saw ad markers and kept the original playlist.",
        adsDetected = true,
      )
    }
    val stripped = stripAdSegments(playlist)
    if (!hasMediaSegments(stripped)) {
      return keep(
        playlist,
        "Strip would empty the playlist. Original playlist kept.",
        adsDetected = true,
      )
    }
    return Result(
      true,
      true,
      "Twitch ad segments were stripped from this playlist.",
      stripped,
    )
  }

  fun hasAds(playlist: String): Boolean {
    if (playlist.lowercase().contains("stitched")) return true
    return playlist.lineSequence().any { isAdLine(it) }
  }

  private fun keep(
    playlist: String,
    diagnostic: String,
    adsDetected: Boolean = false,
  ): Result {
    return Result(adsDetected, false, diagnostic, playlist)
  }

  private fun stripAdSegments(playlist: String): String {
    val lines = playlist.replace("\r", "").split("\n")
    val kept = ArrayList<String>(lines.size)
    var index = 0
    while (index < lines.size) {
      val skip = skippedAdLines(lines, index)
      if (skip > 0) {
        index += skip
        continue
      }
      kept.add(lines[index])
      index += 1
    }
    return kept.joinToString("\n")
  }

  private fun skippedAdLines(lines: List<String>, index: Int): Int {
    val line = lines[index]
    if (isAdDateRange(line) || isAdCue(line)) return 1
    if (line.startsWith(PREFETCH_PREFIX) && isAdSegment(line.substring(PREFETCH_PREFIX.length))) {
      return 1
    }
    if (line.startsWith("#EXTINF:") && isAdSegment(lines.getOrNull(index + 1).orEmpty())) {
      return 2
    }
    return 0
  }

  private fun hasMediaSegments(playlist: String): Boolean {
    return playlist.lineSequence().any { line ->
      val trimmed = line.trim()
      trimmed.isNotEmpty() && !trimmed.startsWith("#")
    }
  }

  private fun isAdLine(line: String): Boolean {
    return isAdDateRange(line) || isAdCue(line) || isAdSegment(line)
  }

  private fun isAdDateRange(line: String): Boolean {
    if (!line.startsWith("#EXT-X-DATERANGE:")) return false
    val lower = line.lowercase()
    return dateRangePatterns.any(lower::contains)
  }

  private fun isAdCue(line: String): Boolean {
    return line.startsWith("#EXT-X-CUE-OUT") || line.startsWith("#EXT-X-CUE-IN")
  }

  private fun isAdSegment(value: String): Boolean {
    val candidate = value.trim()
    if (candidate.isEmpty() || candidate.startsWith("#")) return false
    return try {
      val uri = android.net.Uri.parse(candidate)
      val host = uri.host?.lowercase().orEmpty()
      val path = uri.path?.lowercase().orEmpty()
      when {
        host in adHosts -> true
        host.endsWith(".cloudfront.net") && path.split("/").contains("ad") -> true
        path.contains("amazon-ad") || path.contains("stitched-ad") -> true
        else -> false
      }
    } catch (_: Throwable) {
      candidate.lowercase().contains("stitched-ad")
    }
  }
}
