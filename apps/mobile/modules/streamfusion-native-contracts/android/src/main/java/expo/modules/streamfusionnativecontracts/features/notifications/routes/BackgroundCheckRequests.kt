package expo.modules.streamfusionnativecontracts

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal object BackgroundCheckRequests {
  private val identifier = Regex("[a-zA-Z0-9._:-]{1,256}")
  private val configureLock = Any()

  fun configure(context: Context, json: String): String {
    val (channels, policy, observations) = snapshot(json)
    return synchronized(configureLock) {
      val journal = BackgroundLiveAlerts.owner(context).configure(channels, policy, observations)
      LiveAlertSchedule.update(context, journal)
      AlertJson.status(journal).toString()
    }
  }

  fun status(context: Context): String = try { AlertJson.status(BackgroundLiveAlerts.owner(context).status()).toString() }
    catch (_: Exception) { AlertJson.status(AlertJournal(failure = "storage-unavailable")).toString() }

  fun snapshot(json: String): Triple<List<AlertChannel>, AlertPolicy, List<AlertObservation>> {
    require(json.toByteArray(Charsets.UTF_8).size <= 8 * 1024 * 1024) { "The background snapshot is too large." }
    val root = JSONObject(json)
    root.only("schemaVersion", "channels", "policy", "observations")
    require(root.get("schemaVersion") == 1)
    val channels = root.getJSONArray("channels").objects().map(AlertJson::channel)
    require(channels.size <= 20_000 && channels.map { it.key }.distinct().size == channels.size)
    val policy = AlertJson.policy(root.getJSONObject("policy"))
    val keys = channels.map { it.key }.toSet()
    val observations = root.getJSONArray("observations").objects().map { item ->
      val kind = item.string("kind")
      item.only(*(if (kind == "live") arrayOf("platform", "channelId", "observedAtMs", "kind", "streamId", "title") else arrayOf("platform", "channelId", "observedAtMs", "kind")))
      val platform = item.platform()
      val id = item.string("channelId").also { require(identifier.matches(it)) }
      val time = item.epoch("observedAtMs")
      val read = when (kind) {
        "offline" -> AlertRead.Offline
        "live" -> AlertRead.Live(item.string("streamId").also { require(identifier.matches(it)) }, safeAlertText(item.string("title"), "Tap to watch now."))
        else -> throw IllegalArgumentException("The observation kind is invalid.")
      }
      AlertObservation("$platform:$id", time, read).also { require(it.channelKey in keys) }
    }
    require(observations.size <= 40_000)
    return Triple(channels, policy, observations)
  }

  fun acknowledgements(json: String): Set<String> {
    require(json.length <= 256 * 1024)
    val array = JSONArray(json)
    require(array.length() <= 512)
    return (0 until array.length()).map { array.get(it).let { value ->
      require(value is String && identifier.matches(value)); value
    } }.toSet()
  }

  private fun JSONObject.only(vararg keys: String) { require(keys().asSequence().toSet() == keys.toSet()) }
  private fun JSONObject.string(key: String): String = get(key).let { require(it is String); it }
  private fun JSONObject.platform(): String = string("platform").also { require(it == "twitch" || it == "kick") }
  private fun JSONObject.epoch(key: String): Long = get(key).let { value ->
    require(value is Number)
    val number = value.toDouble()
    require(number.isFinite() && number >= 0 && number <= 8_640_000_000_000_000 && number == value.toLong().toDouble())
    value.toLong()
  }
  private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
}
