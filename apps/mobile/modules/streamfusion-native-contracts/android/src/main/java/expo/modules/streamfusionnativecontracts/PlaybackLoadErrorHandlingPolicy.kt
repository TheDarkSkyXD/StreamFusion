package expo.modules.streamfusionnativecontracts

import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import javax.net.ssl.SSLException

internal class PlaybackLoadErrorHandlingPolicy : DefaultLoadErrorHandlingPolicy() {
  override fun getMinimumLoadableRetryCount(dataType: Int) = Int.MAX_VALUE

  override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
    val stockDelay = super.getRetryDelayMsFor(loadErrorInfo)
    if (stockDelay == C.TIME_UNSET) return C.TIME_UNSET

    val failure = loadErrorInfo.exception
    if (
      failure is HttpDataSource.HttpDataSourceException &&
      (failure.reason == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
        failure.reason == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT) &&
      generateSequence<Throwable>(failure) { it.cause }.none { it is SSLException }
    ) {
      return ((loadErrorInfo.errorCount.toLong() - 1L) * 1_000L).coerceIn(0L, 5_000L)
    }

    val ordinaryLimit = super.getMinimumLoadableRetryCount(loadErrorInfo.mediaLoadData.dataType)
    return if (loadErrorInfo.errorCount > ordinaryLimit) C.TIME_UNSET else stockDelay
  }
}
