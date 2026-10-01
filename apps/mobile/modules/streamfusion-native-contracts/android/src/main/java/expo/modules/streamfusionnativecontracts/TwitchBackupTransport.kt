package expo.modules.streamfusionnativecontracts

import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.io.ByteArrayOutputStream
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

internal interface TwitchBackupTransport {
  fun token(channel: String, playerType: String): Pair<String, String>?
  fun text(url: String): String?
  fun cancel()
}

internal class TwitchBackupHttp : TwitchBackupTransport {
  private val client = OkHttpClient.Builder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(4, TimeUnit.SECONDS)
    .callTimeout(6, TimeUnit.SECONDS)
    .build()
  private val deviceId = UUID.randomUUID().toString().replace("-", "")

  override fun token(channel: String, playerType: String): Pair<String, String>? {
    val body = JSONObject()
      .put("operationName", "PlaybackAccessToken")
      .put("variables", JSONObject()
        .put("isLive", true)
        .put("login", channel)
        .put("isVod", false)
        .put("vodID", "")
        .put("playerType", playerType)
        .put("platform", if (playerType == "autoplay") "android" else "web"))
      .put("extensions", JSONObject().put("persistedQuery", JSONObject()
        .put("version", 1)
        .put("sha256Hash", "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9")))
    val request = Request.Builder()
      .url("https://gql.twitch.tv/gql")
      .header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
      .header("X-Device-Id", deviceId)
      .post(body.toString().toRequestBody("application/json".toMediaType()))
      .build()
    return runCatching {
      client.newCall(request).execute().use { response ->
        if (!response.isSuccessful) return@use null
        val data = JSONObject(response.body?.string() ?: return@use null)
        val token = data.optJSONObject("data")?.optJSONObject("streamPlaybackAccessToken") ?: return@use null
        val signature = token.optString("signature").takeIf(String::isNotBlank) ?: return@use null
        val value = sanitizeToken(token.optString("value")) ?: return@use null
        signature to value
      }
    }.getOrNull()
  }

  override fun text(url: String): String? {
    if (runCatching { URI(url).scheme.equals("https", true) }.getOrDefault(false).not()) return null
    return runCatching {
      client.newCall(Request.Builder().url(url).get().build()).execute().use { response ->
        if (!response.isSuccessful) return@use null
        val body = response.body ?: return@use null
        if (body.contentLength() > 1024 * 1024) return@use null
        body.byteStream().use { input ->
          val output = ByteArrayOutputStream()
          val buffer = ByteArray(16 * 1024)
          while (output.size() <= 1024 * 1024) {
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
          }
          if (output.size() > 1024 * 1024) null else output.toString(Charsets.UTF_8.name())
        }
      }
    }.getOrNull()
  }

  override fun cancel() {
    client.dispatcher.cancelAll()
    client.connectionPool.evictAll()
  }

  companion object {
    fun sanitizeToken(raw: String): String? = runCatching {
      val value = JSONObject(raw)
      value.remove("parent_domains")
      value.remove("parent_referrer_domains")
      value.toString()
    }.getOrNull()
  }
}
