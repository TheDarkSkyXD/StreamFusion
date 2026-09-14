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
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch

object FocusedPlaybackSessionOwner {
  private val SESSION_ID = Regex("^[a-zA-Z0-9._:-]{1,256}$")
  private val lock = Any()
  private val main = Handler(Looper.getMainLooper())
  private val views = mutableSetOf<StreamFusionPlaybackView>()
  private var player: ExoPlayer? = null
  private var activeSessionId: String? = null
  private var emit: ((Map<String, Any>) -> Unit)? = null
  private var muted = false
  private var pictureInPictureActive = false
  private var pictureInPictureRequested = false
  private var selectedQuality = "auto"
  private var volumeBeforeMute = 1f
  private var applicationContext: Context? = null
  private var hostActivity: WeakReference<Activity>? = null

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
    if (sourceUri.isNullOrBlank() || !isHttpsHls(sourceUri)) {
      return@onMain mapOf("kind" to "invalid")
    }
    val requestHeaders = requestHeaders(request)
    val httpFactory = DefaultHttpDataSource.Factory()
      .setAllowCrossProtocolRedirects(true)
      .setDefaultRequestProperties(requestHeaders)
    requestHeaders["User-Agent"]?.let(httpFactory::setUserAgent)
    val exo = ExoPlayer.Builder(context.applicationContext)
      .setMediaSourceFactory(DefaultMediaSourceFactory(httpFactory))
      .build()
    exo.addListener(SessionListener(sessionId))
    exo.setMediaItem(
      MediaItem.Builder()
        .setUri(sourceUri)
        .setMimeType(MimeTypes.APPLICATION_M3U8)
        .build(),
    )
    val previous = synchronized(lock) {
      val outgoing = player
      views.forEach { it.detachPlayer() }
      player = exo
      activeSessionId = sessionId
      applicationContext = context.applicationContext
      if (context is Activity) {
        hostActivity = WeakReference(context)
      }
      muted = false
      pictureInPictureActive = false
      pictureInPictureRequested = false
      selectedQuality = "auto"
      volumeBeforeMute = 1f
      outgoing
    }
    previous?.release()
    exo.prepare()
    exo.playWhenReady = true
    synchronized(lock) {
      if (player !== exo) {
        return@onMain mapOf("kind" to "invalid")
      }
      bindViewsLocked()
    }
    sessionCompleted(context, sessionId)
  }

  fun end(sessionId: String): Map<String, Any> = onMain {
    val outgoing = synchronized(lock) {
      if (activeSessionId != sessionId) {
        return@onMain mapOf(
          "kind" to "completed",
          "value" to mapOf("kind" to "missing", "sessionId" to sessionId),
        )
      }
      val current = player
      views.forEach { it.detachPlayer() }
      player = null
      activeSessionId = null
      applicationContext = null
      muted = false
      pictureInPictureActive = false
      pictureInPictureRequested = false
      selectedQuality = "auto"
      current
    }
    outgoing?.release()
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
    val current = requirePlayer(sessionId) ?: return@onMain missing(sessionId)
    current.playWhenReady = playing
    sessionCompleted(null, sessionId)
  }

  fun setMuted(sessionId: String, nextMuted: Boolean): Map<String, Any> = onMain {
    val current = requirePlayer(sessionId) ?: return@onMain missing(sessionId)
    if (nextMuted && !muted) {
      volumeBeforeMute = current.volume
    }
    muted = nextMuted
    current.volume = if (nextMuted) 0f else volumeBeforeMute
    sessionCompleted(null, sessionId)
  }

  fun setVolume(sessionId: String, volume: Float): Map<String, Any> = onMain {
    val current = requirePlayer(sessionId) ?: return@onMain missing(sessionId)
    val clamped = volume.coerceIn(0f, 1f)
    volumeBeforeMute = clamped
    if (!muted) {
      current.volume = clamped
    }
    sessionCompleted(null, sessionId)
  }

  fun listQualities(sessionId: String): Map<String, Any> = onMain {
    val current = requirePlayer(sessionId) ?: return@onMain missing(sessionId)
    qualityCompleted(sessionId, current)
  }

  fun setQuality(sessionId: String, quality: String): Map<String, Any> = onMain {
    val current = requirePlayer(sessionId) ?: return@onMain missing(sessionId)
    if (quality == "auto") {
      current.trackSelectionParameters = current.trackSelectionParameters
        .buildUpon()
        .clearVideoSizeConstraints()
        .build()
      selectedQuality = "auto"
      return@onMain qualityCompleted(sessionId, current)
    }
    val height = quality.removeSuffix("p").toIntOrNull()
      ?: return@onMain mapOf("kind" to "invalid")
    current.trackSelectionParameters = current.trackSelectionParameters
      .buildUpon()
      .setMaxVideoSize(Int.MAX_VALUE, height)
      .build()
    selectedQuality = quality
    qualityCompleted(sessionId, current)
  }

  fun enterPictureInPicture(activity: Activity?, sessionId: String): Map<String, Any> = onMain {
    requirePlayer(sessionId) ?: return@onMain missing(sessionId)
    val host = resolveHost(activity)
    if (host == null) {
      return@onMain unsupported("Picture in Picture needs the current Activity.")
    }
    if (!pipEligible(host)) {
      return@onMain unsupported("Picture in Picture is not available on this device.")
    }
    pictureInPictureRequested = true
    val entered = try {
      host.enterPictureInPictureMode(
        PictureInPictureParams.Builder()
          .setAspectRatio(Rational(16, 9))
          .build(),
      )
    } catch (_: IllegalStateException) {
      pictureInPictureRequested = false
      return@onMain unsupported("Picture in Picture could not start from this screen.")
    }
    if (!entered) {
      pictureInPictureRequested = false
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
    val current = synchronized(lock) { player }
    current?.playWhenReady = false
  }

  fun onForeground(activity: Activity?) = onMain {
    val inPip = activity?.isInPictureInPictureMode == true
    if (inPip) {
      synchronized(lock) {
        pictureInPictureActive = true
      }
      return@onMain
    }
    val sessionId = synchronized(lock) {
      val wasActive = pictureInPictureActive || pictureInPictureRequested
      pictureInPictureRequested = false
      pictureInPictureActive = false
      if (wasActive) activeSessionId else null
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
      val current = player
      player = null
      activeSessionId = null
      applicationContext = null
      muted = false
      pictureInPictureActive = false
      pictureInPictureRequested = false
      selectedQuality = "auto"
      current
    }
    outgoing?.release()
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
      if (sessionId != null && sessionId == activeSessionId) {
        view.attachPlayer(player)
      } else {
        view.detachPlayer()
      }
    }
  }

  private fun bindViewsLocked() {
    val current = player
    val sessionId = activeSessionId
    views.forEach { view ->
      if (sessionId != null && view.boundSessionId() == sessionId) {
        view.attachPlayer(current)
      } else {
        view.detachPlayer()
      }
    }
  }

  private fun requirePlayer(sessionId: String): ExoPlayer? = synchronized(lock) {
    if (activeSessionId != sessionId) null else player
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

  private fun qualityCompleted(sessionId: String, current: ExoPlayer) = mapOf(
    "kind" to "completed",
    "value" to mapOf(
      "qualities" to videoQualities(current),
      "selected" to selectedQuality,
      "sessionId" to sessionId,
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

  private fun isHttpsHls(sourceUri: String): Boolean {
    val uri = Uri.parse(sourceUri)
    val path = uri.path.orEmpty().lowercase()
    return uri.scheme == "https" && path.contains(".m3u8")
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

  private class SessionListener(
    private val sessionId: String,
  ) : Player.Listener {
    override fun onTracksChanged(tracks: Tracks) {
      val current = synchronized(lock) { activeSessionId }
      if (current != sessionId) return
      if (synchronized(lock) { player?.playWhenReady == true }) {
        publish(mapOf("kind" to "playing", "sessionId" to sessionId))
      }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      val current = synchronized(lock) { activeSessionId }
      if (current != sessionId) return
      when (playbackState) {
        Player.STATE_BUFFERING -> publish(mapOf("kind" to "buffering", "sessionId" to sessionId))
        Player.STATE_READY -> {
          val playing = synchronized(lock) { player?.playWhenReady == true }
          if (playing) {
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
      val current = synchronized(lock) { activeSessionId }
      if (current != sessionId) return
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
      val current = synchronized(lock) { activeSessionId }
      if (current != sessionId) return
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
