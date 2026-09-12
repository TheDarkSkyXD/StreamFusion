package expo.modules.streamfusionnativecontracts

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class MediaJobForegroundService : Service() {
  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "Media Jobs",
          NotificationManager.IMPORTANCE_LOW,
        ),
      )
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null) {
      val restored = MediaJobEngine.get(this).restoreOwnedJobs()
      if (restored.isEmpty()) {
        stopSelf(startId)
        return START_NOT_STICKY
      }
      promoteForeground(restored.first())
      return START_STICKY
    }
    promoteForeground(intent.getStringExtra("jobId") ?: "media-job")
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun promoteForeground(jobId: String) {
    val notification = notification("Media Job $jobId is running.")
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun notification(text: String): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("StreamFusion Media Job")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setOngoing(true)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "streamfusion-media-jobs"
    private const val NOTIFICATION_ID = 16301
  }
}
