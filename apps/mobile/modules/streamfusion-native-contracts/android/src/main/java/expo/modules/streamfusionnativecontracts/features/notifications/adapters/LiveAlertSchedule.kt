package expo.modules.streamfusionnativecontracts

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

internal object LiveAlertSchedule {
  const val NAME = "streamfusion.live-alert-poll.v1"
  fun update(context: Context, journal: AlertJournal) {
    val manager = WorkManager.getInstance(context.applicationContext)
    if (!journal.policy.historyEnabled || journal.channels.isEmpty()) {
      manager.cancelUniqueWork(NAME).result.get()
      return
    }
    val request = PeriodicWorkRequestBuilder<StreamFusionLiveAlertWorker>(15, TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .addTag(NAME).build()
    manager.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request).result.get()
  }
}
