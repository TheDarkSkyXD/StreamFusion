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
    val lower = playlist.lowercase()
    if (lower.contains("stitched") || lower.contains("amazon|")) return true
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
    var insideDateRangeAd = false
    var insideCueAd = false
    var index = 0
    while (index < lines.size) {
      val line = lines[index]
      val nextLine = lines.getOrNull(index + 1).orEmpty()
      when {
        isAdDateRange(line) -> {
          insideDateRangeAd = true
          index += 1
        }
        isAdCueOut(line) -> {
          insideCueAd = true
          index += 1
        }
        isAdCueIn(line) -> {
          insideCueAd = false
          insideDateRangeAd = false
          index += 1
        }
        line.startsWith("#EXT-X-DISCONTINUITY") -> {
          insideDateRangeAd = false
          kept.add(line)
          index += 1
        }
        line.startsWith(PREFETCH_PREFIX) &&
          isAdSegment(line.substring(PREFETCH_PREFIX.length)) -> {
          index += 1
        }
        line.startsWith("#EXTINF:") -> {
          val live = line.lowercase().contains(",live")
          val adByUrl = isAdSegment(nextLine)
          val adByInf = isAdExtInf(line)
          val adByCue = insideCueAd && !live
          val adByRange = insideDateRangeAd && (adByUrl || adByInf)
          if (adByUrl || adByInf || adByCue || adByRange) {
            index += if (isMediaUri(nextLine)) 2 else 1
          } else {
            if (insideDateRangeAd && !adByUrl && !adByInf) {
              insideDateRangeAd = false
            }
            kept.add(line)
            index += 1
          }
        }
        else -> {
          kept.add(line)
          index += 1
        }
      }
    }
    return kept.joinToString("\n")
  }

  private fun hasMediaSegments(playlist: String): Boolean {
    return playlist.lineSequence().any { line ->
      val trimmed = line.trim()
      trimmed.isNotEmpty() && !trimmed.startsWith("#")
    }
  }

  private fun isMediaUri(line: String): Boolean {
    val trimmed = line.trim()
    return trimmed.isNotEmpty() && !trimmed.startsWith("#")
  }

  private fun isAdLine(line: String): Boolean {
    return isAdDateRange(line) ||
      isAdCueOut(line) ||
      isAdCueIn(line) ||
      isAdExtInf(line) ||
      isAdSegment(line)
  }

  private fun isAdDateRange(line: String): Boolean {
    if (!line.startsWith("#EXT-X-DATERANGE:")) return false
    val lower = line.lowercase()
    return dateRangePatterns.any(lower::contains)
  }

  private fun isAdCueOut(line: String): Boolean {
    return line.startsWith("#EXT-X-CUE-OUT")
  }

  private fun isAdCueIn(line: String): Boolean {
    return line.startsWith("#EXT-X-CUE-IN")
  }

  private fun isAdExtInf(line: String): Boolean {
    if (!line.startsWith("#EXTINF:")) return false
    val lower = line.lowercase()
    return lower.contains("stitched") || lower.contains("amazon|")
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
        path.split("/").contains("ad") -> true
        path.contains("amazon-ad") || path.contains("stitched-ad") -> true
        else -> false
      }
    } catch (_: Throwable) {
      candidate.lowercase().contains("stitched-ad")
    }
  }
}
