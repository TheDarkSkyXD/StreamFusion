package expo.modules.streamfusionnativecontracts

import android.os.StatFs
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit

internal class MediaJobFixtureWriter(
  private val filesDir: File,
  private val paused: () -> Boolean,
  private val canceled: () -> Boolean,
) {
  fun write(
    jobId: String,
    kind: String,
    sourceUri: String,
    file: File,
    durationStartMs: Long,
    onProgress: (written: Long, durationMs: Long, status: String) -> Boolean,
  ): MediaJobDownloadOutcome {
    val limits = MediaJobRecordingLimits.of(kind, sourceUri)
    val compressed = limits != null && sourceUri.contains("cutoff=")
    val target = when {
      compressed -> Long.MAX_VALUE
      kind == "recording" -> 32_768L
      else -> 65_536L
    }
    val pressure = sourceUri.contains("storage-pressure")
    val networkLoss = sourceUri.contains("network-loss")
    val startedAt = System.nanoTime() - TimeUnit.MILLISECONDS.toNanos(durationStartMs)
    var written = if (file.exists()) file.length() else 0L
    RandomAccessFile(file, "rw").use { access ->
      access.seek(written)
      val chunk = ByteArray(4_096) { 0x53 }
      while (written < target) {
        val elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)
        if (limits != null && elapsed >= limits.cutoffMs) {
          return MediaJobDownloadOutcome.Completed(written, limits.status(elapsed), elapsed)
        }
        if (canceled()) return cancelOutcome(kind, written, elapsed)
        if (paused()) return MediaJobDownloadOutcome.Paused(written, elapsed)
        if (pressure && written >= 4_096) {
          return MediaJobDownloadOutcome.Failed("storage-pressure", "Stopped because storage is full.", written)
        }
        if (networkLoss && written >= 4_096) {
          return MediaJobDownloadOutcome.Failed("network-loss", "Stopped because the network was lost.", written)
        }
        if (StatFs(filesDir.absolutePath).availableBytes < 8_192) {
          return MediaJobDownloadOutcome.Failed("storage-pressure", "Stopped because storage is full.", written)
        }
        access.write(chunk)
        written += chunk.size
        android.util.Log.i("SF-MediaJob", "chunk job=$jobId written=$written elapsed=$elapsed")
        val status = limits?.status(elapsed) ?: "Running"
        if (!onProgress(written, elapsed, status)) {
          return MediaJobDownloadOutcome.Failed("interrupted", "Stopped", written)
        }
        waitForChunk(if (compressed) COMPRESSED_SLEEP_MS else CHUNK_SLEEP_MS)
      }
    }
    val elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)
    return MediaJobDownloadOutcome.Completed(written, "Completed", elapsed)
  }

  private fun cancelOutcome(kind: String, written: Long, elapsed: Long): MediaJobDownloadOutcome {
    if (kind == "recording" && written > 0) {
      return MediaJobDownloadOutcome.Completed(
        written,
        MediaJobRecordingLimits.STOPPED_STATUS,
        elapsed,
      )
    }
    return MediaJobDownloadOutcome.Failed("interrupted", "Canceled", written)
  }

  private fun waitForChunk(sleepMs: Long) {
    var remaining = sleepMs
    while (remaining > 0) {
      if (canceled() || paused()) return
      val slice = remaining.coerceAtMost(100L)
      TimeUnit.MILLISECONDS.sleep(slice)
      remaining -= slice
    }
  }

  companion object {
    private const val CHUNK_SLEEP_MS = 2_500L
    private const val COMPRESSED_SLEEP_MS = 400L
  }
}
