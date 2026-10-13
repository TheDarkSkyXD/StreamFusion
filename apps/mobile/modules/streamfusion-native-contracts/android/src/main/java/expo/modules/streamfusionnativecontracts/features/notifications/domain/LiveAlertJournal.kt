package expo.modules.streamfusionnativecontracts

internal data class AlertChannel(val platform: String, val channelId: String, val channelLogin: String, val displayName: String) {
  val key: String get() = "$platform:$channelId"
}
internal data class AlertPolicy(val historyEnabled: Boolean = true, val systemAlerts: Boolean = true, val toastAlerts: Boolean = true, val sound: Boolean = true, val restartGraceMinutes: Int = 0)
internal sealed interface AlertRead {
  data object Offline : AlertRead
  data class Live(val streamId: String, val title: String, val resolvedLogin: String? = null) : AlertRead
  data object Unavailable : AlertRead
}
internal data class AlertObservation(val channelKey: String, val observedAtMs: Long, val read: AlertRead)
internal data class AlertBaseline(val observedAtMs: Long, val streamId: String?, val lastRecordedAtMs: Long? = null, val handledStreams: List<String> = emptyList())
internal data class AlertEvent(val eventId: String, val channel: AlertChannel, val streamId: String, val title: String, val occurredAtMs: Long, val postState: String = "planned")
internal data class AlertJournal(val channels: List<AlertChannel> = emptyList(), val policy: AlertPolicy = AlertPolicy(historyEnabled = false), val generation: Long = 0, val revision: Long = 0, val baselines: Map<String, AlertBaseline> = emptyMap(), val events: List<AlertEvent> = emptyList(), val lastCheckedAtMs: Long? = null, val failure: String? = null, val pollCursor: Int = 0)
internal data class AlertLease(val generation: Long, val revision: Long, val channels: List<AlertChannel>)

internal class LiveAlertOwner(private val store: AlertJournalStore, private val poster: AlertPoster) {
  fun configure(channels: List<AlertChannel>, policy: AlertPolicy, observations: List<AlertObservation> = emptyList()): AlertJournal = synchronized(lock) {
    val current = store.read()
    val normalized = channels.distinctBy { it.key }.sortedBy { it.key }
    val changed = normalized != current.channels || policy != current.policy
    val keys = normalized.map { it.key }.toSet()
    val baselines = current.baselines.filterKeys { it in keys } + current.baselines.filterKeys { it !in keys }.entries.toList().takeLast(128).associate { it.toPair() }
    val configured = current.copy(channels = normalized, policy = policy, baselines = baselines,
      generation = current.generation + if (changed) 1 else 0, pollCursor = if (changed) 0 else current.pollCursor)
    val reconciled = reconcile(configured, observations)
    if (reconciled != current) store.write(reconciled.copy(revision = current.revision + 1))
    replayLocked()
    store.read()
  }

  fun lease(): AlertLease = synchronized(lock) {
    replayLocked()
    val current = store.read()
    val channels = if (!current.policy.historyEnabled) emptyList() else current.channels
    val cursor = if (channels.isEmpty()) 0 else current.pollCursor.mod(channels.size)
    AlertLease(current.generation, current.revision, channels.drop(cursor) + channels.take(cursor))
  }

  fun accept(lease: AlertLease, observations: List<AlertObservation>, checkedAtMs: Long): Boolean = synchronized(lock) {
    val current = store.read()
    if (current.generation != lease.generation || current.revision != lease.revision) return@synchronized false
    val next = reconcile(current, observations).copy(lastCheckedAtMs = checkedAtMs,
      pollCursor = if (current.channels.isEmpty()) 0 else (current.pollCursor + observations.size).mod(current.channels.size),
      revision = current.revision + 1)
    store.write(next)
    replayLocked()
    true
  }

  fun pending(): List<AlertEvent> = synchronized(lock) { replayLocked(); store.read().events }
  fun acknowledge(ids: Set<String>): Unit = synchronized(lock) {
    val current = store.read()
    val events = current.events.filterNot { it.eventId in ids }
    if (events != current.events) store.write(current.copy(events = events,
      failure = if (current.failure == "inbox-full") null else current.failure))
  }
  fun replay(): Unit = synchronized(lock) { replayLocked() }
  fun status(): AlertJournal = synchronized(lock) { store.read() }

  private fun replayLocked() {
    val current = store.read()
    val planned = current.events.filter { it.postState == "planned" }
    if (planned.isEmpty()) return
    val membership = current.channels.map { it.key }.toSet()
    val claims = planned.associate { event ->
      val eligible = current.policy.historyEnabled && current.policy.systemAlerts && event.channel.key in membership
      event.eventId to event.copy(postState = if (eligible) "attempted" else "skipped")
    }
    store.write(current.copy(events = current.events.map { claims[it.eventId] ?: it }))
    val results = claims.values.filter { it.postState == "attempted" }.associate { event ->
      val posted = try { poster.post(event, !current.policy.sound) } catch (_: Exception) { false }
      event.eventId to event.copy(postState = if (posted) "posted" else "skipped")
    }
    if (results.isNotEmpty()) {
      val latest = store.read()
      store.write(latest.copy(events = latest.events.map { results[it.eventId] ?: it }))
    }
  }

  companion object {
    private val lock = Any()
    private fun reconcile(journal: AlertJournal, observations: List<AlertObservation>): AlertJournal {
      var baselines = journal.baselines
      var events = journal.events
      var failure: String? = if (events.size >= 512) "inbox-full" else if (observations.isEmpty()) journal.failure else null
      val channels = journal.channels.associateBy { it.key }
      for (observation in observations) {
        val channel = channels[observation.channelKey] ?: continue
        if (!journal.policy.historyEnabled) continue
        if (observation.read == AlertRead.Unavailable) { if (failure == null) failure = "provider-unavailable"; continue }
        val previous = baselines[channel.key]
        if (previous != null && observation.observedAtMs <= previous.observedAtMs) continue
        val live = observation.read as? AlertRead.Live
        val session = live?.streamId
        val handled = previous?.handledStreams.orEmpty()
        val transition = previous != null && session != null && session != previous.streamId && session !in handled
        val grace = previous?.lastRecordedAtMs?.let { observation.observedAtMs - it < journal.policy.restartGraceMinutes * 60_000L } ?: false
        var recordedAt = previous?.lastRecordedAtMs
        if (transition && !grace) {
          if (events.size >= 512) {
            failure = "inbox-full"
            continue
          } else {
            val identity = listOf(channel.platform, channel.channelId, session!!).joinToString("") { "${it.length}:$it" }
            val digest = java.security.MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
            val eventChannel = live!!.resolvedLogin?.let { channel.copy(channelLogin = it) } ?: channel
            events = events + AlertEvent("local:live-alert:v2:${channel.platform}:$digest", eventChannel, session, live.title, observation.observedAtMs)
            recordedAt = observation.observedAtMs
          }
        }
        val retained = if (session == null || session in handled) handled else (handled + session).takeLast(64)
        baselines = baselines + (channel.key to AlertBaseline(observation.observedAtMs, session, recordedAt, retained))
      }
      return journal.copy(baselines = baselines, events = events, failure = failure)
    }
  }
}
