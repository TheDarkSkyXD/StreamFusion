package com.thedarkskyxd.streamfusion.dev.features.notifications.tests

import android.app.NotificationManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.BridgeReactContext
import expo.modules.streamfusionnativecontracts.StreamFusionNotificationsModule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class StreamFusionBackgroundInboxTest {
  private fun call(action: (Promise) -> Unit): Any? {
    val completion = CompletableFuture<Any?>()
    action(PromiseImpl(Callback { values -> completion.complete(values.firstOrNull()) },
      Callback { completion.completeExceptionally(IllegalStateException("Native notification bridge rejected the request")) }))
    return completion.get(30, TimeUnit.SECONDS)
  }

  @Test fun verifiedNativeTransitionPersistsAnInboxEventAndPostsOneAppNotification() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val module = StreamFusionNotificationsModule(BridgeReactContext(context))
    val now = (System.currentTimeMillis() / 1000 + 1) * 1000
    val streamId = "app-inbox-verification-$now"
    val body = "Native background notification verification"
    val prior = JSONArray(call { module.readBackgroundEvents(it) } as String)
    val priorIds = (0 until prior.length()).map { prior.getJSONObject(it) }
      .filter { it.getString("body") == body }.map { it.getString("eventId") }
    call { module.acknowledgeBackgroundEvents(JSONArray(priorIds).toString(), it) }
    val manager = requireNotNull(context.getSystemService(NotificationManager::class.java))
    manager.activeNotifications.filter { it.tag in priorIds }.forEach { manager.cancel(it.tag, it.id) }
    val channel = JSONObject().put("platform", "twitch").put("channelId", "71092938")
      .put("channelLogin", "xqc").put("displayName", "xQc")
    val policy = JSONObject().put("historyEnabled", true).put("systemAlerts", true)
      .put("toastAlerts", false).put("sound", false).put("restartGraceMinutes", 0)
    fun configure(kind: String, time: Long) {
      val observation = JSONObject().put("platform", "twitch").put("channelId", "71092938")
        .put("kind", kind).put("observedAtMs", time)
      if (kind == "live") observation.put("streamId", streamId).put("title", body)
      val snapshot = JSONObject().put("schemaVersion", 1).put("channels", JSONArray().put(channel))
        .put("policy", policy).put("observations", JSONArray().put(observation)).toString()
      call { module.configureBackgroundChecks(snapshot, it) }
    }
    call { module.configureLiveAlerts(true, false, it) }
    configure("offline", now)
    configure("live", now + 1000)
    configure("live", now + 1001)
    val pending = call { module.readBackgroundEvents(it) }
    check(pending is String)
    val events = JSONArray(pending)
    val verification = (0 until events.length()).map { events.getJSONObject(it) }
      .filter { it.getString("body") == body }
    assertEquals(1, verification.size)
    assertTrue("Native events must retain UTC millisecond precision", verification.single().getString("occurredAt").endsWith(".000Z"))
    val eventId = verification.single().getString("eventId")
    val alerts = manager.activeNotifications.filter { it.tag == eventId }
    assertEquals(1, alerts.size)
    assertNotNull(alerts.single().notification.contentIntent)
  }
}
