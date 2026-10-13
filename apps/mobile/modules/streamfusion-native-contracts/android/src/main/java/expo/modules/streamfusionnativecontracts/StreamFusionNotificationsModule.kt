package expo.modules.streamfusionnativecontracts

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import org.json.JSONArray
import org.json.JSONObject

class StreamFusionNotificationsModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  override fun getName() = "StreamFusionNotifications"

  init {
    activeContext = context
  }

  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    promise.resolve(permissionStatus(context))
  }

  @ReactMethod
  fun requestPermission(promise: Promise) {
    val status = permissionStatus(context)
    if (Build.VERSION.SDK_INT < 33 || status == "granted") {
      promise.resolve(status)
      return
    }
    val activity = context.currentActivity as? PermissionAwareActivity
    if (activity == null) {
      promise.resolve("unavailable")
      return
    }
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit().putBoolean("permission-requested", true).apply()
    val listener = PermissionListener { requestCode, _, _ ->
      if (requestCode != PERMISSION_REQUEST) return@PermissionListener false
      promise.resolve(permissionStatus(context))
      true
    }
    activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), PERMISSION_REQUEST, listener)
  }

  @ReactMethod
  fun ensureChannels(promise: Promise) = NativeBridge.onMain(promise) {
    createChannels(context)
    null
  }

  @ReactMethod
  fun configureLiveAlerts(enabled: Boolean, sound: Boolean, promise: Promise) = NativeBridge.onMain(promise) {
    val saved = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
      .putBoolean("live-enabled", enabled).putBoolean("live-sound", sound).commit()
    check(saved) { "Notification settings could not be saved." }
    null
  }

  @ReactMethod
  fun present(title: String, body: String, payloadJson: String, channel: String, silent: Boolean, promise: Promise) = NativeBridge.onMain(promise) {
    if (permissionStatus(context) != "granted") return@onMain null
    JSONObject(payloadJson)
    showNotification(context, title, body, payloadJson, channel, silent)
    null
  }

  @ReactMethod
  fun getInitialResponse(promise: Promise) {
    val activity = context.currentActivity
    if (activity != null) captureIntent(activity.intent)
    val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    val value = preferences.getString("last-response", null)
    preferences.edit().remove("last-response").apply()
    promise.resolve(value)
  }

  @ReactMethod
  fun configureBackgroundChecks(snapshotJson: String, promise: Promise) = NativeBridge.async(promise) {
    BackgroundCheckRequests.configure(context, snapshotJson)
  }

  @ReactMethod
  fun getBackgroundCheckStatus(promise: Promise) = NativeBridge.async(promise) {
    BackgroundCheckRequests.status(context)
  }

  @ReactMethod
  fun readBackgroundEvents(promise: Promise) = NativeBridge.async(promise) {
    JSONArray(BackgroundLiveAlerts.owner(context).pending().map { AlertJson.payload(it) }).toString()
  }

  @ReactMethod
  fun acknowledgeBackgroundEvents(eventIdsJson: String, promise: Promise) = NativeBridge.async(promise) {
    BackgroundLiveAlerts.owner(context).acknowledge(BackgroundCheckRequests.acknowledgements(eventIdsJson))
    null
  }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  override fun invalidate() {
    if (activeContext === context) activeContext = null
    super.invalidate()
  }

  companion object {
    private const val PREFERENCES = "streamfusion-notifications"
    private const val EXTRA_PAYLOAD = "streamfusion.notification.payload"
    private const val PERMISSION_REQUEST = 9204
    private var activeContext: ReactApplicationContext? = null

    fun captureIntent(intent: Intent?) {
      val payload = intent?.getStringExtra(EXTRA_PAYLOAD) ?: return
      intent.removeExtra(EXTRA_PAYLOAD)
      val context = activeContext ?: return
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .edit().putString("last-response", payload).apply()
      NativeBridge.emit(context, "notificationOpened", mapOf("payloadJson" to payload))
    }

    fun captureIntent(context: Context, intent: Intent?) {
      val payload = intent?.getStringExtra(EXTRA_PAYLOAD) ?: return
      intent.removeExtra(EXTRA_PAYLOAD)
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .edit().putString("last-response", payload).apply()
      activeContext?.let { NativeBridge.emit(it, "notificationOpened", mapOf("payloadJson" to payload)) }
    }

    private fun permissionStatus(context: Context): String {
      if (Build.VERSION.SDK_INT < 33) {
        return if (NotificationManagerCompat.from(context).areNotificationsEnabled()) "granted" else "denied"
      }
      if (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
        return if (NotificationManagerCompat.from(context).areNotificationsEnabled()) "granted" else "denied"
      }
      val requested = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .getBoolean("permission-requested", false)
      return if (requested) "denied" else "not-requested"
    }

    private fun createChannels(context: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      for ((id, name, importance) in listOf(
        Triple("live", "Live alerts", NotificationManager.IMPORTANCE_HIGH),
        Triple("media", "Downloads and recordings", NotificationManager.IMPORTANCE_DEFAULT),
        Triple("account-device", "Account and device", NotificationManager.IMPORTANCE_DEFAULT),
      )) {
        manager.createNotificationChannel(NotificationChannel(id, name, importance))
      }
    }

    internal fun showNotification(
      context: Context,
      title: String,
      body: String,
      payloadJson: String,
      channel: String,
      silent: Boolean,
    ): Boolean {
      if (permissionStatus(context) != "granted") return false
      if (channel !in setOf("live", "media", "account-device")) return false
      val payload = JSONObject(payloadJson)
      val eventId = payload.optString("eventId")
      if (eventId.isEmpty()) return false
      val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      if (channel == "live") {
        if (!preferences.getBoolean("live-enabled", true)) return false
        val destination = payload.optJSONObject("destination")
        if (destination?.optString("kind") == "watch-channel" && destination.optString("streamState") != "live") return false
      }
      createChannels(context)
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return false
      launch.putExtra(EXTRA_PAYLOAD, payloadJson)
      launch.identifier = eventId
      launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val tap = PendingIntent.getActivity(
        context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val icon = context.applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
      val notification = NotificationCompat.Builder(context, channel)
        .setSmallIcon(icon)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setContentIntent(tap)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setPriority(if (channel == "live") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
        .setSilent(silent || (channel == "live" && !preferences.getBoolean("live-sound", true)))
        .build()
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(eventId, 0, notification)
      return true
    }
  }
}
