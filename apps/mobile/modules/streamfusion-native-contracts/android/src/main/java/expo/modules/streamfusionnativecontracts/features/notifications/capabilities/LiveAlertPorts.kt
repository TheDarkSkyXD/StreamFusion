package expo.modules.streamfusionnativecontracts

internal interface AlertJournalStore { fun read(): AlertJournal; fun write(journal: AlertJournal) }
internal fun interface AlertPoster { fun post(event: AlertEvent, silent: Boolean): Boolean }
internal interface AlertReader {
  fun read(channels: List<AlertChannel>, stopped: () -> Boolean): List<AlertObservation>
  fun cancel()
}
