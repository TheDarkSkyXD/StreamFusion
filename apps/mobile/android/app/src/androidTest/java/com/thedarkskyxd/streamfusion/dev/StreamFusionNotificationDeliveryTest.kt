package com.thedarkskyxd.streamfusion.dev

import android.app.NotificationManager
import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.messaging.RemoteMessage
import expo.modules.streamfusionnativecontracts.StreamFusionNotificationsModule
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StreamFusionNotificationDeliveryTest {
  @Test
  fun repeatedRemoteLiveEventPostsOneSystemAlert() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.activeNotifications.filter {
      it.notification.extras.getString("android.title") == "Live notification verification"
    }.forEach { manager.cancel(it.tag, it.id) }
    val eventId = "native-live-delivery-proof-${System.nanoTime()}"
    val payload = JSONObject()
      .put("schemaVersion", 1)
      .put("eventId", eventId)
      .put("sourceId", "native-live-delivery-proof-source")
      .put("channel", "live")
      .put("title", "Live notification verification")
      .put("body", "A remote event reaches the Android notification tray.")
      .put("occurredAt", "2026-10-12T21:00:00.000Z")
      .put("destination", JSONObject()
        .put("kind", "watch-channel")
        .put("platform", "twitch")
        .put("channelId", "71092938")
        .put("channelLogin", "xqc")
        .put("streamState", "live"))
      .toString()
    val message = RemoteMessage.Builder("notification-test").addData("payload", payload).build()
    try {
      StreamFusionNotificationsModule.deliverRemote(context, message)
      StreamFusionNotificationsModule.deliverRemote(context, message)
      val alerts = manager.activeNotifications.filter {
        it.notification.extras.getString("android.title") == "Live notification verification"
      }
      assertEquals("A retried live event must have one tray entry. Tags: ${alerts.map { it.tag }}", 1, alerts.size)
      assertEquals("live", alerts.single().notification.channelId)
      assertNotNull(alerts.single().notification.contentIntent)
    } finally {
      manager.activeNotifications.filter {
        it.notification.extras.getString("android.title") == "Live notification verification"
      }.forEach { manager.cancel(it.tag, it.id) }
    }
  }
}
