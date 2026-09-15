package expo.modules.streamfusionnativecontracts

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector

internal object PlaybackPreferenceConfig {
  fun loadControl(request: Map<String, Any>): DefaultLoadControl {
    val buffer = mapOrNull(request["buffer"])
    val forwardSec = intOr(buffer?.get("maxBufferLengthSec"), 15).coerceIn(2, 60)
    val maxSec = intOr(buffer?.get("maxMaxBufferLengthSec"), 30).coerceIn(forwardSec, 120)
    val minMs = forwardSec * 1_000
    val maxMs = maxSec * 1_000
    return DefaultLoadControl.Builder()
      .setBufferDurationsMs(minMs, maxMs, 1_000, 2_000)
      .build()
  }

  fun trackSelector(context: Context, request: Map<String, Any>): DefaultTrackSelector {
    val selector = DefaultTrackSelector(context)
    if (request["allowHevc"] == false) {
      selector.setParameters(
        selector.buildUponParameters().setPreferredVideoMimeType(MimeTypes.VIDEO_H264),
      )
    }
    return selector
  }

  fun mediaItem(sourceUri: String, mimeType: String, request: Map<String, Any>): MediaItem {
    return MediaItem.Builder()
      .setUri(sourceUri)
      .setMimeType(mimeType)
      .setLiveConfiguration(
        MediaItem.LiveConfiguration.Builder()
          .setTargetOffsetMs(liveOffsetMs(request))
          .build(),
      )
      .build()
  }

  fun liveOffsetMs(request: Map<String, Any>): Long {
    val buffer = mapOrNull(request["buffer"])
    if (buffer?.get("lowLatencyMode") == true) return 2_000L
    val count = intOr(buffer?.get("liveSyncDurationCount"), 4).coerceIn(2, 12)
    return count * 2_000L
  }

  private fun mapOrNull(value: Any?): Map<*, *>? {
    return value as? Map<*, *>
  }

  private fun intOr(value: Any?, fallback: Int): Int {
    return when (value) {
      is Number -> value.toInt()
      is String -> value.toIntOrNull() ?: fallback
      else -> fallback
    }
  }
}
