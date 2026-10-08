package expo.modules.streamfusionnativecontracts

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class UpdateManifest(
  val versionCode: Long,
  val minSdk: Int,
  val assetName: String,
)

interface ReleaseTransport {
  @Throws(IOException::class)
  fun manifest(release: UpdateRelease, canceled: () -> Boolean): UpdateManifest
  @Throws(IOException::class)
  fun download(release: UpdateRelease, destination: File, canceled: () -> Boolean, progress: (Long) -> Unit)
  fun cancel()
}

internal class GitHubReleaseTransport : ReleaseTransport {
  private val client = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false)
    .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
    .callTimeout(2, TimeUnit.HOURS).build()
  @Volatile private var active: Call? = null

  override fun manifest(release: UpdateRelease, canceled: () -> Boolean): UpdateManifest {
    val name = "StreamFusion-${release.tag}.apk"
    val url = releaseAsset(release, "android-update.json")
    val body = fetch(url, canceled).use { response ->
      response.body?.byteStream()?.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          if (output.size() + read > MAX_MANIFEST_BYTES) throw UpdateFailureException("metadata")
          output.write(buffer, 0, read)
        }
        output.toString("UTF-8")
      } ?: throw UpdateFailureException("metadata")
    }.also { active = null }
    val manifest = try { JSONObject(body) } catch (_: Exception) { throw UpdateFailureException("metadata") }
    if (manifest.optInt("schemaVersion") != 1 ||
      manifest.optString("releaseTag") != release.tag ||
      manifest.optString("versionName") != release.version ||
      manifest.optString("assetName") != name ||
      manifest.optString("sha256") != release.apkSha256 ||
      manifest.optLong("byteLength") != release.apkBytes
    ) throw UpdateFailureException("metadata")
    val code = manifest.optLong("versionCode")
    val minSdk = manifest.optInt("minSdk")
    if (code <= 0 || minSdk < 30) throw UpdateFailureException("metadata")
    return UpdateManifest(code, minSdk, name)
  }

  override fun download(
    release: UpdateRelease,
    destination: File,
    canceled: () -> Boolean,
    progress: (Long) -> Unit,
  ) {
    try { fetch(releaseAsset(release, "StreamFusion-${release.tag}.apk"), canceled).use { response ->
      val declared = response.body?.contentLength() ?: -1
      if (declared > release.apkBytes) throw UpdateFailureException("metadata")
      val source = response.body?.byteStream() ?: throw IOException("APK response body missing")
      FileOutputStream(destination, false).use { output ->
        source.use { input ->
          val buffer = ByteArray(64 * 1024)
          var total = 0L
          while (true) {
            if (canceled()) throw UpdateCanceledException()
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > release.apkBytes) throw UpdateFailureException("metadata")
            output.write(buffer, 0, read)
            progress(total)
          }
          output.fd.sync()
          if (total != release.apkBytes) throw UpdateFailureException("metadata")
        }
      }
    } } finally { active = null }
  }

  override fun cancel() { active?.cancel() }

  private fun fetch(start: String, canceled: () -> Boolean): Response {
    var url = start
    repeat(6) { hop ->
      if (canceled()) throw UpdateCanceledException()
      validateUrl(url, hop == 0)
      val call = client.newCall(Request.Builder().url(url).get().build())
      active = call
      val response = call.execute()
      if (response.code in 300..399) {
        val location = response.header("Location")
        if (location == null) { response.close(); throw UpdateFailureException("metadata") }
        val next = response.request.url.resolve(location)?.toString()
        response.close()
        url = next ?: throw UpdateFailureException("metadata")
      } else {
        if (!response.isSuccessful) {
          response.close()
          throw IOException("GitHub release response ${response.code}")
        }
        return response
      }
    }
    throw UpdateFailureException("metadata")
  }

  private fun validateUrl(value: String, initial: Boolean) {
    val uri = value.toHttpUrlOrNull() ?: throw UpdateFailureException("metadata")
    val host = uri.host.lowercase()
    if (uri.scheme != "https" || uri.username.isNotEmpty() || uri.password.isNotEmpty() || uri.port != 443 || uri.fragment != null ||
      host !in setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")
    ) throw UpdateFailureException("metadata")
    if (host == "github.com" && !uri.encodedPath.startsWith("/TheDarkSkyXD/StreamFusion/releases/download/")) {
      throw UpdateFailureException("metadata")
    }
    if (initial && host != "github.com") throw UpdateFailureException("metadata")
  }

  private fun releaseAsset(release: UpdateRelease, asset: String): String =
    "https://github.com/TheDarkSkyXD/StreamFusion/releases/download/${release.tag}/$asset"

  companion object { private const val MAX_MANIFEST_BYTES = 16 * 1024 }
}

internal class UpdateFailureException(val code: String) : IOException(code)
internal class UpdateCanceledException : IOException("Update canceled")

internal fun sha256(file: File): String {
  val digest = MessageDigest.getInstance("SHA-256")
  file.inputStream().use { input ->
    val buffer = ByteArray(64 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      digest.update(buffer, 0, read)
    }
  }
  return digest.digest().joinToString("") { "%02x".format(it) }
}
