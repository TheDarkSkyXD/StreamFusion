package expo.modules.streamfusionnativecontracts

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest

internal object MediaJobExport {
  fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(8_192)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
  }

  fun copyToUri(context: Context, source: File, destination: Uri): Pair<String, String> {
    val sourceHash = sha256(source)
    context.contentResolver.openOutputStream(destination, "w").use { output ->
      requireNotNull(output) { "Export destination could not be opened." }
      source.inputStream().use { input -> input.copyTo(output) }
    }
    val copied = readUriHash(context, destination)
    return sourceHash to copied
  }

  fun open(context: Context, source: File): Boolean {
    if (!source.isFile) return false
    val uri = FileProvider.getUriForFile(
      context,
      "${context.packageName}.streamfusion.mediajobs",
      source,
    )
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/octet-stream")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    return runCatching {
      context.startActivity(intent)
      true
    }.getOrDefault(false)
  }

  fun deleteTree(directory: File) {
    if (!directory.exists()) return
    directory.walkBottomUp().forEach { child -> child.delete() }
  }

  private fun readUriHash(context: Context, uri: Uri): String {
    val digest = MessageDigest.getInstance("SHA-256")
    context.contentResolver.openInputStream(uri).use { input ->
      requireNotNull(input) { "Exported file could not be read back." }
      val buffer = ByteArray(8_192)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
  }
}
