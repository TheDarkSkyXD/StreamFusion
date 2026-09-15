package expo.modules.streamfusionnativecontracts

import java.io.File
import java.security.MessageDigest

internal class CaptionModelStore(private val filesDir: File) {
  private val lock = Any()
  private var constrained = false

  fun queueConstraint() {
    synchronized(lock) { constrained = true }
  }

  fun clearConstraint() {
    synchronized(lock) { constrained = false }
  }

  fun constrained(): Boolean = synchronized(lock) { constrained }

  fun modelDir(): File = File(filesDir, "captions/${CaptionCatalog.MODEL_ID}")

  fun install(sourceUri: String?): Map<String, Any> {
    if (constrained()) {
      return state("constrained", false, "none", false, CaptionCatalog.CONSTRAINED)
    }
    val dir = modelDir()
    dir.mkdirs()
    if ((sourceUri ?: "").contains("integrity-fail")) {
      File(dir, "tokens.txt").writeText("corrupt")
      return state("integrity-error", false, "fixture", false, CaptionCatalog.INTEGRITY_ERROR)
    }
    writeFixture(dir)
    return if (verify(dir)) {
      state("ready", true, "fixture", true, CaptionCatalog.READY)
    } else {
      state("integrity-error", false, "fixture", false, CaptionCatalog.INTEGRITY_ERROR)
    }
  }

  fun remove(): Map<String, Any> {
    modelDir().deleteRecursively()
    return state("not-installed", false, "none", false, CaptionCatalog.NOT_INSTALLED)
  }

  fun snapshot(): Map<String, Any> {
    if (constrained()) {
      return state("constrained", installed(), pack(), verified(), CaptionCatalog.CONSTRAINED)
    }
    val dir = modelDir()
    if (!dir.exists()) {
      return state("not-installed", false, "none", false, CaptionCatalog.NOT_INSTALLED)
    }
    return if (verify(dir)) {
      state("ready", true, pack(), true, CaptionCatalog.READY)
    } else {
      state("integrity-error", false, pack(), false, CaptionCatalog.INTEGRITY_ERROR)
    }
  }

  fun installed(): Boolean = verify(modelDir())

  private fun writeFixture(dir: File) {
    for (file in CaptionCatalog.fixtureFiles) {
      File(dir, file.path).writeText(file.contents)
    }
    File(dir, "pack.txt").writeText("fixture")
  }

  private fun pack(): String {
    val marker = File(modelDir(), "pack.txt")
    return if (marker.exists()) marker.readText().trim() else "none"
  }

  private fun verified(): Boolean = verify(modelDir())

  private fun verify(dir: File): Boolean {
    if (!dir.exists()) return false
    return CaptionCatalog.fixtureFiles.all { file ->
      val onDisk = File(dir, file.path)
      onDisk.exists() && sha256(onDisk.readBytes()) == file.sha256
    }
  }

  private fun sha256(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return digest.joinToString("") { byte -> "%02x".format(byte) }
  }

  private fun state(
    phase: String,
    installed: Boolean,
    pack: String,
    sha256Verified: Boolean,
    statusMessage: String,
  ): Map<String, Any> {
    val downloaded = if (installed) {
      CaptionCatalog.fixtureFiles.sumOf { it.contents.toByteArray().size.toLong() }
    } else {
      0L
    }
    return mapOf(
      "modelId" to CaptionCatalog.MODEL_ID,
      "installed" to installed,
      "phase" to phase,
      "displaySize" to CaptionCatalog.DISPLAY_SIZE,
      "downloadedBytes" to downloaded,
      "expectedBytes" to CaptionCatalog.DOWNLOAD_BYTES,
      "license" to CaptionCatalog.LICENSE,
      "languageLabel" to CaptionCatalog.LANGUAGE_LABEL,
      "pack" to pack,
      "sha256Verified" to sha256Verified,
      "statusMessage" to statusMessage,
      "audioUploadAttempts" to 0,
    )
  }
}
