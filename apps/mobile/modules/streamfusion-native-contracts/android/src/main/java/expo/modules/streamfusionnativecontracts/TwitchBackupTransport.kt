package expo.modules.streamfusionnativecontracts

import android.util.Log
import java.net.URI
import java.util.UUID
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.io.ByteArrayOutputStream
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject

internal interface TwitchBackupTransport {
  fun token(channel: String, playerType: String): Pair<String, String>?
  fun text(url: String): String?
  fun cancel()
}

internal class TwitchBackupHttp(
  private val client: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(4, TimeUnit.SECONDS)
    .callTimeout(6, TimeUnit.SECONDS)
    .build(),
  private val cleanup: Executor = cleanupExecutor,
) : TwitchBackupTransport {
  private val deviceId = UUID.randomUUID().toString().replace("-", "")
  private val lifecycleLock = Any()
  private val active = mutableSetOf<Call>()
  private var closed = false

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
    return execute(request) read@{ response ->
      if (!response.isSuccessful) return@read null
      val data = JSONObject(response.body?.string() ?: return@read null)
      val token = data.optJSONObject("data")?.optJSONObject("streamPlaybackAccessToken") ?: return@read null
      val signature = token.optString("signature").takeIf(String::isNotBlank) ?: return@read null
      val value = sanitizeToken(token.optString("value")) ?: return@read null
      signature to value
    }
  }

  override fun text(url: String): String? {
    if (runCatching { URI(url).scheme.equals("https", true) }.getOrDefault(false).not()) return null
    return execute(Request.Builder().url(url).get().build()) read@{ response ->
      if (!response.isSuccessful) return@read null
      val body = response.body ?: return@read null
      if (body.contentLength() > 1024 * 1024) return@read null
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
  }

  override fun cancel() {
    val calls = synchronized(lifecycleLock) {
      if (closed) return
      closed = true
      active.toList()
    }
    cleanup.execute {
      calls.forEach { call ->
        runCatching { call.cancel() }.onFailure { Log.e(TAG, "Backup call cancellation failed", it) }
      }
      evictConnections()
    }
  }

  private fun <T> execute(request: Request, read: (Response) -> T?): T? {
    val call = synchronized(lifecycleLock) {
      if (closed) return null
      client.newCall(request).also(active::add)
    }
    val result = try {
      runCatching { call.execute().use(read) }.getOrNull()
    } finally {
      val drain = synchronized(lifecycleLock) {
        active.remove(call)
        closed && active.isEmpty()
      }
      if (drain) cleanup.execute { evictConnections() }
    }
    return synchronized(lifecycleLock) { if (closed) null else result }
  }

  private fun evictConnections() {
    runCatching { client.connectionPool.evictAll() }
      .onFailure { Log.e(TAG, "Backup connection eviction failed", it) }
  }

  companion object {
    private const val TAG = "TwitchBackupHttp"
    private val cleanupExecutor = Executors.newSingleThreadExecutor { command ->
      Thread(command, "twitch-backup-cleanup").apply { isDaemon = true }
    }

    fun sanitizeToken(raw: String): String? = runCatching {
      val value = JSONObject(raw)
      value.remove("parent_domains")
      value.remove("parent_referrer_domains")
      value.toString()
    }.getOrNull()
  }
}
