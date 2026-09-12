package expo.modules.streamfusionnativecontracts

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

internal object MediaJobCodec {
  private val utcMillis: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

  fun utcNow(): String = utcMillis.format(Instant.now())

  fun journalMap(
    jobId: String,
    kind: String,
    generation: Int,
    phase: String,
    byteOffset: Long,
    durationMs: Long,
    updatedAt: String,
    artifactKind: String,
    relativePath: String?,
    artifactBytes: Long,
    serviceOwned: Boolean,
    failureCode: String?,
    statusMessage: String,
  ): Map<String, Any?> {
    val checkpoint = mapOf(
      "generation" to generation,
      "byteOffset" to byteOffset.toDouble(),
      "durationMs" to durationMs.toDouble(),
      "updatedAt" to updatedAt,
    )
    val artifact = when (artifactKind) {
      "partial", "complete" -> mapOf(
        "kind" to artifactKind,
        "relativePath" to checkNotNull(relativePath),
        "bytes" to artifactBytes.toDouble(),
      )
      else -> mapOf("kind" to "none")
    }
    return mapOf(
      "jobId" to jobId,
      "kind" to kind,
      "generation" to generation,
      "phase" to phase,
      "checkpoint" to checkpoint,
      "artifact" to artifact,
      "serviceOwned" to serviceOwned,
      "failureCode" to failureCode,
      "statusMessage" to statusMessage,
    )
  }

  fun filesMap(relativePath: String, bytes: Long, complete: Boolean): Map<String, Any> =
    mapOf(
      "relativePath" to relativePath,
      "bytes" to bytes.toDouble(),
      "completeMarker" to complete,
    )

  fun record(journal: Map<String, Any?>, files: Map<String, Any>?): Map<String, Any?> {
    val value = mutableMapOf<String, Any?>("kind" to "record", "journal" to journal)
    if (files != null) value["files"] = files
    return mapOf("kind" to "completed", "value" to value)
  }

  fun missing(jobId: String): Map<String, Any> =
    mapOf(
      "kind" to "completed",
      "value" to mapOf("kind" to "missing", "jobId" to jobId),
    )

  fun writeJson(file: File, journal: Map<String, Any?>) {
    file.parentFile?.mkdirs()
    file.writeText(toJsonObject(journal).toString())
  }

  fun readJson(file: File): JSONObject? =
    if (file.isFile) JSONObject(file.readText()) else null

  private fun toJsonObject(value: Map<*, *>): JSONObject {
    val json = JSONObject()
    for ((key, entry) in value) {
      if (key is String) json.put(key, toJsonValue(entry))
    }
    return json
  }

  private fun toJsonValue(value: Any?): Any = when (value) {
    null -> JSONObject.NULL
    is Map<*, *> -> toJsonObject(value)
    is Iterable<*> -> JSONArray().also { array ->
      value.forEach { array.put(toJsonValue(it)) }
    }
    else -> value
  }
}
