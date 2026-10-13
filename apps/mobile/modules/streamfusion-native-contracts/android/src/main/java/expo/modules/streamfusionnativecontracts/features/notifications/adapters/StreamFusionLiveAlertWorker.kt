package expo.modules.streamfusionnativecontracts

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters

class StreamFusionLiveAlertWorker : Worker {
  private val owner: LiveAlertOwner
  private val reader: AlertReader

  constructor(context: Context, parameters: WorkerParameters) : this(context, parameters,
    BackgroundLiveAlerts.owner(context), PublicLiveAlertReader())

  internal constructor(context: Context, parameters: WorkerParameters, owner: LiveAlertOwner, reader: AlertReader) : super(context, parameters) {
    this.owner = owner
    this.reader = reader
  }

  override fun doWork(): Result = try {
    val lease = owner.lease()
    if (lease.channels.isNotEmpty()) {
      val observations = reader.read(lease.channels) { isStopped }
      if (isStopped) Result.success()
      else {
        val accepted = owner.accept(lease, observations, System.currentTimeMillis())
        Log.i("StreamFusionLiveAlerts", "Native poll completed. channels=${observations.size} accepted=$accepted")
        Result.success()
      }
    } else Result.success()
  } catch (_: Exception) {
    Log.w("StreamFusionLiveAlerts", "Native poll could not access its journal.")
    Result.retry()
  }

  override fun onStopped() { reader.cancel() }
}
