package expo.modules.streamfusionnativecontracts

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.util.concurrent.CountDownLatch

object FocusedPlaybackSessionOwner {
  private val SESSION_ID = Regex("^[a-zA-Z0-9._:-]{1,256}$")
  private val lock = Any()
  private val main = Handler(Looper.getMainLooper())
  private val views = mutableSetOf<StreamFusionPlaybackView>()
  private var player: ExoPlayer? = null
  private var activeSessionId: String? = null
  private var emit: ((Map<String, Any>) -> Unit)? = null

  fun attachEmitter(next: (Map<String, Any>) -> Unit) {
    synchronized(lock) { emit = next }
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
    val exo = ExoPlayer.Builder(context.applicationContext).build()
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
    mapOf(
      "kind" to "completed",
      "value" to mapOf(
        "pictureInPictureEligible" to false,
        "sessionId" to sessionId,
      ),
    )
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
      current
    }
    outgoing?.release()
    mapOf(
      "kind" to "completed",
      "value" to mapOf(
        "kind" to "ended",
        "state" to mapOf(
          "pictureInPictureEligible" to false,
          "sessionId" to sessionId,
        ),
      ),
    )
  }

  fun pauseForBackground() = onMain {
    val current = synchronized(lock) { player }
    current?.playWhenReady = false
  }

  fun release() = onMain {
    val outgoing = synchronized(lock) {
      views.forEach { it.detachPlayer() }
      val current = player
      player = null
      activeSessionId = null
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
