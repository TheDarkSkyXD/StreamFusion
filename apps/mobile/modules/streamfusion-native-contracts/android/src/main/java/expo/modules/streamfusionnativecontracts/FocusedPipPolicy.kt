package expo.modules.streamfusionnativecontracts

import androidx.media3.common.Player

internal object FocusedPipPolicy {
  fun canEnter(hasSession: Boolean, playWhenReady: Boolean, playbackState: Int, hasFailure: Boolean): Boolean =
    hasSession && playWhenReady && !hasFailure &&
      (playbackState == Player.STATE_BUFFERING || playbackState == Player.STATE_READY)
}
