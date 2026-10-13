package expo.modules.streamfusionnativecontracts

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal class PublicLiveAlertReader(
  private val client: OkHttpClient = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS).build(),
  private val twitchEndpoint: String = "https://gql.twitch.tv/gql",
  private val kickRoot: String = "https://kick.com/",
  private val clock: () -> Long = System::currentTimeMillis,
  private val deadlineMillis: Long = TimeUnit.MINUTES.toMillis(8),
) : AlertReader {
  override fun read(channels: List<AlertChannel>, stopped: () -> Boolean): List<AlertObservation> {
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(deadlineMillis)
    val observations = mutableListOf<AlertObservation>()
    var index = 0
    while (index < channels.size && !stopped() && System.nanoTime() < deadline) {
      val batch = if (channels[index].platform == "twitch") channels.drop(index).takeWhile { it.platform == "twitch" }.take(50) else listOf(channels[index])
      val values = if (batch.first().platform == "twitch") twitch(batch) else listOf(kick(batch.single()))
      if (stopped()) break
      val time = clock()
      observations.addAll(batch.zip(values).map { (channel, read) -> AlertObservation(channel.key, time, read) })
      index += batch.size
    }
    return observations
  }

  override fun cancel() { client.dispatcher.cancelAll() }

  private fun twitch(channels: List<AlertChannel>): List<AlertRead> {
    val variables = JSONObject()
    val lookups = channels.mapIndexed { index, channel ->
      val canonical = numericTwitchId.matches(channel.channelId)
      val argument = if (canonical) "id" else "login"
      val variable = "$argument$index"
      variables.put(variable, if (canonical) channel.channelId else channel.channelLogin)
      "\$$variable: ${if (canonical) "ID!" else "String!"}" to "channel$index: user($argument: \$$variable) { id login stream { id title } }"
    }
    val declarations = lookups.joinToString(",") { it.first }
    val fields = lookups.joinToString(" ") { it.second }
    val request = Request.Builder().url(twitchEndpoint).header("Client-Id", "kd1unb4b3q4t58fwlpcbzcbnm76a8fp")
      .post(JSONObject().put("query", "query LiveAlerts($declarations) { $fields }").put("variables", variables).toString().toRequestBody("application/json".toMediaType())).build()
    val payload = request(request) ?: return channels.map { AlertRead.Unavailable }
    val errors = payload.optJSONArray("errors")
    if (errors != null && errors.length() > 0) return channels.map { AlertRead.Unavailable }
    val data = payload.optJSONObject("data") ?: return channels.map { AlertRead.Unavailable }
    return channels.mapIndexed { index, channel -> parseTwitch(data.optJSONObject("channel$index"), channel) }
  }

  private fun kick(channel: AlertChannel): AlertRead {
    val url = kickRoot.toHttpUrl().newBuilder().addPathSegments("api/v1/channels").addPathSegment(channel.channelLogin).build()
    val request = Request.Builder().url(url).header("Accept", "application/json").build()
    return request(request)?.let { parseKick(it, channel) } ?: AlertRead.Unavailable
  }

  private fun request(request: Request): JSONObject? = try {
    client.newCall(request).execute().use { response ->
      if (!response.isSuccessful) return null
      val body = response.body ?: return null
      if (body.contentLength() > 2 * 1024 * 1024) return null
      val source = body.source()
      source.request(2 * 1024 * 1024L + 1)
      if (source.buffer.size > 2 * 1024 * 1024L) return null
      JSONObject(source.readUtf8())
    }
  } catch (_: Exception) { null }

  companion object {
    private val numericTwitchId = Regex("[0-9]+")
    private val channelLogin = Regex("[a-zA-Z0-9_-]{1,64}")
    private fun id(value: Any?): String? = when (value) {
      is String -> value.takeIf { Regex("[a-zA-Z0-9._:-]{1,256}").matches(it) }
      is Number -> value.toLong().takeIf { it > 0 && it.toDouble() == value.toDouble() }?.toString()
      else -> null
    }
    internal fun parseTwitch(user: JSONObject?, channel: AlertChannel): AlertRead {
      if (user == null || !user.has("stream")) return AlertRead.Unavailable
      val userId = id(user.opt("id")) ?: return AlertRead.Unavailable
      val login = user.opt("login") as? String ?: return AlertRead.Unavailable
      if (!channelLogin.matches(login)) return AlertRead.Unavailable
      if (numericTwitchId.matches(channel.channelId)) {
        if (userId != channel.channelId) return AlertRead.Unavailable
      } else if (!login.equals(channel.channelLogin, true)) return AlertRead.Unavailable
      if (user.isNull("stream")) return AlertRead.Offline
      val stream = user.optJSONObject("stream") ?: return AlertRead.Unavailable
      val streamId = id(stream.opt("id")) ?: return AlertRead.Unavailable
      val title = stream.opt("title") as? String ?: return AlertRead.Unavailable
      return AlertRead.Live(streamId, safeAlertText(title, "Tap to watch now."), login.takeUnless { it.equals(channel.channelLogin, true) })
    }
    internal fun parseKick(root: JSONObject, channel: AlertChannel): AlertRead {
      if (id(root.opt("id")) == null || !root.optString("slug").equals(channel.channelLogin, true)) return AlertRead.Unavailable
      val liveFlag = root.opt("is_live")
      if (root.has("is_live") && liveFlag != true && liveFlag != false) return AlertRead.Unavailable
      if (liveFlag == false) return AlertRead.Offline
      if (!root.has("livestream")) return AlertRead.Unavailable
      if (root.isNull("livestream")) return if (liveFlag == true) AlertRead.Unavailable else AlertRead.Offline
      val live = root.optJSONObject("livestream") ?: return AlertRead.Unavailable
      if (live.opt("is_live") == false) return AlertRead.Offline
      if (live.has("is_live") && live.opt("is_live") != true) return AlertRead.Unavailable
      val streamId = id(live.opt("id")) ?: return AlertRead.Unavailable
      val title = (live.opt("session_title") as? String) ?: (live.opt("title") as? String) ?: "Tap to watch now."
      return AlertRead.Live(streamId, safeAlertText(title, "Tap to watch now."))
    }
  }
}
