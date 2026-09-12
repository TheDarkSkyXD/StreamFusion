package expo.modules.streamfusionnativecontracts

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.StatFs
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

internal class MediaJobEngine(private val context: Context) {
  private val executor = Executors.newCachedThreadPool()
  private val owned = ConcurrentHashMap<String, Boolean>()
  private val workers = ConcurrentHashMap<String, Future<*>>()
  private val pauseFlags = ConcurrentHashMap<String, AtomicBoolean>()
  private val cancelFlags = ConcurrentHashMap<String, AtomicBoolean>()

  fun start(jobId: String, kind: String, sourceUri: String): Map<String, Any?> {
    if (!JOB_ID.matches(jobId) || (kind != "download" && kind != "recording")) {
      return MediaJobCodec.missing(jobId)
    }
    val existing = readJournal(jobId)
    if (existing != null) return snapshot(jobId)
    val now = MediaJobCodec.utcNow()
    writeIntent(jobId, kind, sourceUri, now, 1, "preparing", 0, false, null, "Preparing")
    startService(jobId)
    launchWorker(jobId, kind, sourceUri, 1)
    return snapshot(jobId)
  }

  fun pause(jobId: String): Map<String, Any?> {
    val journal = readJournal(jobId) ?: return MediaJobCodec.missing(jobId)
    pauseFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(true)
    writeJournal(
      jobId,
      journal.optString("kind"),
      journal.optInt("generation"),
      "pausing",
      journal.optJSONObject("checkpoint")?.optLong("byteOffset") ?: 0,
      journal.optJSONObject("checkpoint")?.optLong("durationMs") ?: 0,
      artifactFrom(jobId).first,
      artifactFrom(jobId).second,
      artifactFrom(jobId).third,
      true,
      null,
      "Pausing",
      journal.optString("sourceUri"),
    )
    return snapshot(jobId)
  }

  fun resume(jobId: String): Map<String, Any?> {
    val journal = readJournal(jobId) ?: return MediaJobCodec.missing(jobId)
    pauseFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(false)
    cancelFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(false)
    startService(jobId)
    launchWorker(
      jobId,
      journal.optString("kind"),
      journal.optString("sourceUri"),
      journal.optInt("generation"),
    )
    return snapshot(jobId)
  }

  fun cancel(jobId: String): Map<String, Any?> {
    val journal = readJournal(jobId) ?: return MediaJobCodec.missing(jobId)
    cancelFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(true)
    workers.remove(jobId)?.cancel(true)
    owned.remove(jobId)
    val artifact = artifactFrom(jobId)
    writeJournal(
      jobId,
      journal.optString("kind"),
      journal.optInt("generation"),
      "canceled",
      artifact.second,
      journal.optJSONObject("checkpoint")?.optLong("durationMs") ?: 0,
      artifact.first,
      artifact.second,
      artifact.third,
      false,
      null,
      "Canceled",
      journal.optString("sourceUri"),
    )
    stopServiceIfIdle()
    return snapshot(jobId)
  }

  fun retry(jobId: String): Map<String, Any?> {
    val journal = readJournal(jobId) ?: return MediaJobCodec.missing(jobId)
    val nextGeneration = journal.optInt("generation").coerceAtLeast(1) + 1
    pauseFlags[jobId] = AtomicBoolean(false)
    cancelFlags[jobId] = AtomicBoolean(false)
    writeJournal(
      jobId,
      journal.optString("kind"),
      nextGeneration,
      "queued",
      artifactFrom(jobId).second,
      0,
      artifactFrom(jobId).first,
      artifactFrom(jobId).second,
      false,
      false,
      null,
      "Queued",
      journal.optString("sourceUri"),
    )
    startService(jobId)
    launchWorker(jobId, journal.optString("kind"), journal.optString("sourceUri"), nextGeneration)
    return snapshot(jobId)
  }

  fun finalize(jobId: String): Map<String, Any?> {
    val journal = readJournal(jobId) ?: return MediaJobCodec.missing(jobId)
    cancelFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(true)
    workers.remove(jobId)?.cancel(true)
    completeArtifact(jobId)
    val artifact = artifactFrom(jobId)
    writeJournal(
      jobId,
      journal.optString("kind"),
      journal.optInt("generation"),
      "completed",
      artifact.second,
      journal.optJSONObject("checkpoint")?.optLong("durationMs") ?: 0,
      if (artifact.second > 0) "complete" else "none",
      artifact.second,
      true,
      false,
      null,
      "Completed",
      journal.optString("sourceUri"),
    )
    owned.remove(jobId)
    stopServiceIfIdle()
    return snapshot(jobId)
  }

  fun recover(): List<Map<String, Any?>> {
    val root = jobsRoot()
    if (!root.isDirectory) return emptyList()
    return root.listFiles().orEmpty()
      .filter { it.isDirectory }
      .mapNotNull { dir -> readJournal(dir.name)?.let { snapshot(dir.name)["value"] as? Map<String, Any?> } }
  }

  fun get(jobId: String): Map<String, Any?> {
    if (readJournal(jobId) == null) return MediaJobCodec.missing(jobId)
    return snapshot(jobId)
  }

  fun isOwned(jobId: String): Boolean = owned.containsKey(jobId)

  private fun launchWorker(jobId: String, kind: String, sourceUri: String, generation: Int) {
    workers[jobId]?.cancel(true)
    owned[jobId] = true
    pauseFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(false)
    cancelFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(false)
    workers[jobId] = executor.submit {
      runCatching { writeChunks(jobId, kind, sourceUri, generation) }
    }
  }

  private fun writeChunks(jobId: String, kind: String, sourceUri: String, generation: Int) {
    val target = if (kind == "recording") 32_768L else 65_536L
    val pressure = sourceUri.contains("storage-pressure")
    val file = artifactFile(jobId)
    file.parentFile?.mkdirs()
    var written = if (file.exists()) file.length() else 0L
    writeJournal(jobId, kind, generation, "running", written, written / 32, artifactKind(written, false), written, false, true, null, "Running", sourceUri)
    RandomAccessFile(file, "rw").use { access ->
      access.seek(written)
      val chunk = ByteArray(4_096) { 0x53 }
      while (written < target) {
        if (cancelFlags[jobId]?.get() == true) return
        if (pauseFlags[jobId]?.get() == true) {
          writeJournal(jobId, kind, generation, "paused", written, written / 32, artifactKind(written, false), written, false, false, null, "Paused", sourceUri)
          owned.remove(jobId)
          stopServiceIfIdle()
          return
        }
        if (pressure && written >= 4_096) {
          writeJournal(jobId, kind, generation, "failed-retryable", written, written / 32, "partial", written, false, false, "storage-pressure", "Stopped because storage is full.", sourceUri)
          owned.remove(jobId)
          stopServiceIfIdle()
          return
        }
        val available = StatFs(context.filesDir.absolutePath).availableBytes
        if (available < 8_192) {
          writeJournal(jobId, kind, generation, "failed-retryable", written, written / 32, artifactKind(written, false), written, false, false, "storage-pressure", "Stopped because storage is full.", sourceUri)
          owned.remove(jobId)
          stopServiceIfIdle()
          return
        }
        access.write(chunk)
        written += chunk.size
        writeJournal(jobId, kind, generation, "running", written, written / 32, "partial", written, false, true, null, "Running", sourceUri)
        TimeUnit.MILLISECONDS.sleep(120)
      }
    }
    completeArtifact(jobId)
    writeJournal(jobId, kind, generation, "completed", target, target / 32, "complete", target, true, false, null, "Completed", sourceUri)
    owned.remove(jobId)
    stopServiceIfIdle()
  }

  private fun snapshot(jobId: String): Map<String, Any?> {
    val journal = readJournal(jobId) ?: return MediaJobCodec.missing(jobId)
    val artifact = artifactFrom(jobId)
    val files = if (artifact.second > 0 || artifact.third) {
      MediaJobCodec.filesMap("media-jobs/$jobId/artifact.bin", artifact.second, artifact.third)
    } else {
      null
    }
    val mapped = MediaJobCodec.journalMap(
      jobId,
      journal.optString("kind"),
      journal.optInt("generation"),
      journal.optString("phase"),
      journal.optJSONObject("checkpoint")?.optLong("byteOffset") ?: artifact.second,
      journal.optJSONObject("checkpoint")?.optLong("durationMs") ?: 0,
      journal.optJSONObject("checkpoint")?.optString("updatedAt") ?: MediaJobCodec.utcNow(),
      if (artifact.third) "complete" else if (artifact.second > 0) "partial" else "none",
      if (artifact.second > 0 || artifact.third) "media-jobs/$jobId/artifact.bin" else null,
      artifact.second,
      owned.containsKey(jobId),
      journal.optString("failureCode").ifEmpty { null },
      journal.optString("statusMessage"),
    )
    return MediaJobCodec.record(mapped, files)
  }

  private fun writeIntent(
    jobId: String,
    kind: String,
    sourceUri: String,
    now: String,
    generation: Int,
    phase: String,
    bytes: Long,
    complete: Boolean,
    failure: String?,
    status: String,
  ) {
    writeJournal(jobId, kind, generation, phase, bytes, 0, artifactKind(bytes, complete), bytes, complete, true, failure, status, sourceUri)
  }

  private fun writeJournal(
    jobId: String,
    kind: String,
    generation: Int,
    phase: String,
    byteOffset: Long,
    durationMs: Long,
    artifactKind: String,
    artifactBytes: Long,
    complete: Boolean,
    serviceOwned: Boolean,
    failure: String?,
    status: String,
    sourceUri: String,
  ) {
    val now = MediaJobCodec.utcNow()
    val relative = if (artifactBytes > 0 || complete) "media-jobs/$jobId/artifact.bin" else null
    val journal = MediaJobCodec.journalMap(
      jobId, kind, generation, phase, byteOffset, durationMs, now,
      artifactKind, relative, artifactBytes, serviceOwned, failure, status,
    ).toMutableMap()
    journal["sourceUri"] = sourceUri
    MediaJobCodec.writeJson(journalFile(jobId), journal)
  }

  private fun startService(jobId: String) {
    val intent = Intent(context, MediaJobForegroundService::class.java).putExtra("jobId", jobId)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
  }

  private fun stopServiceIfIdle() {
    if (owned.isEmpty()) {
      context.stopService(Intent(context, MediaJobForegroundService::class.java))
    }
  }

  private fun jobsRoot(): File = File(context.filesDir, "media-jobs")
  private fun jobDir(jobId: String): File = File(jobsRoot(), jobId)
  private fun journalFile(jobId: String): File = File(jobDir(jobId), "journal.json")
  private fun artifactFile(jobId: String): File = File(jobDir(jobId), "artifact.bin")
  private fun completeFile(jobId: String): File = File(jobDir(jobId), "artifact.bin.complete")
  private fun readJournal(jobId: String) = MediaJobCodec.readJson(journalFile(jobId))
  private fun completeArtifact(jobId: String) {
    artifactFile(jobId).parentFile?.mkdirs()
    if (!artifactFile(jobId).exists()) artifactFile(jobId).writeBytes(ByteArray(0))
    completeFile(jobId).writeText("complete")
  }
  private fun artifactFrom(jobId: String): Triple<String, Long, Boolean> {
    val bytes = if (artifactFile(jobId).exists()) artifactFile(jobId).length() else 0L
    val complete = completeFile(jobId).isFile
    return Triple(artifactKind(bytes, complete), bytes, complete)
  }
  private fun artifactKind(bytes: Long, complete: Boolean): String =
    if (complete) "complete" else if (bytes > 0) "partial" else "none"

  companion object {
    private val JOB_ID = Regex("^[a-zA-Z0-9._:-]{1,256}$")
    @Volatile private var instance: MediaJobEngine? = null
    fun get(context: Context): MediaJobEngine {
      val current = instance
      if (current != null) return current
      return synchronized(this) {
        instance ?: MediaJobEngine(context.applicationContext).also { instance = it }
      }
    }
  }
}
