package expo.modules.streamfusionnativecontracts

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal class EncryptedAlertJournalStore(context: Context, private val key: String = "live-alert-journal-v1") : AlertJournalStore {
  private val secure = StreamFusionSecureStore(context.applicationContext)
  override fun read(): AlertJournal = secure.get(key)?.let { AlertJson.journal(JSONObject(it)) } ?: AlertJournal()
  override fun write(journal: AlertJournal) {
    val json = AlertJson.journal(journal).toString()
    check(json.toByteArray(Charsets.UTF_8).size <= 16 * 1024 * 1024) { "The live alert journal is full." }
    secure.set(key, json)
  }
}

internal object AlertJson {
  private val identifier = Regex("[a-zA-Z0-9._:-]{1,256}")
  private val login = Regex("[a-zA-Z0-9_-]{1,64}")
  private val timestamp = java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter()

  fun status(journal: AlertJournal): JSONObject = JSONObject().put("schemaVersion", 1)
    .put("scheduled", journal.policy.historyEnabled && journal.channels.isNotEmpty())
    .put("intervalMinutes", 15).put("channelCount", journal.channels.size)
    .put("lastCheckedAtMs", journal.lastCheckedAtMs ?: JSONObject.NULL)
    .put("failure", journal.failure ?: JSONObject.NULL)

  fun payload(event: AlertEvent): JSONObject = JSONObject().put("schemaVersion", 1)
    .put("eventId", event.eventId).put("sourceId", "device:live-alert:v1").put("channel", "live")
    .put("title", safeAlertText("${event.channel.displayName} is live", "A followed channel is live"))
    .put("body", safeAlertText(event.title, "Tap to watch now."))
    .put("occurredAt", timestamp.format(java.time.Instant.ofEpochMilli(event.occurredAtMs)))
    .put("destination", JSONObject().put("kind", "watch-channel").put("platform", event.channel.platform)
      .put("channelId", event.channel.channelId).put("channelLogin", event.channel.channelLogin).put("streamState", "live"))

  fun journal(journal: AlertJournal): JSONObject = JSONObject().put("schemaVersion", 1)
    .put("channels", JSONArray(journal.channels.map(::channel))).put("policy", policy(journal.policy))
    .put("generation", journal.generation).put("revision", journal.revision).put("pollCursor", journal.pollCursor)
    .put("lastCheckedAtMs", journal.lastCheckedAtMs ?: JSONObject.NULL).put("failure", journal.failure ?: JSONObject.NULL)
    .put("baselines", JSONObject().also { root -> journal.baselines.forEach { (key, baseline) ->
      root.put(key, JSONObject().put("observedAtMs", baseline.observedAtMs).put("streamId", baseline.streamId ?: JSONObject.NULL)
        .put("lastRecordedAtMs", baseline.lastRecordedAtMs ?: JSONObject.NULL).put("handledStreams", JSONArray(baseline.handledStreams)))
    } })
    .put("events", JSONArray(journal.events.map { event -> JSONObject().put("eventId", event.eventId)
      .put("channel", channel(event.channel)).put("streamId", event.streamId).put("title", event.title)
      .put("occurredAtMs", event.occurredAtMs).put("postState", event.postState) }))

  fun journal(root: JSONObject): AlertJournal {
    require(root.getInt("schemaVersion") == 1)
    val baselines = root.getJSONObject("baselines")
    return AlertJournal(channels = root.getJSONArray("channels").objects().map(::channel), policy = policy(root.getJSONObject("policy")),
      generation = root.getLong("generation"), revision = root.getLong("revision"), pollCursor = root.getInt("pollCursor"),
      lastCheckedAtMs = root.nullableLong("lastCheckedAtMs"), failure = root.nullableString("failure"),
      baselines = baselines.keys().asSequence().associateWith { key -> baselines.getJSONObject(key).let { item ->
        AlertBaseline(item.getLong("observedAtMs"), item.nullableString("streamId"), item.nullableLong("lastRecordedAtMs"),
          item.getJSONArray("handledStreams").let { array -> (0 until array.length()).map { array.getString(it) } })
      } }, events = root.getJSONArray("events").objects().map { item ->
        val state = item.getString("postState").also { require(it in setOf("planned", "attempted", "posted", "skipped")) }
        AlertEvent(item.getString("eventId"), channel(item.getJSONObject("channel")), item.getString("streamId"), item.getString("title"), item.getLong("occurredAtMs"), state)
      })
  }

  fun channel(item: JSONObject): AlertChannel {
    item.only("platform", "channelId", "channelLogin", "displayName")
    return AlertChannel(item.platform(), item.string("channelId").also { require(identifier.matches(it)) },
      item.string("channelLogin").also { require(login.matches(it)) }, safeAlertText(item.string("displayName"), item.string("channelLogin")))
  }
  private fun channel(value: AlertChannel) = JSONObject().put("platform", value.platform).put("channelId", value.channelId)
    .put("channelLogin", value.channelLogin).put("displayName", value.displayName)
  fun policy(item: JSONObject): AlertPolicy {
    item.only("historyEnabled", "systemAlerts", "toastAlerts", "sound", "restartGraceMinutes")
    val grace = item.get("restartGraceMinutes").also { require(it is Int && it in setOf(0, 5, 15, 30)) } as Int
    return AlertPolicy(item.boolean("historyEnabled"), item.boolean("systemAlerts"), item.boolean("toastAlerts"), item.boolean("sound"), grace)
  }
  private fun policy(value: AlertPolicy) = JSONObject().put("historyEnabled", value.historyEnabled).put("systemAlerts", value.systemAlerts)
    .put("toastAlerts", value.toastAlerts).put("sound", value.sound).put("restartGraceMinutes", value.restartGraceMinutes)
  private fun JSONObject.only(vararg keys: String) { require(keys().asSequence().toSet() == keys.toSet()) }
  private fun JSONObject.string(key: String): String = get(key).let { require(it is String); it }
  private fun JSONObject.boolean(key: String): Boolean = get(key).let { require(it is Boolean); it }
  private fun JSONObject.platform(): String = string("platform").also { require(it == "twitch" || it == "kick") }
  private fun JSONObject.nullableLong(key: String): Long? = if (isNull(key)) null else getLong(key)
  private fun JSONObject.nullableString(key: String): String? = if (isNull(key)) null else getString(key)
  private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
}
