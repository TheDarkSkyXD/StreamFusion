package expo.modules.streamfusionnativecontracts

import android.content.Context

internal object BackgroundLiveAlerts {
  fun owner(context: Context) = LiveAlertOwner(EncryptedAlertJournalStore(context), AlertPoster { event, silent ->
    val payload = AlertJson.payload(event)
    StreamFusionNotificationsModule.showNotification(context.applicationContext, payload.getString("title"), payload.getString("body"), payload.toString(), "live", silent)
  })
}
