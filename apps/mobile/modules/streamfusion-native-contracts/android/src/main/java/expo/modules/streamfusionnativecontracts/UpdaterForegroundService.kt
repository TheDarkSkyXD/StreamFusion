package expo.modules.streamfusionnativecontracts

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class UpdaterForegroundService : Service() {
  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= 26) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL, "App update", NotificationManager.IMPORTANCE_LOW),
      )
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = Notification.Builder(this, CHANNEL)
      .setContentTitle("StreamFusion update")
      .setContentText("Downloading and verifying the update")
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setOngoing(true).build()
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else startForeground(NOTIFICATION_ID, notification)
    } catch (_: RuntimeException) {
      UpdaterEngine.get(this).serviceLimit()
      stopSelf(startId)
      return START_NOT_STICKY
    }
    UpdaterEngine.get(this).startTransferFromService()
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    UpdaterEngine.get(this).serviceLimit()
    stopSelf(startId)
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    private const val CHANNEL = "streamfusion-update"
    private const val NOTIFICATION_ID = 16309
  }
}
