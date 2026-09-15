package expo.modules.streamfusionnativecontracts

import android.content.Context
import android.content.Intent
import android.os.Build
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

internal class MediaJobEngine(private val context: Context) {
  private val executor = Executors.newCachedThreadPool()
  private val journalGuard = Any()
  private val owned = ConcurrentHashMap<String, Boolean>()
  private val workers = ConcurrentHashMap<String, Future<*>>()
  private val pauseFlags = ConcurrentHashMap<String, AtomicBoolean>()
  private val cancelFlags = ConcurrentHashMap<String, AtomicBoolean>()

  fun start(
    jobId: String,
    kind: String,
    sourceUri: String,
    requestHeaders: Map<String, String> = emptyMap(),
  ): Map<String, Any?> {
    if (!MediaJobCodec.isValidJobId(jobId) || (kind != "download" && kind != "recording")) {
      return MediaJobCodec.missing(jobId)
    }
    val existing = readJournal(jobId)
    if (existing != null) return snapshot(jobId)
    val now = MediaJobCodec.utcNow()
    writeIntent(jobId, kind, sourceUri, now, 1, "preparing", 0, false, null, "Preparing")
    writeHeaders(jobId, requestHeaders)
    startService(jobId)
    launchWorker(jobId, kind, sourceUri, 1)
    return snapshot(jobId)
  }

  fun pause(jobId: String): Map<String, Any?> {
    val journal = journalOrMissing(jobId) ?: return MediaJobCodec.missing(jobId)
    pauseFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(true)
    val workerRunning = workers[jobId]?.isDone == false
    val artifact = artifactFrom(jobId)
    writeJournal(
      jobId,
      journal.optString("kind"),
      journal.optInt("generation"),
      if (workerRunning) "pausing" else "paused",
      journal.optJSONObject("checkpoint")?.optLong("byteOffset") ?: 0,
      journalDurationMs(journal),
      artifact.first,
      artifact.second,
      artifact.third,
      workerRunning,
      null,
      if (workerRunning) "Pausing" else "Paused",
      journal.optString("sourceUri"),
    )
    if (!workerRunning) {
      owned.remove(jobId)
      stopServiceIfIdle()
    }
    return snapshot(jobId)
  }

  fun resume(jobId: String): Map<String, Any?> {
    val journal = journalOrMissing(jobId) ?: return MediaJobCodec.missing(jobId)
    awaitWorkerExit(jobId)
    clearControlFlags(jobId)
    startService(jobId)
    launchWorker(
      jobId,
      journal.optString("kind"),
      journal.optString("sourceUri"),
      journal.optInt("generation"),
    )
    awaitJournalAdvance(jobId, "paused")
    return snapshot(jobId)
  }

  fun cancel(jobId: String): Map<String, Any?> {
    val journal = journalOrMissing(jobId) ?: return MediaJobCodec.missing(jobId)
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
      journalDurationMs(journal),
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
    val journal = journalOrMissing(jobId) ?: return MediaJobCodec.missing(jobId)
    val nextGeneration = journal.optInt("generation").coerceAtLeast(1) + 1
    pauseFlags[jobId] = AtomicBoolean(false)
    cancelFlags[jobId] = AtomicBoolean(false)
    val artifact = artifactFrom(jobId)
    writeJournal(
      jobId,
      journal.optString("kind"),
      nextGeneration,
      "queued",
      artifact.second,
      0,
      artifact.first,
      artifact.second,
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
    val journal = journalOrMissing(jobId) ?: return MediaJobCodec.missing(jobId)
    cancelFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(true)
    workers.remove(jobId)?.cancel(true)
    completeArtifact(jobId)
    val artifact = artifactFrom(jobId)
    val duration = journalDurationMs(journal)
    val stopped = if (journal.optString("kind") == "recording" && artifact.second > 0) {
      MediaJobRecordingLimits.STOPPED_STATUS
    } else {
      "Completed"
    }
    writeJournal(
      jobId,
      journal.optString("kind"),
      journal.optInt("generation"),
      "completed",
      artifact.second,
      duration,
      if (artifact.second > 0) "complete" else "none",
      artifact.second,
      true,
      false,
      null,
      stopped,
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
      .filter { it.isDirectory && MediaJobCodec.isValidJobId(it.name) }
      .mapNotNull { dir -> readJournal(dir.name)?.let { snapshot(dir.name)["value"] as? Map<String, Any?> } }
  }

  fun restoreOwnedJobs(): List<String> {
    val restored = mutableListOf<String>()
    for (dir in jobsRoot().listFiles().orEmpty()) {
      if (!dir.isDirectory || !MediaJobCodec.isValidJobId(dir.name)) continue
      val journal = readJournal(dir.name) ?: continue
      val phase = journal.optString("phase")
      if (phase == "pausing" && workers[dir.name]?.isDone != false) {
        writePausedWithoutWorker(dir.name, journal)
        continue
      }
      if (!journal.optBoolean("serviceOwned") || phase !in ACTIVE_PHASES) continue
      if (workers[dir.name]?.isDone == false) {
        restored.add(dir.name)
        continue
      }
      launchWorker(
        dir.name,
        journal.optString("kind"),
        journal.optString("sourceUri"),
        journal.optInt("generation"),
      )
      restored.add(dir.name)
    }
    return restored
  }

  fun get(jobId: String): Map<String, Any?> {
    if (journalOrMissing(jobId) == null) return MediaJobCodec.missing(jobId)
    return snapshot(jobId)
  }

  fun delete(jobId: String): Map<String, Any?> {
    val journal = journalOrMissing(jobId) ?: return MediaJobCodec.missing(jobId)
    cancelFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(true)
    workers.remove(jobId)?.cancel(true)
    owned.remove(jobId)
    val directory = jobDir(jobId)
    if (directory != null) MediaJobExport.deleteTree(directory)
    stopServiceIfIdle()
    return mapOf(
      "kind" to "completed",
      "value" to mapOf("kind" to "deleted", "jobId" to jobId, "previousPhase" to journal.optString("phase")),
    )
  }

  fun exportTo(jobId: String, destination: android.net.Uri): Map<String, Any?> {
    if (journalOrMissing(jobId) == null) return MediaJobCodec.missing(jobId)
    val artifact = artifactFile(jobId)
    if (artifact == null || !artifact.isFile) {
      return mapOf(
        "kind" to "completed",
        "value" to mapOf("kind" to "missing", "jobId" to jobId),
      )
    }
    val hashes = MediaJobExport.copyToUri(context, artifact, destination)
    return mapOf(
      "kind" to "completed",
      "value" to mapOf(
        "kind" to "exported",
        "jobId" to jobId,
        "sourceSha256" to hashes.first,
        "destinationSha256" to hashes.second,
        "matched" to (hashes.first == hashes.second),
        "destinationUri" to destination.toString(),
      ),
    )
  }

  fun open(jobId: String): Map<String, Any?> {
    if (journalOrMissing(jobId) == null) return MediaJobCodec.missing(jobId)
    val artifact = artifactFile(jobId)
    val opened = artifact != null && MediaJobExport.open(context, artifact)
    return mapOf(
      "kind" to "completed",
      "value" to mapOf(
        "kind" to if (opened) "opened" else "unavailable",
        "jobId" to jobId,
      ),
    )
  }

  fun artifactSha256(jobId: String): Map<String, Any?> {
    if (journalOrMissing(jobId) == null) return MediaJobCodec.missing(jobId)
    val artifact = artifactFile(jobId)
    if (artifact == null || !artifact.isFile) {
      return mapOf(
        "kind" to "completed",
        "value" to mapOf("kind" to "missing", "jobId" to jobId),
      )
    }
    return mapOf(
      "kind" to "completed",
      "value" to mapOf(
        "kind" to "hash",
        "jobId" to jobId,
        "sha256" to MediaJobExport.sha256(artifact),
        "bytes" to artifact.length().toDouble(),
      ),
    )
  }

  fun isOwned(jobId: String): Boolean = owned.containsKey(jobId)

  private fun awaitJournalAdvance(jobId: String, fromPhase: String) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8)
    while (System.nanoTime() < deadline) {
      val phase = readJournal(jobId)?.optString("phase")
      if (phase != null && phase != fromPhase) return
      if (workers[jobId]?.isDone == true) return
      TimeUnit.MILLISECONDS.sleep(50)
    }
  }

  private fun clearControlFlags(jobId: String) {
    pauseFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(false)
    cancelFlags.getOrPut(jobId) { AtomicBoolean(false) }.set(false)
  }

  private fun awaitWorkerExit(jobId: String) {
    val previous = workers[jobId] ?: return
    if (previous.isDone) return
    runCatching { previous.get(8, TimeUnit.SECONDS) }
  }

  private fun launchWorker(jobId: String, kind: String, sourceUri: String, generation: Int) {
    awaitWorkerExit(jobId)
    owned[jobId] = true
    pauseFlags[jobId] = AtomicBoolean(false)
    cancelFlags[jobId] = AtomicBoolean(false)
    workers[jobId] = executor.submit {
      runCatching { writeChunks(jobId, kind, sourceUri, generation) }
    }
  }

  private fun writeChunks(jobId: String, kind: String, sourceUri: String, generation: Int) {
    if (!MediaJobCodec.isValidJobId(jobId)) return
    val file = artifactFile(jobId) ?: return
    file.parentFile?.mkdirs()
    val writtenStart = if (file.exists()) file.length() else 0L
    val durationStart = readJournal(jobId)?.let(::journalDurationMs) ?: 0
    val startedAt = System.nanoTime() - TimeUnit.MILLISECONDS.toNanos(durationStart)
    if (!writeIfWorkerOwns(jobId, kind, generation, "running", writtenStart, durationStart, artifactKind(writtenStart, false), writtenStart, false, true, null, "Running", sourceUri)) {
      return
    }
    val limits = MediaJobRecordingLimits.of(kind, sourceUri)
    val outcome = when {
      sourceUri.startsWith("http://") || sourceUri.startsWith("https://") ->
        MediaJobSourceDownloader(readHeaders(jobId), { pauseFlags[jobId]?.get() == true }, { cancelFlags[jobId]?.get() == true })
          .transfer(limits, sourceUri, file, writtenStart, durationStart) { written, total ->
            val elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)
            val status = when {
              limits != null -> limits.status(elapsed)
              total != null -> "Running · $written of $total bytes"
              else -> "Running"
            }
            writeIfWorkerOwns(jobId, kind, generation, "running", written, elapsed, "partial", written, false, true, null, status, sourceUri)
          }
      else -> MediaJobFixtureWriter(
        context.filesDir,
        { pauseFlags[jobId]?.get() == true },
        { cancelFlags[jobId]?.get() == true },
      ).write(jobId, kind, sourceUri, file, durationStart) { written, durationMs, status ->
        writeIfWorkerOwns(jobId, kind, generation, "running", written, durationMs, "partial", written, false, true, null, status, sourceUri)
      }
    }
    when (outcome) {
      is MediaJobDownloadOutcome.Paused -> {
        val bytes = outcome.bytes
        writeIfWorkerOwns(jobId, kind, generation, "paused", bytes, outcome.durationMs, artifactKind(bytes, false), bytes, false, false, null, "Paused", sourceUri)
        owned.remove(jobId)
        stopServiceIfIdle()
      }
      is MediaJobDownloadOutcome.Failed -> {
        if (kind == "recording" && outcome.code == "interrupted" && outcome.bytes > 0) {
          completeIfWorkerOwns(
            jobId,
            kind,
            sourceUri,
            generation,
            outcome.bytes,
            TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt),
            MediaJobRecordingLimits.STOPPED_STATUS,
          )
        } else {
          val bytes = outcome.bytes
          writeIfWorkerOwns(jobId, kind, generation, "failed-retryable", bytes, bytes / 32, artifactKind(bytes, false), bytes, false, false, outcome.code, outcome.message, sourceUri)
        }
        owned.remove(jobId)
        stopServiceIfIdle()
      }
      is MediaJobDownloadOutcome.Completed -> {
        if (!completeIfWorkerOwns(jobId, kind, sourceUri, generation, outcome.bytes, outcome.durationMs, outcome.status)) return
        owned.remove(jobId)
        stopServiceIfIdle()
      }
    }
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
      journalDurationMs(journal),
      journal.optJSONObject("checkpoint")?.optString("updatedAt") ?: MediaJobCodec.utcNow(),
      if (artifact.third) "complete" else if (artifact.second > 0) "partial" else "none",
      if (artifact.second > 0 || artifact.third) "media-jobs/$jobId/artifact.bin" else null,
      artifact.second,
      owned.containsKey(jobId),
      MediaJobCodec.optionalString(journal, "failureCode"),
      MediaJobCodec.optionalString(journal, "statusMessage") ?: "",
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
    val target = journalFile(jobId) ?: return
    synchronized(journalGuard) {
      MediaJobCodec.writeJson(target, journal)
    }
  }

  private fun writeIfWorkerOwns(
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
  ): Boolean {
    synchronized(journalGuard) {
      if (!workerOwnsJournal(jobId, generation)) return false
      writeJournal(
        jobId,
        kind,
        generation,
        phase,
        byteOffset,
        durationMs,
        artifactKind,
        artifactBytes,
        complete,
        serviceOwned,
        failure,
        status,
        sourceUri,
      )
      return true
    }
  }

  private fun completeIfWorkerOwns(
    jobId: String,
    kind: String,
    sourceUri: String,
    generation: Int,
    target: Long,
    durationMs: Long,
    status: String,
  ): Boolean {
    synchronized(journalGuard) {
      if (!workerOwnsJournal(jobId, generation)) return false
      completeArtifact(jobId)
      writeJournal(
        jobId,
        kind,
        generation,
        "completed",
        target,
        durationMs,
        "complete",
        target,
        true,
        false,
        null,
        status,
        sourceUri,
      )
      return true
    }
  }

  private fun startService(jobId: String) {
    val intent = Intent(context, MediaJobForegroundService::class.java)
      .putExtra("jobId", jobId)
      .putExtra("kind", readJournal(jobId)?.optString("kind") ?: "")
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
  private fun jobDir(jobId: String): File? {
    if (!MediaJobCodec.isValidJobId(jobId)) return null
    val root = jobsRoot()
    val candidate = File(root, jobId)
    return try {
      val rootPath = root.canonicalFile
      val resolved = candidate.canonicalFile
      val prefix = rootPath.path.trimEnd(File.separatorChar) + File.separator
      if (resolved != rootPath && !resolved.path.startsWith(prefix)) null else candidate
    } catch (_: java.io.IOException) {
      null
    }
  }
  private fun journalFile(jobId: String): File? = jobDir(jobId)?.let { File(it, "journal.json") }
  private fun headersFile(jobId: String): File? = jobDir(jobId)?.let { File(it, "headers.json") }
  private fun artifactFile(jobId: String): File? = jobDir(jobId)?.let { File(it, "artifact.bin") }
  private fun writeHeaders(jobId: String, headers: Map<String, String>) {
    if (headers.isEmpty()) return
    val file = headersFile(jobId) ?: return
    MediaJobCodec.writeJson(file, headers)
  }
  private fun readHeaders(jobId: String): Map<String, String> {
    val json = headersFile(jobId)?.let { MediaJobCodec.readJson(it) } ?: return emptyMap()
    return json.keys().asSequence().associateWith { key -> json.optString(key) }
  }
  private fun completeFile(jobId: String): File? = jobDir(jobId)?.let { File(it, "artifact.bin.complete") }
  private fun readJournal(jobId: String): JSONObject? {
    if (!MediaJobCodec.isValidJobId(jobId)) return null
    val file = journalFile(jobId) ?: return null
    return MediaJobCodec.readJson(file)
  }
  private fun journalOrMissing(jobId: String): JSONObject? = readJournal(jobId)
  private fun workerOwnsJournal(jobId: String, generation: Int): Boolean {
    val journal = readJournal(jobId) ?: return false
    if (journal.optInt("generation") != generation) return false
    val phase = journal.optString("phase")
    return phase != "canceled" && phase != "completed" && phase != "failed-terminal"
  }
  private fun writePausedWithoutWorker(jobId: String, journal: JSONObject) {
    val artifact = artifactFrom(jobId)
    writeJournal(
      jobId,
      journal.optString("kind"),
      journal.optInt("generation"),
      "paused",
      journal.optJSONObject("checkpoint")?.optLong("byteOffset") ?: 0,
      journalDurationMs(journal),
      artifact.first,
      artifact.second,
      artifact.third,
      false,
      null,
      "Paused",
      journal.optString("sourceUri"),
    )
    owned.remove(jobId)
  }
  private fun completeArtifact(jobId: String) {
    val artifact = artifactFile(jobId) ?: return
    val marker = completeFile(jobId) ?: return
    artifact.parentFile?.mkdirs()
    if (!artifact.exists()) artifact.writeBytes(ByteArray(0))
    marker.writeText("complete")
  }
  private fun artifactFrom(jobId: String): Triple<String, Long, Boolean> {
    val artifact = artifactFile(jobId)
    val marker = completeFile(jobId)
    val bytes = if (artifact?.exists() == true) artifact.length() else 0L
    val complete = marker?.isFile == true
    return Triple(artifactKind(bytes, complete), bytes, complete)
  }
  private fun artifactKind(bytes: Long, complete: Boolean): String =
    if (complete) "complete" else if (bytes > 0) "partial" else "none"

  private fun journalDurationMs(journal: JSONObject): Long =
    journal.optJSONObject("checkpoint")?.optLong("durationMs") ?: 0

  companion object {
    private val ACTIVE_PHASES = setOf("queued", "preparing", "running", "pausing", "finalizing")
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
