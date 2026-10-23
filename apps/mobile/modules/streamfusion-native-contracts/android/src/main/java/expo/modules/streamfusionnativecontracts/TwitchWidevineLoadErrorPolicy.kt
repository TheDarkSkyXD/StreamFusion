package expo.modules.streamfusionnativecontracts

import androidx.media3.common.C
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy

@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
internal class TwitchWidevineLoadErrorPolicy : DefaultLoadErrorHandlingPolicy(2) {
  override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
    val failure = generateSequence<Throwable>(loadErrorInfo.exception) { it.cause }
      .filterIsInstance<TwitchWidevineFailure>().firstOrNull()
    if (failure != null && !failure.retryable) return C.TIME_UNSET
    return super.getRetryDelayMsFor(loadErrorInfo)
  }
}
