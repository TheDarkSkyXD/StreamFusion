package expo.modules.streamfusionnativecontracts

import android.net.Uri
import androidx.media3.common.MimeTypes

/**
 * Accepts the same HTTPS Watch sources JS allows via [asHttpsPlaybackSourceUri]:
 * Twitch/Kick .m3u8 and .mp4 URLs, plus playlist-proxy live templates that omit
 * `.m3u8` (ExoPlayer follows redirects to HLS).
 */
object PlaybackSourceUri {
  fun isAcceptedHttpsMedia(sourceUri: String): Boolean {
    val uri = Uri.parse(sourceUri)
    if (uri.scheme != "https") return false
    if (uri.host.isNullOrBlank()) return false
    val path = uri.path.orEmpty().lowercase()
    if (path.contains(".m3u8") || path.endsWith(".mp4")) return true
    // Playlist-proxy templates are typically /live/$channel with no extension.
    return path.isNotEmpty()
  }

  fun mimeTypeFor(sourceUri: String): String {
    val lower = sourceUri.lowercase()
    val path = Uri.parse(sourceUri).path.orEmpty().lowercase()
    return if (path.endsWith(".mp4") && !lower.contains(".m3u8")) {
      MimeTypes.APPLICATION_MP4
    } else {
      // HLS for .m3u8 and extension-less playlist-proxy live URLs.
      MimeTypes.APPLICATION_M3U8
    }
  }
}
