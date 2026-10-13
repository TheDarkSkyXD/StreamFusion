package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.ListenableWorker
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestWorkerBuilder
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

class NotificationTapTestActivity : Activity()

@RunWith(AndroidJUnit4::class)
class NativeLiveAlertWorkerTest {
  private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
  private val channel = AlertChannel("kick", "original-saved-user-id", "example", "Example")

  private fun runWorker(owner: LiveAlertOwner, reader: AlertReader): ListenableWorker.Result {
    val factory = object : WorkerFactory() {
      override fun createWorker(appContext: Context, workerClassName: String, parameters: WorkerParameters): ListenableWorker =
        StreamFusionLiveAlertWorker(appContext, parameters, owner, reader)
    }
    return TestWorkerBuilder.from(context, StreamFusionLiveAlertWorker::class.java, Executor { it.run() })
      .setWorkerFactory(factory).build().doWork()
  }

  private fun https(block: (MockWebServer, OkHttpClient) -> Unit) {
    val certificate = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
    val serverCertificates = HandshakeCertificates.Builder().heldCertificate(certificate).build()
    val clientCertificates = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
    val server = MockWebServer()
    server.useHttps(serverCertificates.sslSocketFactory(), false)
    server.start()
    val client = OkHttpClient.Builder().sslSocketFactory(clientCertificates.sslSocketFactory(), clientCertificates.trustManager)
      .callTimeout(2, TimeUnit.SECONDS).build()
    try { block(server, client) } finally { client.dispatcher.cancelAll(); server.shutdown() }
  }

  private fun kick(live: String) = MockResponse().setHeader("Content-Type", "application/json")
    .setBody("""{"id":42,"slug":"example","livestream":$live}""")

  @Test fun httpsWorkerPostsOnceAndPreservesEncryptedInboxAcrossOwnerRestart() = https { server, client ->
    val key = "live-alert-test-worker"
    val store = EncryptedAlertJournalStore(context, key)
    store.write(AlertJournal())
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS").close()
    }
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancelAll()
    val poster = AlertPoster { event, silent ->
      val payload = AlertJson.payload(event)
      StreamFusionNotificationsModule.showNotification(context, payload.getString("title"), payload.getString("body"), payload.toString(), "live", silent)
    }
    val owner = LiveAlertOwner(store, poster)
    val time = AtomicLong(100)
    fun reader() = PublicLiveAlertReader(client, server.url("/gql").toString(), server.url("/").toString(), { time.incrementAndGet() })
    try {
      owner.configure(listOf(channel), AlertPolicy())
      server.enqueue(kick("null"))
      assertEquals(ListenableWorker.Result.success(), runWorker(owner, reader()))
      assertTrue(owner.pending().isEmpty())
      assertEquals("/api/v1/channels/example", server.takeRequest().path)
      server.enqueue(kick("""{"id":100,"session_title":"https://unsafe.example bearer secret"}"""))
      assertEquals(ListenableWorker.Result.success(), runWorker(owner, reader()))
      val event = owner.pending().single()
      assertEquals("Tap to watch now.", event.title)
      val payload = AlertJson.payload(event)
      assertEquals("Tap to watch now.", payload.getString("body"))
      assertEquals("original-saved-user-id", payload.getJSONObject("destination").getString("channelId"))
      val notification = manager.activeNotifications.single { it.tag == event.eventId }
      assertNotNull(notification.notification.contentIntent)
      assertEquals("Example is live", notification.notification.extras.getString("android.title"))
      manager.cancel(event.eventId, 0)
      val dismissalDeadline = android.os.SystemClock.elapsedRealtime() + 5000
      while (manager.activeNotifications.any { it.tag == event.eventId }) {
        assertTrue("Android did not dismiss the notification", android.os.SystemClock.elapsedRealtime() < dismissalDeadline)
        Thread.sleep(20)
      }
      server.enqueue(kick("""{"id":100,"session_title":"Same stream"}"""))
      runWorker(owner, reader())
      assertTrue(manager.activeNotifications.none { it.tag == event.eventId })
      assertEquals(1, owner.pending().size)
      server.enqueue(MockResponse().setResponseCode(503))
      runWorker(owner, reader())
      assertEquals("provider-unavailable", owner.status().failure)
      assertEquals("100", owner.status().baselines.getValue(channel.key).streamId)
      val restarted = LiveAlertOwner(EncryptedAlertJournalStore(context, key), poster)
      restarted.replay()
      assertEquals(event.eventId, restarted.pending().single().eventId)
      assertTrue(manager.activeNotifications.none { it.tag == event.eventId })
      restarted.acknowledge(setOf(event.eventId))
      assertTrue(restarted.pending().isEmpty())
    } finally {
      manager.cancelAll()
      StreamFusionSecureStore(context).delete(key)
    }
  }

  @Test fun postingDisabledStillRecordsHistoryAndHistoryDisabledCancelsPeriodicWork() {
    val key = "live-alert-test-settings"
    val store = EncryptedAlertJournalStore(context, key)
    store.write(AlertJournal())
    val posts = mutableListOf<String>()
    val owner = LiveAlertOwner(store, AlertPoster { event, _ -> posts.add(event.eventId); true })
    val manager = WorkManager.getInstance(context)
    try {
      val configured = owner.configure(listOf(channel), AlertPolicy(systemAlerts = false), listOf(AlertObservation(channel.key, 1, AlertRead.Offline), AlertObservation(channel.key, 2, AlertRead.Live("100", "Live title"))))
      LiveAlertSchedule.update(context, configured)
      val first = manager.getWorkInfosForUniqueWork(LiveAlertSchedule.NAME).get(10, TimeUnit.SECONDS).single { !it.state.isFinished }
      LiveAlertSchedule.update(context, configured)
      val updated = manager.getWorkInfosForUniqueWork(LiveAlertSchedule.NAME).get(10, TimeUnit.SECONDS).single { !it.state.isFinished }
      assertEquals(first.id, updated.id)
      assertEquals("100", owner.pending().single().streamId)
      assertTrue(posts.isEmpty())
      val disabled = owner.configure(listOf(channel), AlertPolicy(historyEnabled = false))
      LiveAlertSchedule.update(context, disabled)
      assertTrue(manager.getWorkInfosForUniqueWork(LiveAlertSchedule.NAME).get(10, TimeUnit.SECONDS).all { it.state.isFinished })
      assertEquals(1, owner.pending().size)
    } finally { manager.cancelUniqueWork(LiveAlertSchedule.NAME).result.get(); StreamFusionSecureStore(context).delete(key) }
  }

  @Test fun publicProviderResponsesDistinguishVerifiedOfflineMalformedAndChangedSessions() = https { server, client ->
    val twitch = AlertChannel("twitch", "1", "example", "Example")
    val reader = PublicLiveAlertReader(client, server.url("/gql").toString(), server.url("/").toString())
    server.enqueue(MockResponse().setBody("""{"data":{"channel0":{"id":"1","login":"example","stream":null}}}"""))
    assertEquals(AlertRead.Offline, reader.read(listOf(twitch)) { false }.single().read)
    val query = JSONObject(server.takeRequest().body.readUtf8())
    assertEquals("1", query.getJSONObject("variables").getString("id0"))
    server.enqueue(MockResponse().setBody("""{"data":{"channel0":{"id":"1","login":"example","stream":{"id":"100","title":"Live"}}}}"""))
    assertEquals(AlertRead.Live("100", "Live"), reader.read(listOf(twitch)) { false }.single().read)
    server.enqueue(MockResponse().setBody("""{"data":{"channel0":{"id":"1","login":"example"}}}"""))
    assertEquals(AlertRead.Unavailable, reader.read(listOf(twitch)) { false }.single().read)
    server.enqueue(MockResponse().setBody("""{"data":{"channel0":{"id":"2","login":"example","stream":{"id":"100","title":"Wrong broadcaster"}}}}"""))
    assertEquals(AlertRead.Unavailable, reader.read(listOf(twitch)) { false }.single().read)
    server.enqueue(kick("""{"id":100,"session_title":"Live"}"""))
    assertEquals(AlertRead.Live("100", "Live"), reader.read(listOf(channel)) { false }.single().read)
    server.enqueue(kick("""{"id":101,"is_live":false}"""))
    assertEquals(AlertRead.Offline, reader.read(listOf(channel)) { false }.single().read)
    server.enqueue(kick("{}"))
    assertEquals(AlertRead.Unavailable, reader.read(listOf(channel)) { false }.single().read)
    server.enqueue(MockResponse().setBody("<html>Blocked</html>"))
    assertEquals(AlertRead.Unavailable, reader.read(listOf(channel)) { false }.single().read)
  }

  @Test fun numericTwitchIdentitySurvivesRename() = https { server, client ->
    val twitch = AlertChannel("twitch", "1", "oldlogin", "Example")
    val reader = PublicLiveAlertReader(client, server.url("/gql").toString(), server.url("/").toString())
    server.enqueue(MockResponse().setBody("""{"data":{"channel0":{"id":"1","login":"newlogin","stream":{"id":"100","title":"Renamed stream"}}}}"""))
    val observation = reader.read(listOf(twitch)) { false }.single()
    assertEquals(AlertRead.Live("100", "Renamed stream", "newlogin"), observation.read)
    assertEquals("1", JSONObject(server.takeRequest().body.readUtf8()).getJSONObject("variables").getString("id0"))
    val key = "live-alert-test-rename"
    val store = EncryptedAlertJournalStore(context, key)
    store.write(AlertJournal())
    val owner = LiveAlertOwner(store, AlertPoster { _, _ -> false })
    try {
      owner.configure(listOf(twitch), AlertPolicy(systemAlerts = false), listOf(AlertObservation(twitch.key, 1, AlertRead.Offline)))
      owner.accept(owner.lease(), listOf(observation), observation.observedAtMs)
      val destination = AlertJson.payload(owner.pending().single()).getJSONObject("destination")
      assertEquals("1", destination.getString("channelId"))
      assertEquals("newlogin", destination.getString("channelLogin"))
    } finally { StreamFusionSecureStore(context).delete(key) }
  }

  @Test fun numericTwitchIdentityRejectsAnotherBroadcaster() = https { server, client ->
    val twitch = AlertChannel("twitch", "1", "oldlogin", "Example")
    val reader = PublicLiveAlertReader(client, server.url("/gql").toString(), server.url("/").toString())
    server.enqueue(MockResponse().setBody("""{"data":{"channel0":{"id":"2","login":"oldlogin","stream":{"id":"101","title":"Wrong broadcaster"}}}}"""))
    assertEquals(AlertRead.Unavailable, reader.read(listOf(twitch)) { false }.single().read)
  }

  @Test fun kickRootOfflineOverridesAnOldNestedStream() = https { server, client ->
    server.enqueue(MockResponse().setBody("""{"id":42,"slug":"example","is_live":false,"livestream":{"id":102,"session_title":"Old stream"}}"""))
    val reader = PublicLiveAlertReader(client, server.url("/gql").toString(), server.url("/").toString())
    assertEquals(AlertRead.Offline, reader.read(listOf(channel)) { false }.single().read)
  }

  @Test fun contradictoryKickLiveFlagWithoutAStreamIsUnavailable() = https { server, client ->
    server.enqueue(MockResponse().setBody("""{"id":42,"slug":"example","is_live":true,"livestream":null}"""))
    val reader = PublicLiveAlertReader(client, server.url("/gql").toString(), server.url("/").toString())
    assertEquals(AlertRead.Unavailable, reader.read(listOf(channel)) { false }.single().read)
  }

  @Test fun bridgeBoundaryRejectsMalformedSnapshotsAndAcknowledgements() {
    fun snapshot() = JSONObject().put("schemaVersion", 1).put("channels", JSONArray().put(JSONObject()
      .put("platform", "kick").put("channelId", channel.channelId).put("channelLogin", channel.channelLogin).put("displayName", channel.displayName)))
      .put("policy", JSONObject().put("historyEnabled", true).put("systemAlerts", true).put("toastAlerts", true).put("sound", true).put("restartGraceMinutes", 5))
      .put("observations", JSONArray().put(JSONObject().put("platform", "kick").put("channelId", channel.channelId)
        .put("observedAtMs", 100).put("kind", "live").put("streamId", "100").put("title", "Live title")))
    fun reject(json: JSONObject) {
      try { BackgroundCheckRequests.snapshot(json.toString()); fail("Malformed snapshot was accepted") }
      catch (_: IllegalArgumentException) { }
      catch (_: org.json.JSONException) { }
    }
    val (channels, policy, observations) = BackgroundCheckRequests.snapshot(snapshot().toString())
    assertEquals(listOf(channel), channels)
    assertEquals(5, policy.restartGraceMinutes)
    assertEquals(AlertRead.Live("100", "Live title"), observations.single().read)
    val unsafeName = channel.copy(channelLogin = "bearer", displayName = "bearer")
    val safePayload = AlertJson.payload(AlertEvent("local:live-alert:test:safe-name", unsafeName, "100", "Live title", 100))
    assertEquals("A followed channel is live", safePayload.getString("title"))
    reject(snapshot().put("schemaVersion", 2))
    reject(snapshot().put("extra", true))
    reject(snapshot().apply { getJSONObject("policy").put("historyEnabled", "true") })
    reject(snapshot().apply { getJSONObject("policy").put("restartGraceMinutes", 3) })
    reject(snapshot().apply { getJSONArray("channels").put(getJSONArray("channels").getJSONObject(0)) })
    reject(snapshot().apply { getJSONArray("observations").getJSONObject(0).put("channelId", "not-followed") })
    reject(snapshot().apply { getJSONArray("observations").getJSONObject(0).put("observedAtMs", 1.5) })
    reject(snapshot().apply { getJSONArray("channels").getJSONObject(0).put("channelLogin", "../other") })
    assertEquals(setOf("event:1"), BackgroundCheckRequests.acknowledgements("[\"event:1\",\"event:1\"]"))
    try { BackgroundCheckRequests.acknowledgements("[1]"); fail("Non-string acknowledgement was accepted") }
    catch (_: IllegalArgumentException) { }
  }
}
