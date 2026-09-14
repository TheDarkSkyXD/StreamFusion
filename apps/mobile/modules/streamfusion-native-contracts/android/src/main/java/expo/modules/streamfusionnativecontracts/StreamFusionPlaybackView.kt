package expo.modules.streamfusionnativecontracts

import android.content.Context
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

class StreamFusionPlaybackView(
  context: Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  private val playerView = PlayerView(context).apply {
    useController = false
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
  }
  private var sessionId: String? = null

  init {
    addView(playerView)
    FocusedPlaybackSessionOwner.register(this)
  }

  fun boundSessionId(): String? = sessionId

  fun setSessionId(next: String?) {
    sessionId = next
    FocusedPlaybackSessionOwner.bindIfMatches(this, next)
  }

  fun attachPlayer(player: ExoPlayer?) {
    playerView.player = player
  }

  fun detachPlayer() {
    playerView.player = null
  }

  override fun onDetachedFromWindow() {
    detachPlayer()
    FocusedPlaybackSessionOwner.unregister(this)
    super.onDetachedFromWindow()
  }
}
