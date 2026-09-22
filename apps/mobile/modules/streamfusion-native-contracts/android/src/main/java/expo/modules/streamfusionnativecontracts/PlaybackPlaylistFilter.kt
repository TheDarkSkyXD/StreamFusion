package expo.modules.streamfusionnativecontracts

object PlaybackPlaylistFilter {
  private val adHosts = setOf(
    "d2nvs31859zcd8.cloudfront.net",
    "d2vjef5jvl6bfs.cloudfront.net",
  )
  private val dateRangePatterns = listOf(
    "stitched-ad",
    "twitch-stitched-ad",
    "amazon-ad",
    "com.twitch.tv/ad",
    "x-tv-twitch-ad",
  )
  private val mediaBearingTags = listOf(
    "#EXTINF",
    "#EXT-X-BYTERANGE",
    "#EXT-X-MAP",
    "#EXT-X-PART",
    "#EXT-X-PRELOAD-HINT",
    "#EXT-X-RENDITION-REPORT",
    "#EXT-X-TWITCH-PREFETCH",
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
    // Desktop no-backup path always holdUnsafe after ads (never surgically
    // serve leftover ,live rows). Mobile has no ULW backup orchestrator, so
    // match that: any ad-marked playlist is held without media. Surgical strip
    // previously kept post-DISCONTINUITY ,live commercial-break slates on the
    // weaver host, which painted the Twitch interstitial for ~15s.
    val neutralized = neutralizeTrackingUrls(playlist)
    val held = holdUnsafeMediaPlaylist(neutralized)
    return Result(
      true,
      true,
      "Ads detected; held without media (desktop unsafe-hold, no backup).",
      held,
    )
  }

  fun hasAds(playlist: String): Boolean {
    val lower = playlist.lowercase()
    if (lower.contains("stitched") || lower.contains("amazon|") || lower.contains("x-tv-twitch-ad")) {
      return true
    }
    return playlist.lineSequence().any { isAdLine(it) }
  }

  /** Desktop-equivalent of holdUnsafeTwitchMediaPlaylist: drop media so the player holds. */
  fun holdUnsafeMediaPlaylist(playlist: String): String {
    return playlist
      .replace("\r", "")
      .split("\n")
      .filter { line ->
        val trimmed = line.trim()
        if (trimmed.isEmpty() || !trimmed.startsWith("#")) {
          false
        } else {
          mediaBearingTags.none { tag -> trimmed.startsWith(tag) }
        }
      }
      .joinToString("\n")
  }

  private fun keep(
    playlist: String,
    diagnostic: String,
    adsDetected: Boolean = false,
  ): Result {
    return Result(adsDetected, false, diagnostic, playlist)
  }

  private fun neutralizeTrackingUrls(playlist: String): String {
    return playlist
      .replace(Regex("""(X-TV-TWITCH-AD-URL=")[^"]*(")"""), "$1https://twitch.tv$2")
      .replace(
        Regex("""(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")[^"]*(")"""),
        "$1https://twitch.tv$2",
      )
  }

  private fun isAdLine(line: String): Boolean {
    return isAdDateRange(line) ||
      isAdCueOut(line) ||
      isAdCueIn(line) ||
      isScte35(line) ||
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

  private fun isScte35(line: String): Boolean {
    return line.startsWith("#EXT-OATCLS-SCTE35:") ||
      line.startsWith("#EXT-X-SCTE35:") ||
      line.contains("SCTE35-OUT=")
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
        host.endsWith(".cloudfront.net") && path.split("/").contains("ad") -> true
        path.split("/").contains("ad") -> true
        path.contains("amazon-ad") || path.contains("stitched-ad") -> true
        else -> false
      }
    } catch (_: Throwable) {
      candidate.lowercase().contains("stitched-ad")
    }
  }
}
