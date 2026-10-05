package expo.modules.streamfusionnativecontracts

import android.media.MediaExtractor
import java.io.File

internal object MediaJobPlayableFile {
  fun isPlayable(file: File): Boolean {
    if (!file.isFile || file.length() == 0L) return false
    val extractor = MediaExtractor()
    return try {
      extractor.setDataSource(file.absolutePath)
      (0 until extractor.trackCount).any { index ->
        val mime = extractor.getTrackFormat(index).getString("mime") ?: ""
        if (!mime.startsWith("video/") && !mime.startsWith("audio/")) false
        else {
          extractor.selectTrack(index)
          val playable = extractor.sampleTime >= 0
          extractor.unselectTrack(index)
          playable
        }
      }
    } catch (_: Exception) {
      false
    } finally {
      extractor.release()
    }
  }
}
