package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Rational
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch

object FocusedPlaybackSessionOwner {
  private val SESSION_ID = Regex("^[a-zA-Z0-9._:-]{1,256}$")
  private val lock = Any()
  private val main = Handler(Looper.getMainLooper())
  private val views = mutableSetOf<StreamFusionPlaybackView>()
  private val sessions = LinkedHashMap<String, Session>()
  private var emit: ((Map<String, Any>) -> Unit)? = null
  private var pictureInPictureActive = false
  private var pictureInPictureRequested = false
  private var pictureInPictureSessionId: String? = null
  private var applicationContext: Context? = null
  private var hostActivity: WeakReference<Activity>? = null
  private val progressTicker = object : Runnable {
    override fun run() {
      val snapshot = synchronized(lock) { sessions.values.map { it.sessionId to it.player } }
      if (snapshot.isEmpty()) return
      snapshot.forEach { (sessionId, exo) -> publish(progressEvent(sessionId, exo)) }
      main.postDelayed(this, 500)
    }
  }

  fun attachEmitter(next: (Map<String, Any>) -> Unit) {
    synchronized(lock) { emit = next }
  }

  fun rememberActivity(activity: Activity?) {
    if (activity == null) return
    synchronized(lock) { hostActivity = WeakReference(activity) }
  }

  fun start(context: Context, request: Map<String, Any>): Map<String, Any> = onMain {
    val sessionId = request["sessionId"] as? String
    val sourceUri = request["sourceUri"] as? String
    if (sessionId.isNullOrBlank() || !SESSION_ID.matches(sessionId)) {
      return@onMain mapOf("kind" to "invalid")
    }
    if (sourceUri.isNullOrBlank() || !isHttpsMedia(sourceUri)) {
      return@onMain mapOf("kind" to "invalid")
    }
    val requestHeaders = requestHeaders(request)
    val httpFactory = DefaultHttpDataSource.Factory()
      .setAllowCrossProtocolRedirects(true)
      .setDefaultRequestProperties(requestHeaders)
    requestHeaders["User-Agent"]?.let(httpFactory::setUserAgent)
    val filterMode = playlistFilterMode(request)
    val dataSourceFactory =
      if (filterMode == "passthrough") {
        httpFactory
      } else {
        FilteringDataSource.Factory(httpFactory, filterMode) { diagnostic ->
          publish(
            mapOf(
              "kind" to "filtering",
              "sessionId" to sessionId,
              "diagnostic" to diagnostic,
            ),
          )
        }
      }
    val exo = ExoPlayer.Builder(context.applicationContext)
      .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
      .setRenderersFactory(captionRenderers(context.applicationContext))
      .build()
    exo.addListener(SessionListener(sessionId))
    exo.setMediaItem(
      MediaItem.Builder()
        .setUri(sourceUri)
        .setMimeType(mimeType(sourceUri))
        .build(),
    )
    val previous = synchronized(lock) {
      applicationContext = context.applicationContext
      if (context is Activity) {
        hostActivity = WeakReference(context)
      }
      val outgoing = sessions.remove(sessionId)?.player
      sessions[sessionId] = Session(sessionId, exo)
      bindViewsLocked()
      outgoing
    }
    previous?.release()
    exo.prepare()
    exo.playWhenReady = true
    startProgressTicker()
    sessionCompleted(context, sessionId)
  }

  fun end(sessionId: String): Map<String, Any> = onMain {
    val outgoing = synchronized(lock) {
      val current = sessions.remove(sessionId) ?: return@onMain missing(sessionId)
      if (pictureInPictureSessionId == sessionId) {
        pictureInPictureActive = false
        pictureInPictureRequested = false
        pictureInPictureSessionId = null
      }
      bindViewsLocked()
      current.player
    }
    outgoing.release()
    if (synchronized(lock) { sessions.isEmpty() }) stopProgressTicker()
    mapOf(
      "kind" to "completed",
      "value" to mapOf(
        "kind" to "ended",
        "state" to mapOf(
          "pictureInPictureEligible" to pipEligible(null),
          "sessionId" to sessionId,
        ),
      ),
    )
  }

  fun setPlaying(sessionId: String, playing: Boolean): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    current.player.playWhenReady = playing
    sessionCompleted(null, sessionId)
  }

  fun setMuted(sessionId: String, nextMuted: Boolean): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    if (nextMuted && !current.muted) {
      current.volumeBeforeMute = current.player.volume
    }
    current.muted = nextMuted
    current.player.volume = if (nextMuted) 0f else current.volumeBeforeMute
    sessionCompleted(null, sessionId)
  }

  fun setVolume(sessionId: String, volume: Float): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    val clamped = volume.coerceIn(0f, 1f)
    current.volumeBeforeMute = clamped
    if (!current.muted) {
      current.player.volume = clamped
    }
    sessionCompleted(null, sessionId)
  }

  fun listQualities(sessionId: String): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    qualityCompleted(current)
  }

  fun setQuality(sessionId: String, quality: String): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    if (quality == "auto") {
      current.player.trackSelectionParameters = current.player.trackSelectionParameters
        .buildUpon()
        .clearVideoSizeConstraints()
        .build()
      current.selectedQuality = "auto"
      return@onMain qualityCompleted(current)
    }
    val height = quality.removeSuffix("p").toIntOrNull()
      ?: return@onMain mapOf("kind" to "invalid")
    current.player.trackSelectionParameters = current.player.trackSelectionParameters
      .buildUpon()
      .setMaxVideoSize(Int.MAX_VALUE, height)
      .build()
    current.selectedQuality = quality
    qualityCompleted(current)
  }

  fun seekTo(sessionId: String, positionMs: Double): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    val duration = current.player.duration
    if (
      !current.player.isCurrentMediaItemSeekable ||
      duration <= 0L ||
      duration == C.TIME_UNSET
    ) {
      return@onMain unsupported("Seeking is not available for this live session.")
    }
    current.player.seekTo(positionMs.toLong().coerceIn(0L, duration))
    publish(progressEvent(sessionId, current.player))
    sessionCompleted(null, sessionId)
  }

  fun enterPictureInPicture(activity: Activity?, sessionId: String): Map<String, Any> = onMain {
    requireSession(sessionId) ?: return@onMain missing(sessionId)
    val host = resolveHost(activity)
    if (host == null) {
      return@onMain unsupported("Picture in Picture needs the current Activity.")
    }
    if (!pipEligible(host)) {
      return@onMain unsupported("Picture in Picture is not available on this device.")
    }
    pictureInPictureRequested = true
    pictureInPictureSessionId = sessionId
    val entered = try {
      host.enterPictureInPictureMode(
        PictureInPictureParams.Builder()
          .setAspectRatio(Rational(16, 9))
          .build(),
      )
    } catch (_: IllegalStateException) {
      pictureInPictureRequested = false
      pictureInPictureSessionId = null
      return@onMain unsupported("Picture in Picture could not start from this screen.")
    }
    if (!entered) {
      pictureInPictureRequested = false
      pictureInPictureSessionId = null
      return@onMain unsupported("The system refused Picture in Picture.")
    }
    pictureInPictureActive = true
    sessionCompleted(host, sessionId)
  }

  fun pauseForBackground() = onMain {
    val skip = synchronized(lock) {
      pictureInPictureRequested || pictureInPictureActive
    }
    if (skip) return@onMain
    val players = synchronized(lock) { sessions.values.map { it.player } }
    players.forEach { it.playWhenReady = false }
  }

  fun onForeground(activity: Activity?) = onMain {
    val inPip = activity?.isInPictureInPictureMode == true
    if (inPip) {
      synchronized(lock) { pictureInPictureActive = true }
      return@onMain
    }
    val sessionId = synchronized(lock) {
      val wasActive = pictureInPictureActive || pictureInPictureRequested
      pictureInPictureRequested = false
      pictureInPictureActive = false
      val id = if (wasActive) pictureInPictureSessionId else null
      pictureInPictureSessionId = null
      id
    }
    if (sessionId != null) {
      publish(
        mapOf(
          "kind" to "picture-in-picture-exited",
          "sessionId" to sessionId,
        ),
      )
    }
  }

  fun release() = onMain {
    val outgoing = synchronized(lock) {
      views.forEach { it.detachPlayer() }
      val players = sessions.values.map { it.player }
      sessions.clear()
      applicationContext = null
      pictureInPictureActive = false
      pictureInPictureRequested = false
      pictureInPictureSessionId = null
      players
    }
    outgoing.forEach { it.release() }
    stopProgressTicker()
  }

  fun register(view: StreamFusionPlaybackView) = onMain {
    synchronized(lock) {
      views.add(view)
      bindViewsLocked()
    }
  }

  fun unregister(view: StreamFusionPlaybackView) = onMain {
    synchronized(lock) {
      views.remove(view)
      view.detachPlayer()
    }
  }

  fun bindIfMatches(view: StreamFusionPlaybackView, sessionId: String?) = onMain {
    synchronized(lock) {
      val player = sessionId?.let { sessions[it]?.player }
      if (player != null) view.attachPlayer(player) else view.detachPlayer()
    }
  }

  private fun bindViewsLocked() {
    views.forEach { view ->
      val player = view.boundSessionId()?.let { sessions[it]?.player }
      if (player != null) view.attachPlayer(player) else view.detachPlayer()
    }
  }

  private fun requireSession(sessionId: String): Session? = synchronized(lock) {
    sessions[sessionId]
  }

  private fun missing(sessionId: String) = mapOf(
    "kind" to "completed",
    "value" to mapOf("kind" to "missing", "sessionId" to sessionId),
  )

  private fun unsupported(diagnostic: String) = mapOf(
    "code" to "NATIVE_OPERATION_UNSUPPORTED",
    "diagnostic" to diagnostic,
    "kind" to "unsupported",
  )

  private fun resolveHost(activity: Activity?): Activity? {
    val candidates = listOf(activity, synchronized(lock) { hostActivity?.get() })
    return candidates.firstOrNull { host ->
      host != null && !host.isFinishing && !host.isDestroyed
    }
  }

  private fun pipEligible(context: Context?): Boolean {
    val resolved = context ?: return false
    return resolved.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
  }

  private fun sessionCompleted(context: Context?, sessionId: String) = mapOf(
    "kind" to "completed",
    "value" to mapOf(
      "pictureInPictureEligible" to pipEligible(context ?: applicationContext),
      "sessionId" to sessionId,
    ),
  )

  private fun qualityCompleted(current: Session) = mapOf(
    "kind" to "completed",
    "value" to mapOf(
      "qualities" to videoQualities(current.player),
      "selected" to current.selectedQuality,
      "sessionId" to current.sessionId,
    ),
  )

  private fun videoQualities(current: ExoPlayer): List<String> {
    val heights = linkedSetOf<Int>()
    for (group in current.currentTracks.groups) {
      if (group.type != C.TRACK_TYPE_VIDEO) continue
      for (index in 0 until group.length) {
        val height = group.getTrackFormat(index).height
        if (height > 0) heights.add(height)
      }
    }
    return listOf("auto") + heights.sortedDescending().map { "${it}p" }
  }

  private fun requestHeaders(request: Map<String, Any>): Map<String, String> {
    val raw = request["requestHeaders"] as? Map<*, *> ?: return emptyMap()
    val headers = linkedMapOf<String, String>()
    for ((key, value) in raw) {
      if (key is String && key.isNotBlank() && value is String && value.isNotBlank()) {
        headers[key] = value
      }
    }
    return headers
  }

  private fun playlistFilterMode(request: Map<String, Any>): String {
    val filtering = request["filtering"] as? Map<*, *> ?: return "passthrough"
    val enabled = filtering["enabled"] == true
    val platform = filtering["platform"] as? String
    val mode = filtering["mode"] as? String ?: "passthrough"
    if (!enabled || platform != "twitch") return "passthrough"
    return if (mode == "canary" || mode == "strip") mode else "passthrough"
  }

  private fun isHttpsMedia(sourceUri: String): Boolean {
    val uri = Uri.parse(sourceUri)
    val path = uri.path.orEmpty().lowercase()
    return uri.scheme == "https" && (path.contains(".m3u8") || path.endsWith(".mp4"))
  }

  private fun mimeType(sourceUri: String): String {
    return if (sourceUri.lowercase().contains(".m3u8")) {
      MimeTypes.APPLICATION_M3U8
    } else {
      MimeTypes.APPLICATION_MP4
    }
  }

  private fun captionRenderers(context: Context): DefaultRenderersFactory {
    return object : DefaultRenderersFactory(context) {
      override fun buildAudioSink(
        context: Context,
        enableFloatOutput: Boolean,
        enableAudioTrackPlaybackParams: Boolean,
      ): AudioSink {
        return DefaultAudioSink.Builder(context)
          .setEnableFloatOutput(enableFloatOutput)
          .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
          .setAudioProcessors(arrayOf(TeeAudioProcessor(CaptionPcmTap)))
          .build()
      }
    }
  }

  private fun startProgressTicker() {
    main.removeCallbacks(progressTicker)
    main.post(progressTicker)
  }

  private fun stopProgressTicker() {
    main.removeCallbacks(progressTicker)
  }

  private fun progressEvent(sessionId: String, exo: ExoPlayer): Map<String, Any> {
    val duration = exo.duration
    val seekable =
      exo.isCurrentMediaItemSeekable && duration > 0L && duration != C.TIME_UNSET
    return mapOf(
      "kind" to "progress",
      "sessionId" to sessionId,
      "positionMs" to exo.currentPosition.toDouble(),
      "durationMs" to if (duration == C.TIME_UNSET) 0.0 else duration.toDouble(),
      "seekable" to seekable,
    )
  }

  private fun publish(event: Map<String, Any>) {
    main.post { emit?.invoke(event) }
  }

  private fun <T> onMain(block: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return block()
    }
    val done = CountDownLatch(1)
    var result: T? = null
    var error: Throwable? = null
    main.post {
      try {
        result = block()
      } catch (failure: Throwable) {
        error = failure
      } finally {
        done.countDown()
      }
    }
    done.await()
    error?.let { throw it }
    @Suppress("UNCHECKED_CAST")
    return result as T
  }

  private class Session(
    val sessionId: String,
    val player: ExoPlayer,
    var muted: Boolean = false,
    var selectedQuality: String = "auto",
    var volumeBeforeMute: Float = 1f,
  )

  private class SessionListener(
    private val sessionId: String,
  ) : Player.Listener {
    override fun onTracksChanged(tracks: Tracks) {
      val session = synchronized(lock) { sessions[sessionId] } ?: return
      if (session.player.playWhenReady) {
        publish(mapOf("kind" to "playing", "sessionId" to sessionId))
      }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      val session = synchronized(lock) { sessions[sessionId] } ?: return
      when (playbackState) {
        Player.STATE_BUFFERING -> publish(mapOf("kind" to "buffering", "sessionId" to sessionId))
        Player.STATE_READY -> {
          if (session.player.playWhenReady) {
            publish(mapOf("kind" to "playing", "sessionId" to sessionId))
          } else {
            publish(
              mapOf(
                "kind" to "paused",
                "sessionId" to sessionId,
                "reason" to "user",
              ),
            )
          }
        }
        Player.STATE_ENDED -> publish(mapOf("kind" to "ended", "sessionId" to sessionId))
      }
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      synchronized(lock) { sessions[sessionId] } ?: return
      if (playWhenReady) {
        publish(mapOf("kind" to "playing", "sessionId" to sessionId))
        return
      }
      val pausedReason =
        if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS) {
          "background"
        } else {
          "user"
        }
      publish(
        mapOf(
          "kind" to "paused",
          "sessionId" to sessionId,
          "reason" to pausedReason,
        ),
      )
    }

    override fun onPlayerError(error: PlaybackException) {
      synchronized(lock) { sessions[sessionId] } ?: return
      publish(
        mapOf(
          "kind" to "failed",
          "sessionId" to sessionId,
          "code" to failureCode(error),
          "detail" to "Focused playback stopped.",
        ),
      )
    }
  }

  private fun failureCode(error: PlaybackException): String {
    val message = error.errorCodeName.lowercase()
    return when {
      message.contains("decoder") -> "PLAYBACK_DECODER_UNSUPPORTED"
      message.contains("http") || message.contains("network") || message.contains("timeout") ->
        "PLAYBACK_NETWORK_FAILED"
      message.contains("parsing") || message.contains("format") || message.contains("manifest") ->
        "PLAYBACK_SOURCE_REJECTED"
      else -> "PLAYBACK_UNKNOWN"
    }
  }
}
