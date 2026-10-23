package expo.modules.streamfusionnativecontracts

import androidx.core.net.toUri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.datasource.DataSpec
import androidx.media3.exoplayer.drm.DefaultDrmSessionManager
import androidx.media3.exoplayer.drm.ExoMediaDrm
import androidx.media3.exoplayer.drm.MediaDrmCallback
import androidx.media3.exoplayer.drm.MediaDrmCallbackException
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

internal class TwitchProtectedSource private constructor(val channel: String, val master: HttpUrl) {
  companion object {
    fun parse(request: Map<String, Any>): TwitchProtectedSource? {
      if (!request.containsKey("protection")) return null
      val descriptor = request["protection"] as? Map<*, *> ?: invalid()
      if (descriptor.keys != setOf("kind", "channelName") || descriptor["kind"] != "twitch-widevine") invalid()
      val channel = (descriptor["channelName"] as? String)?.takeIf { it.matches(Regex("[a-zA-Z0-9_]{1,25}")) }
        ?.lowercase(java.util.Locale.US) ?: invalid()
      val master = (request["sourceUri"] as? String)?.toHttpUrlOrNull() ?: invalid()
      if (master.scheme != "https" || master.host != "usher.ttvnw.net" || master.port != 443 ||
        master.username.isNotEmpty() || master.password.isNotEmpty() || master.fragment != null ||
        !master.encodedPath.matches(Regex("/api/(?:v2/)?channel/hls/$channel\\.m3u8"))) invalid()
      for ((name, expected) in mapOf("cdm" to "wv", "player_backend" to "mediaplayer", "supported_codecs" to "h264")) {
        if (master.queryParameterValues(name) != listOf(expected)) invalid()
      }
      for (name in listOf("token", "sig")) {
        val values = master.queryParameterValues(name)
        if (values.size != 1 || values.single().isNullOrBlank() || values.single()!!.length > 256 * 1024) invalid()
      }
      return TwitchProtectedSource(channel, master)
    }

    private fun invalid(): Nothing = throw IllegalArgumentException("Invalid protected playback source.")
  }
}

internal class TwitchWidevineFailure(
  val status: Int? = null,
  val retryable: Boolean = status == 408 || status == 429 || (status != null && status >= 500),
) : IOException("Protected playback request failed.")

@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
internal class TwitchWidevineSession(
  private val source: TwitchProtectedSource,
  client: OkHttpClient = OkHttpClient(),
) : MediaDrmCallback, AutoCloseable {
  private class Authorization(val value: String)
  private val client = client.newBuilder()
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
    .connectTimeout(5, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS)
    .writeTimeout(10, TimeUnit.SECONDS).callTimeout(10, TimeUnit.SECONDS).build()
  private val lock = Any()
  private val active = mutableSetOf<Call>()
  private var closed = false
  private var authorization: Authorization? = null
  private var refreshing: CompletableFuture<Authorization>? = null

  val configuration: MediaItem.DrmConfiguration = MediaItem.DrmConfiguration.Builder(C.WIDEVINE_UUID)
    .setLicenseUri(LICENSE_URL).setMultiSession(true).setForceDefaultLicenseUri(true).build()

  val manager: DefaultDrmSessionManager by lazy {
    DefaultDrmSessionManager.Builder().setMultiSession(true).setSessionKeepaliveMs(C.TIME_UNSET)
      .setLoadErrorHandlingPolicy(TwitchWidevineLoadErrorPolicy()).build(this)
  }

  override fun executeKeyRequest(uuid: UUID, request: ExoMediaDrm.KeyRequest): ByteArray = guarded {
    if (uuid != C.WIDEVINE_UUID || request.data.isEmpty() || request.data.size > MAX_LICENSE_BYTES) throw TwitchWidevineFailure()
    val current = authorization(null)
    try {
      license(current, request.data)
    } catch (error: TwitchWidevineFailure) {
      if (error.status != 401) throw error
      license(authorization(current), request.data)
    }
  }

  override fun executeProvisionRequest(uuid: UUID, request: ExoMediaDrm.ProvisionRequest): ByteArray = guarded {
    if (uuid != C.WIDEVINE_UUID || request.data.size > MAX_LICENSE_BYTES) throw TwitchWidevineFailure()
    val url = (request.defaultUrl + "&signedRequest=" + String(request.data, Charsets.UTF_8)).toHttpUrlOrNull()
      ?.takeIf { it.scheme == "https" } ?: throw TwitchWidevineFailure()
    execute(Request.Builder().url(url).post(ByteArray(0).toRequestBody()).build(), MAX_LICENSE_BYTES)
  }

  private fun license(auth: Authorization, challenge: ByteArray): ByteArray = execute(
    Request.Builder().url(LICENSE_URL).header("customdata", auth.value)
      .post(challenge.toRequestBody("application/octet-stream".toMediaType())).build(), MAX_LICENSE_BYTES,
  )

  private fun authorization(stale: Authorization?): Authorization {
    val pending: CompletableFuture<Authorization>
    val ownsRefresh: Boolean
    synchronized(lock) {
      ensureOpen()
      authorization?.let { if (it !== stale) return it }
      val existing = refreshing
      ownsRefresh = existing == null
      pending = existing ?: CompletableFuture<Authorization>().also { refreshing = it }
    }
    if (ownsRefresh) {
      try {
        val access = if (stale == null) source.master.queryParameter("sig")!! to source.master.queryParameter("token")!! else token()
        val url = "https://usher.ttvnw.net/api/authxml/${source.channel}".toHttpUrl().newBuilder()
          .addQueryParameter("sig", access.first).addQueryParameter("token", access.second).build()
        val value = String(execute(Request.Builder().url(url).get().build(), MAX_AUTH_BYTES), Charsets.UTF_8)
        if (value.isBlank() || value.any { it < ' ' || it > '~' }) throw TwitchWidevineFailure()
        val next = Authorization(value)
        synchronized(lock) {
          ensureOpen()
          authorization = next
          refreshing = null
          pending.complete(next)
        }
      } catch (error: Exception) {
        pending.completeExceptionally(sanitizedFailure(error))
      } finally {
        synchronized(lock) { if (refreshing === pending) refreshing = null }
      }
    }
    return try {
      pending.get()
    } catch (error: ExecutionException) {
      throw (error.cause as? TwitchWidevineFailure ?: TwitchWidevineFailure())
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      throw TwitchWidevineFailure()
    }
  }

  private fun token(): Pair<String, String> {
    val payload = JSONObject().put("operationName", "PlaybackAccessToken")
      .put("variables", JSONObject().put("isLive", true).put("login", source.channel).put("isVod", false)
        .put("vodID", "").put("playerType", "site").put("platform", "web"))
      .put("extensions", JSONObject().put("persistedQuery", JSONObject().put("version", 1)
        .put("sha256Hash", "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9")))
    val response = execute(Request.Builder().url("https://gql.twitch.tv/gql")
      .header("Client-Id", "kd1unb4b3q4t58fwlpcbzcbnm76a8fp")
      .post(payload.toString().toRequestBody("application/json".toMediaType())).build(), MAX_AUTH_BYTES)
    val root = JSONObject(String(response, Charsets.UTF_8))
    if (root.has("errors")) throw TwitchWidevineFailure()
    val token = root.getJSONObject("data").getJSONObject("streamPlaybackAccessToken")
    val signature = token.getString("signature")
    val value = token.getString("value")
    if (signature.isBlank() || value.isBlank()) throw TwitchWidevineFailure()
    return signature to value
  }

  private fun execute(request: Request, limit: Int): ByteArray {
    val call = synchronized(lock) {
      ensureOpen()
      client.newCall(request).also(active::add)
    }
    try {
      val result = call.execute().use { response ->
        if (!response.isSuccessful) throw TwitchWidevineFailure(response.code)
        val body = response.body ?: throw TwitchWidevineFailure()
        if (body.contentLength() > limit) throw TwitchWidevineFailure()
        body.byteStream().use { input ->
          val output = ByteArrayOutputStream()
          val buffer = ByteArray(8192)
          while (true) {
            val count = input.read(buffer, 0, minOf(buffer.size, limit - output.size() + 1))
            if (count < 0) break
            output.write(buffer, 0, count)
            if (output.size() > limit) throw TwitchWidevineFailure()
          }
          output.toByteArray().takeIf { it.isNotEmpty() } ?: throw TwitchWidevineFailure()
        }
      }
      return synchronized(lock) { ensureOpen(); result }
    } finally { synchronized(lock) { active.remove(call) } }
  }

  private fun guarded(block: () -> ByteArray): ByteArray = try {
    val result = block()
    synchronized(lock) { ensureOpen(); result }
  } catch (error: Exception) {
    val failure = sanitizedFailure(error)
    val uri = LICENSE_URL.toUri()
    throw MediaDrmCallbackException(DataSpec(uri), uri, emptyMap(), 0, failure)
  }

  private fun sanitizedFailure(error: Exception): TwitchWidevineFailure =
    error as? TwitchWidevineFailure ?: TwitchWidevineFailure(retryable = error is IOException)

  private fun ensureOpen() { if (closed) throw TwitchWidevineFailure() }

  override fun close() {
    val calls = synchronized(lock) {
      if (closed) return
      closed = true
      authorization = null
      refreshing?.completeExceptionally(TwitchWidevineFailure())
      active.toList()
    }
    calls.forEach(Call::cancel)
  }

  companion object {
    private const val LICENSE_URL = "https://widevine.twitch.keyos.com/api/v4/getLicense"
    private const val MAX_AUTH_BYTES = 256 * 1024
    private const val MAX_LICENSE_BYTES = 1024 * 1024
  }
}
