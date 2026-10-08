package expo.modules.streamfusionnativecontracts

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.util.UUID
import org.json.JSONObject

data class UpdateRelease(
  val tag: String,
  val version: String,
  val apkBytes: Long,
  val apkSha256: String,
  val notes: String,
  val releaseUrl: String,
) {
  fun wire(): Map<String, Any> = mapOf(
    "tag" to tag, "version" to version, "apkBytes" to apkBytes,
    "apkSha256" to apkSha256, "notes" to notes, "releaseUrl" to releaseUrl,
  )

  fun json(): JSONObject = JSONObject().apply {
    put("tag", tag); put("version", version); put("apkBytes", apkBytes)
    put("apkSha256", apkSha256); put("notes", notes); put("releaseUrl", releaseUrl)
  }

  companion object {
    private val tagPattern = Regex("android-v[0-9]+\\.[0-9]+\\.[0-9]+(?:-(?:alpha|beta|rc)(?:\\.[0-9]+)?)?")
    private val hashPattern = Regex("[0-9a-f]{64}")
    fun parse(value: Map<*, *>): UpdateRelease {
      val tag = value["tag"] as? String ?: error("Invalid update tag")
      val version = value["version"] as? String ?: error("Invalid update version")
      val numericLength = (value["apkBytes"] as? Number)?.toDouble() ?: error("Invalid APK length")
      require(numericLength.isFinite() && numericLength == numericLength.toLong().toDouble())
      val length = numericLength.toLong()
      val sha = value["apkSha256"] as? String ?: error("Invalid APK checksum")
      val notes = value["notes"] as? String ?: error("Invalid update notes")
      val url = value["releaseUrl"] as? String ?: error("Invalid release URL")
      require(tagPattern.matches(tag) && version == tag.removePrefix("android-v"))
      require(length in 1..MAX_APK_BYTES && hashPattern.matches(sha))
      require(notes.length <= 32_768)
      require(url == "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/$tag")
      return UpdateRelease(tag, version, length, sha, notes, url)
    }

    fun fromJson(value: JSONObject): UpdateRelease = parse(mapOf(
      "tag" to value.getString("tag"), "version" to value.getString("version"),
      "apkBytes" to value.getLong("apkBytes"), "apkSha256" to value.getString("apkSha256"),
      "notes" to value.getString("notes"), "releaseUrl" to value.getString("releaseUrl"),
    ))

    const val MAX_APK_BYTES = 1_000_000_000L
  }
}

internal data class UpdateRecord(
  val revision: Long = 0,
  val operation: String? = null,
  val release: UpdateRelease? = null,
  val generation: Long = 0,
  val kind: String = "idle",
  val bytes: Long = 0,
  val versionCode: Long = 0,
  val minSdk: Int = 0,
  val sessionId: Int = -1,
  val installIntent: Boolean = false,
  val code: String? = null,
  val retry: String? = null,
  val reason: String? = null,
  val stageAt: Long = 0,
) {
  fun wire(): Map<String, Any> {
    val phase = mutableMapOf<String, Any>("kind" to kind)
    if (operation != null && release != null) {
      phase["operation"] = operation
      phase["release"] = release.wire()
    }
    when (kind) {
      "downloading" -> { phase["bytes"] = bytes; phase["total"] = release?.apkBytes ?: 0 }
      "paused" -> { phase["bytes"] = bytes; phase["reason"] = reason ?: "process-interrupted" }
      "failed" -> { phase["code"] = code ?: "interrupted"; phase["retry"] = retry ?: "none" }
      "unsupported" -> phase["message"] = "Android updater is unavailable."
    }
    return mapOf("revision" to revision, "phase" to phase)
  }

  fun json(): JSONObject = JSONObject().apply {
    put("schema", 1); put("revision", revision); put("operation", operation)
    put("release", release?.json()); put("generation", generation); put("kind", kind)
    put("bytes", bytes); put("versionCode", versionCode); put("minSdk", minSdk)
    put("sessionId", sessionId); put("installIntent", installIntent)
    put("code", code); put("retry", retry); put("reason", reason); put("stageAt", stageAt)
  }

  companion object {
    fun fromJson(value: JSONObject): UpdateRecord {
      require(value.getInt("schema") == 1)
      val kind = value.getString("kind")
      require(kind in setOf("idle", "downloading", "paused", "verifying", "ready", "permission-needed", "staging", "awaiting-approval", "installed", "canceled", "failed"))
      val release = value.optJSONObject("release")?.let(UpdateRelease::fromJson)
      val operation = nullableString(value, "operation")
      require((operation == null) == (release == null))
      require(kind == "idle" || operation != null)
      return UpdateRecord(
        revision = value.getLong("revision"), operation = operation, release = release,
        generation = value.getLong("generation"), kind = kind, bytes = value.getLong("bytes"),
        versionCode = value.optLong("versionCode"), minSdk = value.optInt("minSdk"),
        sessionId = value.optInt("sessionId", -1), installIntent = value.optBoolean("installIntent"),
        code = nullableString(value, "code"), retry = nullableString(value, "retry"),
        reason = nullableString(value, "reason"), stageAt = value.optLong("stageAt"),
      )
    }

    private fun nullableString(value: JSONObject, key: String): String? =
      if (value.isNull(key)) null else value.getString(key).ifBlank { null }
  }
}

internal class UpdateJournal(context: Context) {
  private val directory = File(context.filesDir, "app-update").apply { mkdirs() }
  private val atomic = AtomicFile(File(directory, "operation.json"))
  val partial: File get() = File(directory, "download.partial")
  val verified: File get() = File(directory, "verified.apk")

  fun read(): UpdateRecord = try {
    UpdateRecord.fromJson(JSONObject(String(atomic.readFully(), Charsets.UTF_8)))
  } catch (_: java.io.FileNotFoundException) {
    UpdateRecord()
  } catch (_: Exception) {
    UpdateRecord(kind = "unsupported")
  }

  fun write(record: UpdateRecord): UpdateRecord {
    val stream = atomic.startWrite()
    try {
      stream.write(record.json().toString().toByteArray(Charsets.UTF_8))
      atomic.finishWrite(stream)
    } catch (error: Exception) {
      atomic.failWrite(stream)
      throw error
    }
    return record
  }

  fun newOperation(): String = UUID.randomUUID().toString()
}
