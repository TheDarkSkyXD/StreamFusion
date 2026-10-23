package expo.modules.streamfusionnativecontracts

import androidx.media3.common.C
import androidx.media3.exoplayer.drm.ExoMediaDrm
import androidx.media3.exoplayer.drm.MediaDrmCallbackException
import androidx.media3.datasource.DataSpec
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class TwitchWidevineSessionTest {
  private val master = "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv&player_backend=mediaplayer&supported_codecs=h264&token=initial-token&sig=initial-signature"
  private val descriptor = mapOf("kind" to "twitch-widevine", "channelName" to "primevideo")
  private val challenge = byteArrayOf(0, -1, 17, 0, 33)
  private val license = byteArrayOf(-1, 0, -128, 22)
  private fun source(uri: String = master, protection: Any = descriptor) = TwitchProtectedSource.parse(mapOf("sourceUri" to uri, "protection" to protection))!!
  private fun key(session: TwitchWidevineSession) = session.executeKeyRequest(C.WIDEVINE_UUID, ExoMediaDrm.KeyRequest(challenge, "https://untrusted.example/license"))
  private fun client(handle: (Request) -> Response) = OkHttpClient.Builder().addInterceptor(Interceptor { handle(it.request()) }).build()
  private fun reply(request: Request, code: Int = 200, bytes: ByteArray = "authorization".toByteArray()) = Response.Builder()
    .request(request).protocol(Protocol.HTTP_1_1).code(code).message("test").body(bytes.toResponseBody()).build()
  private fun bytes(request: Request) = Buffer().also { request.body!!.writeTo(it) }.readByteArray()
  private val tokenJson = """{"data":{"streamPlaybackAccessToken":{"value":"fresh-token","signature":"fresh-signature"}}}"""

  @Test fun descriptorValidatesSourceAndBuildsStreamingWidevineConfiguration() {
    assertNull(TwitchProtectedSource.parse(mapOf("sourceUri" to master)))
    for (uri in listOf(master.replace("https:", "http:"), master.replace("primevideo.m3u8", "other.m3u8"),
      master.replace("cdm=wv", "cdm=clear"), master.replace("&sig=initial-signature", ""),
      master.replace("h264", "hevc"), master.replace("usher.ttvnw.net", "evil.example"))) {
      assertThrows(IllegalArgumentException::class.java) { source(uri) }
    }
    assertThrows(IllegalArgumentException::class.java) { source(protection = mapOf("kind" to "other")) }
    val session = TwitchWidevineSession(source())
    try {
      assertEquals(C.WIDEVINE_UUID, session.configuration.scheme)
      assertTrue(session.configuration.multiSession)
      assertNull(session.configuration.keySetId)
      assertEquals("https://widevine.twitch.keyos.com/api/v4/getLicense", session.configuration.licenseUri.toString())
    } finally { session.close() }
  }

  @Test fun initialAuthorizationUsesMasterAndOne401RefreshRetriesIdenticalBinaryChallenge() {
    val requests = mutableListOf<Request>()
    var posts = 0
    val session = TwitchWidevineSession(source(), client { request ->
      requests.add(request)
      when (request.url.host) {
        "usher.ttvnw.net" -> reply(request, bytes = (if (request.url.queryParameter("token") == "initial-token") "initial-auth" else "fresh-auth").toByteArray())
        "gql.twitch.tv" -> reply(request, bytes = tokenJson.toByteArray())
        else -> reply(request, if (++posts == 1) 401 else 200, license)
      }
    })
    try {
      assertArrayEquals(license, key(session))
      assertEquals("/api/authxml/primevideo", requests.first().url.encodedPath)
      assertEquals("initial-signature", requests.first().url.queryParameter("sig"))
      val gql = requests.single { it.url.host == "gql.twitch.tv" }
      assertEquals("kd1unb4b3q4t58fwlpcbzcbnm76a8fp", gql.header("Client-Id"))
      assertTrue(String(bytes(gql)).contains("\"playerType\":\"site\""))
      assertTrue(String(bytes(gql)).contains("\"platform\":\"web\""))
      val postsSeen = requests.filter { it.url.host == "widevine.twitch.keyos.com" }
      assertEquals(listOf("initial-auth", "fresh-auth"), postsSeen.map { it.header("customdata") })
      postsSeen.forEach { assertArrayEquals(challenge, bytes(it)); assertEquals("application/octet-stream", it.body!!.contentType().toString()) }
      assertEquals(2, postsSeen.size)
    } finally { session.close() }
  }

  @Test fun deniedOrRepeatedUnauthorizedLicenseNeverLoopsOrExposesSecrets() {
    for (code in listOf(403, 401)) {
      val calls = mutableListOf<Request>()
      val session = TwitchWidevineSession(source(), client { request ->
        calls.add(request)
        when (request.url.host) {
          "widevine.twitch.keyos.com" -> reply(request, code, "secret-denial".toByteArray())
          "gql.twitch.tv" -> reply(request, bytes = tokenJson.toByteArray())
          else -> reply(request)
        }
      })
      try {
        val error = assertThrows(MediaDrmCallbackException::class.java) { key(session) }
        val detail = error.stackTraceToString()
        listOf("initial-token", "fresh-token", "authorization", "secret-denial").forEach { assertFalse(detail.contains(it)) }
        assertEquals(if (code == 401) 2 else 1, calls.count { it.url.host == "widevine.twitch.keyos.com" })
        assertEquals(if (code == 401) 1 else 0, calls.count { it.url.host == "gql.twitch.tv" })
      } finally { session.close() }
    }
  }

  @Test fun concurrent401sShareRefreshAndLate401CannotReplaceFreshAuthorization() {
    val initialPosts = CountDownLatch(2)
    val releaseLate = CountDownLatch(1)
    val refreshes = AtomicInteger()
    val sequence = AtomicInteger()
    val headers = Collections.synchronizedList(mutableListOf<String>())
    val session = TwitchWidevineSession(source(), client { request ->
      when (request.url.host) {
        "gql.twitch.tv" -> { refreshes.incrementAndGet(); reply(request, bytes = tokenJson.toByteArray()) }
        "usher.ttvnw.net" -> reply(request, bytes = (if (request.url.queryParameter("token") == "initial-token") "old" else "new").toByteArray())
        else -> {
          val auth = request.header("customdata")!!
          headers.add(auth)
          if (auth == "old") {
            val index = sequence.incrementAndGet()
            initialPosts.countDown()
            assertTrue(initialPosts.await(5, TimeUnit.SECONDS))
            if (index == 2) assertTrue(releaseLate.await(5, TimeUnit.SECONDS))
            reply(request, 401)
          } else { releaseLate.countDown(); reply(request, bytes = license) }
        }
      }
    })
    val pool = Executors.newFixedThreadPool(2)
    try {
      val results = (1..2).map { pool.submit<ByteArray> { key(session) } }
      results.forEach { assertArrayEquals(license, it.get(10, TimeUnit.SECONDS)) }
      assertArrayEquals(license, key(session))
      assertEquals(1, refreshes.get())
      assertEquals(3, headers.count { it == "new" })
    } finally { session.close(); pool.shutdownNow() }
  }

  @Test fun closeCancelsBlockedAuthorizationAndDiscardsLateResponse() {
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val calls = AtomicInteger()
    val active = java.util.concurrent.atomic.AtomicReference<okhttp3.Call>()
    val session = TwitchWidevineSession(source(), OkHttpClient.Builder().addInterceptor { chain ->
      active.set(chain.call())
      calls.incrementAndGet(); entered.countDown()
      assertTrue(release.await(5, TimeUnit.SECONDS))
      reply(chain.request())
    }.build())
    val pool = Executors.newSingleThreadExecutor()
    try {
      val result = pool.submit<Boolean> { try { key(session); false } catch (_: MediaDrmCallbackException) { true } }
      assertTrue(entered.await(5, TimeUnit.SECONDS))
      session.close()
      assertTrue(active.get().isCanceled())
      release.countDown()
      assertTrue(result.get(5, TimeUnit.SECONDS))
      assertThrows(MediaDrmCallbackException::class.java) { key(session) }
      assertEquals(1, calls.get())
    } finally { release.countDown(); session.close(); pool.shutdownNow() }
  }

  @Test fun oversizedAuthorizationAndLicenseFailWithoutReturningPartialData() {
    for (licenseOversized in listOf(false, true)) {
      val session = TwitchWidevineSession(source(), client { request ->
        reply(request, bytes = if (licenseOversized && request.url.host == "usher.ttvnw.net") "auth".toByteArray() else ByteArray(1024 * 1024 + 1))
      })
      try { assertThrows(MediaDrmCallbackException::class.java) { key(session) } } finally { session.close() }
    }
  }

  @Test fun provisioningUsesCdmEndpointWithoutProviderAuthorization() {
    val requests = mutableListOf<Request>()
    val session = TwitchWidevineSession(source(), client { request -> requests.add(request); reply(request, bytes = license) })
    try {
      assertArrayEquals(license, session.executeProvisionRequest(C.WIDEVINE_UUID,
        ExoMediaDrm.ProvisionRequest("signed".toByteArray(), "https://provision.example/cdm?x=1")))
      val request = requests.single()
      assertEquals("https://provision.example/cdm?x=1&signedRequest=signed", request.url.toString())
      assertEquals("POST", request.method)
      assertNull(request.header("customdata"))
      assertEquals(0, bytes(request).size)
    } finally { session.close() }
  }

  @Test fun drmPolicyStopsDenialsAndBoundsTransientRetries() {
    val policy = TwitchWidevineLoadErrorPolicy()
    val spec = DataSpec(android.net.Uri.parse("https://widevine.twitch.keyos.com/api/v4/getLicense"))
    fun info(status: Int) = LoadErrorHandlingPolicy.LoadErrorInfo(
      LoadEventInfo(1, spec, 0), MediaLoadData(C.DATA_TYPE_DRM), TwitchWidevineFailure(status), 1,
    )
    assertEquals(C.TIME_UNSET, policy.getRetryDelayMsFor(info(401)))
    assertEquals(C.TIME_UNSET, policy.getRetryDelayMsFor(info(403)))
    assertEquals(0L, policy.getRetryDelayMsFor(info(503)))
    assertEquals(2, policy.getMinimumLoadableRetryCount(C.DATA_TYPE_DRM))
  }

  @Test fun authorizationRefreshRetainsSanitizedTransientAndTerminalFailureCategories() {
    for (stage in listOf("gql.twitch.tv", "usher.ttvnw.net")) {
      for (status in listOf(401, 403, 408, 429, 503, 0)) {
        var initial = true
        val session = TwitchWidevineSession(source(), client { request ->
          when {
            request.url.host == "widevine.twitch.keyos.com" -> reply(request, 401)
            request.url.host == "usher.ttvnw.net" && initial -> { initial = false; reply(request) }
            request.url.host == stage -> {
              if (status == 0) throw java.io.IOException("sensitive-token-in-transport")
              reply(request, status, "sensitive-auth-error".toByteArray())
            }
            else -> reply(request, bytes = tokenJson.toByteArray())
          }
        })
        try {
          val error = assertThrows(MediaDrmCallbackException::class.java) { key(session) }
          val failure = error.cause as TwitchWidevineFailure
          assertEquals("$stage HTTP $status", status.takeIf { it != 0 }, failure.status)
          assertEquals("$stage HTTP $status", status in listOf(0, 408, 429, 503), failure.retryable)
          assertFalse(error.stackTraceToString().contains("sensitive-"))
        } finally { session.close() }
      }
    }
  }
}
