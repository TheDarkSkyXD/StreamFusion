package expo.modules.streamfusionnativecontracts

import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.concurrent.TimeUnit

internal sealed class MediaJobDownloadOutcome {
  data class Completed(
    val bytes: Long,
    val status: String = "Completed",
    val durationMs: Long = bytes / 32,
  ) : MediaJobDownloadOutcome()
  data class Paused(
    val bytes: Long,
    val durationMs: Long = bytes / 32,
  ) : MediaJobDownloadOutcome()
  data class Failed(
    val code: String,
    val message: String,
    val bytes: Long,
  ) : MediaJobDownloadOutcome()
}

internal class MediaJobSourceDownloader(
  private val headers: Map<String, String>,
  private val paused: () -> Boolean,
  private val canceled: () -> Boolean,
) {
  fun download(
    sourceUri: String,
    file: File,
    startOffset: Long,
    onProgress: (written: Long, total: Long?) -> Boolean,
  ): MediaJobDownloadOutcome {
    return transfer(null, sourceUri, file, startOffset, 0, onProgress)
  }

  fun transfer(
    limits: MediaJobRecordingLimits?,
    sourceUri: String,
    file: File,
    startOffset: Long,
    durationStartMs: Long,
    onProgress: (written: Long, total: Long?) -> Boolean,
  ): MediaJobDownloadOutcome {
    return runCatching {
      when {
        looksLikePlaylist(sourceUri) && limits != null ->
          recordHls(limits, sourceUri, file, startOffset, durationStartMs, onProgress)
        looksLikePlaylist(sourceUri) ->
          downloadHls(sourceUri, file, startOffset, onProgress)
        else ->
          downloadHttp(sourceUri, file, startOffset, onProgress)
      }
    }.getOrElse { error ->
      android.util.Log.e("MediaJobHttp", "download failed for $sourceUri", error)
      MediaJobDownloadOutcome.Failed(
        "network-loss",
        "Stopped because the network was lost.",
        if (file.exists()) file.length() else startOffset,
      )
    }
  }

  private fun downloadHttp(
    sourceUri: String,
    file: File,
    startOffset: Long,
    onProgress: (written: Long, total: Long?) -> Boolean,
  ): MediaJobDownloadOutcome {
    MediaJobHttpClient.open(sourceUri, startOffset, headers).use { response ->
      val code = response.code
      android.util.Log.i("MediaJobHttp", "code=$code writtenStart=$startOffset")
      if (startOffset > 0 && code == HttpURLConnection.HTTP_OK) {
        return MediaJobDownloadOutcome.Failed(
          "interrupted",
          "This source does not support range resume.",
          startOffset,
        )
      }
      if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL) {
        return MediaJobDownloadOutcome.Failed(
          "source-unavailable",
          "The download source rejected the request ($code).",
          startOffset,
        )
      }
      val total = totalFromHeaders(response, startOffset, code)
      file.parentFile?.mkdirs()
      var written = if (file.exists()) file.length() else 0L
      val sessionStart = written
      RandomAccessFile(file, "rw").use { access ->
        access.seek(written)
        val buffer = ByteArray(4_096)
        while (true) {
          if (canceled()) {
            return MediaJobDownloadOutcome.Failed("interrupted", "Canceled", written)
          }
          val read = response.input.read(buffer)
          if (read <= 0) break
          access.write(buffer, 0, read)
          written += read
          if (!onProgress(written, total)) {
            return MediaJobDownloadOutcome.Failed("interrupted", "Stopped", written)
          }
          if (written > sessionStart && paused()) {
            return MediaJobDownloadOutcome.Paused(written)
          }
          if (startOffset == 0L) {
            TimeUnit.MILLISECONDS.sleep(HTTP_CHUNK_SLEEP_MS)
          }
        }
      }
      return MediaJobDownloadOutcome.Completed(written)
    }
  }

  private fun downloadHls(
    sourceUri: String,
    file: File,
    startOffset: Long,
    onProgress: (written: Long, total: Long?) -> Boolean,
  ): MediaJobDownloadOutcome {
    val mediaPlaylist = resolveMediaPlaylist(sourceUri)
    val segments = parseSegmentUris(mediaPlaylist.first, mediaPlaylist.second)
    if (segments.isEmpty()) {
      return MediaJobDownloadOutcome.Failed(
        "source-unavailable",
        "The playlist did not contain downloadable segments.",
        startOffset,
      )
    }
    file.parentFile?.mkdirs()
    var written = if (file.exists()) file.length() else 0L
    RandomAccessFile(file, "rw").use { access ->
      access.seek(written)
      var skipped = 0L
      for (segment in segments) {
        if (canceled()) return MediaJobDownloadOutcome.Failed("interrupted", "Canceled", written)
        if (paused()) return MediaJobDownloadOutcome.Paused(written)
        val length = contentLength(segment)
        if (skipped + length <= written && length > 0) {
          skipped += length
          continue
        }
        val connection = open(segment, 0)
        if (connection.responseCode !in 200..299) {
          connection.disconnect()
          return MediaJobDownloadOutcome.Failed(
            "network-loss",
            "Stopped because the network was lost.",
            written,
          )
        }
        try {
          connection.inputStream.use { input ->
            val buffer = ByteArray(4_096)
            while (true) {
              if (canceled()) {
                return MediaJobDownloadOutcome.Failed("interrupted", "Canceled", written)
              }
              if (paused()) return MediaJobDownloadOutcome.Paused(written)
              val read = input.read(buffer)
              if (read <= 0) break
              access.write(buffer, 0, read)
              written += read
              if (!onProgress(written, null)) {
                return MediaJobDownloadOutcome.Failed("interrupted", "Stopped", written)
              }
            }
          }
        } finally {
          connection.disconnect()
        }
        skipped = written
      }
    }
    return MediaJobDownloadOutcome.Completed(written)
  }

  private fun recordHls(
    limits: MediaJobRecordingLimits,
    sourceUri: String,
    file: File,
    startOffset: Long,
    durationStartMs: Long,
    onProgress: (written: Long, total: Long?) -> Boolean,
  ): MediaJobDownloadOutcome {
    val startedAt = System.nanoTime() - TimeUnit.MILLISECONDS.toNanos(durationStartMs)
    val seen = linkedSetOf<String>()
    file.parentFile?.mkdirs()
    var written = if (file.exists()) file.length() else startOffset
    RandomAccessFile(file, "rw").use { access ->
      access.seek(written)
      while (true) {
        recordingGate(limits, written, elapsedMs(startedAt))?.let { return it }
        val mediaPlaylist = resolveMediaPlaylist(sourceUri)
        val segments = parseSegmentUris(mediaPlaylist.first, mediaPlaylist.second)
        for (segment in segments) {
          if (!seen.add(segment)) continue
          recordingGate(limits, written, elapsedMs(startedAt))?.let { return it }
          val connection = open(segment, 0)
          if (connection.responseCode !in 200..299) {
            connection.disconnect()
            return MediaJobDownloadOutcome.Failed(
              "network-loss",
              "Stopped because the network was lost.",
              written,
            )
          }
          try {
            connection.inputStream.use { input ->
              val buffer = ByteArray(4_096)
              while (true) {
                stopIfCanceledOrPaused(written, elapsedMs(startedAt))?.let { return it }
                val read = input.read(buffer)
                if (read <= 0) break
                access.write(buffer, 0, read)
                written += read
                val now = elapsedMs(startedAt)
                if (!onProgress(written, null)) {
                  return MediaJobDownloadOutcome.Failed("interrupted", "Stopped", written)
                }
                completeIfCutoff(limits, written, now)?.let { return it }
              }
            }
          } finally {
            connection.disconnect()
          }
        }
        TimeUnit.MILLISECONDS.sleep(500)
      }
    }
  }

  private fun open(sourceUri: String, rangeStart: Long): HttpURLConnection {
    val connection = URL(sourceUri).openConnection() as HttpURLConnection
    connection.connectTimeout = 15_000
    connection.readTimeout = 15_000
    connection.instanceFollowRedirects = true
    connection.useCaches = false
    headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
    connection.setRequestProperty("Connection", "close")
    if (rangeStart > 0) {
      connection.setRequestProperty("Range", "bytes=$rangeStart-")
    }
    android.util.Log.i("MediaJobHttp", "connect $sourceUri range=$rangeStart")
    connection.connect()
    android.util.Log.i("MediaJobHttp", "code=${connection.responseCode} ${connection.responseMessage}")
    return connection
  }

  private fun contentLength(sourceUri: String): Long {
    val connection = open(sourceUri, 0)
    val length = connection.contentLengthLong.takeIf { it > 0 } ?: 0L
    connection.disconnect()
    return length
  }

  private fun resolveMediaPlaylist(sourceUri: String): Pair<String, String> {
    val body = readText(sourceUri)
    if (!body.contains("#EXT-X-STREAM-INF")) return sourceUri to body
    val variant = highestBandwidthUri(sourceUri, body) ?: sourceUri
    return variant to readText(variant)
  }

  private fun readText(sourceUri: String): String {
    val connection = open(sourceUri, 0)
    val text = connection.inputStream.bufferedReader().use { it.readText() }
    connection.disconnect()
    return text
  }

  private fun highestBandwidthUri(playlistUri: String, body: String): String? {
    var best: Pair<Int, String>? = null
    val lines = body.lines()
    var index = 0
    while (index < lines.size) {
      val line = lines[index]
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        val bandwidth = Regex("BANDWIDTH=(\\d+)").find(line)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        val next = lines.getOrNull(index + 1)?.trim().orEmpty()
        if (next.isNotEmpty() && !next.startsWith("#")) {
          if (best == null || bandwidth >= best.first) {
            best = bandwidth to resolveUri(playlistUri, next)
          }
        }
      }
      index += 1
    }
    return best?.second
  }

  private fun parseSegmentUris(playlistUri: String, body: String): List<String> =
    body.lines()
      .map { it.trim() }
      .filter { it.isNotEmpty() && !it.startsWith("#") }
      .map { resolveUri(playlistUri, it) }

  private fun resolveUri(base: String, relative: String): String {
    if (relative.startsWith("http://") || relative.startsWith("https://")) return relative
    return URI(base).resolve(relative).toString()
  }

  private fun looksLikePlaylist(sourceUri: String): Boolean {
    val lower = sourceUri.lowercase()
    return lower.contains(".m3u8") || lower.contains("m3u8?")
  }

  private fun elapsedMs(startedAt: Long): Long =
    TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)

  private fun recordingGate(
    limits: MediaJobRecordingLimits,
    written: Long,
    elapsed: Long,
  ): MediaJobDownloadOutcome? {
    completeIfCutoff(limits, written, elapsed)?.let { return it }
    return stopIfCanceledOrPaused(written, elapsed)
  }

  private fun completeIfCutoff(
    limits: MediaJobRecordingLimits,
    written: Long,
    elapsed: Long,
  ): MediaJobDownloadOutcome? {
    if (elapsed < limits.cutoffMs) return null
    return MediaJobDownloadOutcome.Completed(written, limits.status(elapsed), elapsed)
  }

  private fun stopIfCanceledOrPaused(
    written: Long,
    elapsed: Long,
  ): MediaJobDownloadOutcome? {
    if (canceled()) {
      return MediaJobDownloadOutcome.Completed(
        written,
        MediaJobRecordingLimits.STOPPED_STATUS,
        elapsed,
      )
    }
    if (paused()) return MediaJobDownloadOutcome.Paused(written, elapsed)
    return null
  }

  private fun totalFromHeaders(
    response: MediaJobHttpStream,
    startOffset: Long,
    code: Int,
  ): Long? {
    if (code == HttpURLConnection.HTTP_PARTIAL) {
      val range = response.header("Content-Range") ?: return null
      return range.substringAfter("/", "").toLongOrNull()?.takeIf { it > 0 }
    }
    val length = response.header("Content-Length")?.toLongOrNull() ?: return null
    if (length <= 0) return null
    return if (startOffset > 0) startOffset + length else length
  }

  companion object {
    private const val HTTP_CHUNK_SLEEP_MS = 50L
  }
}
