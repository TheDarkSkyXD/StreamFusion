package expo.modules.streamfusionnativecontracts

import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream
import okhttp3.OkHttpClient
import okhttp3.Request

internal class CaptionModelStore(private val filesDir: File) {
  private val lock = Any()
  private var constrained = false
  private val root = File(filesDir, "captions")
  private val selection = File(root, "selected-pack")

  fun queueConstraint() = synchronized(lock) { constrained = true }
  fun clearConstraint() = synchronized(lock) { constrained = false }
  fun constrained(): Boolean = synchronized(lock) { constrained }
  fun modelDir(fixture: Boolean = false): File =
    File(root, if (fixture) "diagnostic-fixture-v1" else "vosk-small-en-us-0.15")

  fun install(sourceUri: String?): Map<String, Any> = synchronized(lock) {
    if (constrained) return state("constrained", false, "none", CaptionCatalog.CONSTRAINED)
    if (sourceUri?.startsWith(CaptionCatalog.FIXTURE_URI) == true) {
      val dir = modelDir(true)
      dir.mkdirs()
      CaptionCatalog.fixtureFiles.forEach { File(dir, it.path).writeText(it.contents) }
      selection.writeText("fixture")
      if (sourceUri.contains("integrity-fail")) File(dir, "tokens.txt").writeText("corrupt")
      return snapshot()
    }
    if (sourceUri != null && sourceUri != CaptionCatalog.MODEL_URL) {
      return state("integrity-error", false, "none", "Only the pinned official English model can be installed.")
    }
    root.mkdirs()
    val archive = File(root, "model-download.zip.part")
    val staging = File(root, "model-staging")
    try {
      staging.deleteRecursively()
      staging.mkdirs()
      val client = OkHttpClient.Builder().callTimeout(10, TimeUnit.MINUTES).build()
      client.newCall(Request.Builder().url(CaptionCatalog.MODEL_URL).build()).execute().use { response ->
        if (!response.isSuccessful) throw IOException("Model download returned HTTP ${response.code}.")
        val body = response.body ?: throw IOException("Model download was empty.")
        body.byteStream().use { input ->
          archive.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            var bytes = 0L
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              bytes += count
              if (bytes > CaptionCatalog.DOWNLOAD_BYTES) throw IOException("Model download exceeded its pinned size.")
              output.write(buffer, 0, count)
            }
          }
        }
      }
      if (archive.length() != CaptionCatalog.DOWNLOAD_BYTES || sha256(archive) != CaptionCatalog.MODEL_SHA256) {
        throw IOException(CaptionCatalog.INTEGRITY_ERROR)
      }
      extract(archive, staging)
      if (!verify(staging, false)) throw IOException(CaptionCatalog.INTEGRITY_ERROR)
      val target = modelDir()
      val backup = File(root, "model-previous")
      backup.deleteRecursively()
      if (target.exists() && !target.renameTo(backup)) throw IOException("Cannot preserve the installed model.")
      if (!staging.renameTo(target)) {
        backup.renameTo(target)
        throw IOException("Cannot commit the verified model.")
      }
      selection.writeText("product")
      backup.deleteRecursively()
      snapshot()
    } catch (error: IOException) {
      state("integrity-error", installed(), pack(), error.message ?: "English model installation failed.")
    } finally {
      archive.delete()
      staging.deleteRecursively()
    }
  }

  fun remove(): Map<String, Any> = synchronized(lock) {
    if (root.exists() && !root.deleteRecursively()) {
      val selected = pack()
      return state("integrity-error", installed(selected == "fixture"), selected, "The caption model could not be removed from this device.")
    }
    state("not-installed", false, "none", CaptionCatalog.NOT_INSTALLED)
  }

  fun snapshot(): Map<String, Any> = synchronized(lock) {
    val pack = pack()
    val valid = installed(pack == "fixture")
    when {
      constrained -> state("constrained", valid, pack, CaptionCatalog.CONSTRAINED)
      pack == "none" -> state("not-installed", false, pack, CaptionCatalog.NOT_INSTALLED)
      !valid -> state("integrity-error", false, pack, CaptionCatalog.INTEGRITY_ERROR)
      pack == "fixture" -> state("ready", true, pack, "Diagnostic fixture ready. This is not a speech recognition model.")
      else -> state("ready", true, pack, CaptionCatalog.READY)
    }
  }

  fun installed(fixture: Boolean = false): Boolean = verify(modelDir(fixture), fixture)

  private fun pack(): String = when {
    selection.exists() && selection.readText() == "fixture" -> "fixture"
    modelDir().exists() -> "product"
    else -> "none"
  }

  private fun verify(dir: File, fixture: Boolean): Boolean {
    val hashes = if (fixture) CaptionCatalog.fixtureFiles.associate { it.path to it.sha256 } else CaptionCatalog.productFiles
    return dir.isDirectory && hashes.all { (path, hash) ->
      val file = File(dir, path)
      file.isFile && sha256(file) == hash
    }
  }

  internal fun extract(archive: File, staging: File) {
    val prefix = "${CaptionCatalog.MODEL_ROOT}/"
    ZipInputStream(archive.inputStream().buffered()).use { zip ->
      var total = 0L
      while (true) {
        val entry = zip.nextEntry ?: break
        if (!entry.name.startsWith(prefix)) throw IOException("Unexpected model archive root.")
        val path = entry.name.removePrefix(prefix)
        val destination = File(staging, path).canonicalFile
        if (!destination.toPath().startsWith(staging.canonicalFile.toPath())) throw IOException("Model archive escaped staging.")
        if (!entry.isDirectory) {
          if (!CaptionCatalog.productFiles.containsKey(path)) throw IOException("Unexpected model file.")
          destination.parentFile?.mkdirs()
          destination.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              val count = zip.read(buffer)
              if (count < 0) break
              total += count
              if (total > 80 * 1024 * 1024) throw IOException("Expanded model exceeded its limit.")
              output.write(buffer, 0, count)
            }
          }
        }
        zip.closeEntry()
      }
    }
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().buffered().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun state(phase: String, installed: Boolean, pack: String, message: String): Map<String, Any> {
    val expected = if (pack == "fixture") CaptionCatalog.fixtureFiles.sumOf { it.contents.toByteArray().size.toLong() } else CaptionCatalog.DOWNLOAD_BYTES
    return mapOf(
      "modelId" to CaptionCatalog.MODEL_ID,
      "installed" to installed,
      "phase" to phase,
      "displaySize" to if (pack == "fixture") "$expected bytes diagnostic fixture" else CaptionCatalog.DISPLAY_SIZE,
      "downloadedBytes" to if (installed) expected else 0L,
      "expectedBytes" to expected,
      "license" to CaptionCatalog.LICENSE,
      "languageLabel" to CaptionCatalog.LANGUAGE_LABEL,
      "pack" to pack,
      "sha256Verified" to installed,
      "statusMessage" to message,
      "audioUploadAttempts" to 0,
    )
  }
}
