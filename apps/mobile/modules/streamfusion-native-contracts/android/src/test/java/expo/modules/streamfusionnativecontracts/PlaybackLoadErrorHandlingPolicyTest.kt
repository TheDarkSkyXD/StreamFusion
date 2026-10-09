package expo.modules.streamfusionnativecontracts

import androidx.media3.common.C
import androidx.media3.common.ParserException
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import java.io.IOException
import javax.net.ssl.SSLHandshakeException
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class PlaybackLoadErrorHandlingPolicyTest {
  private val policy = PlaybackLoadErrorHandlingPolicy()
  private val dataSpec = DataSpec.Builder().setUri("https://example.test/live.m3u8").build()

  @Test
  fun retriesConnectionLossBeyondTheOrdinaryLimit() {
    val failure = networkFailure(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)

    assertEquals(Int.MAX_VALUE, policy.getMinimumLoadableRetryCount(C.DATA_TYPE_MANIFEST))
    assertEquals(0L, policy.getRetryDelayMsFor(info(failure, 1)))
    assertEquals(3_000L, policy.getRetryDelayMsFor(info(failure, 4)))
    assertEquals(5_000L, policy.getRetryDelayMsFor(info(failure, 9)))
  }

  @Test
  fun retriesTimeoutsWithoutOverflowAtTheLargestErrorCount() {
    val failure = networkFailure(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT)

    assertEquals(5_000L, policy.getRetryDelayMsFor(info(failure, Int.MAX_VALUE)))
  }

  @Test
  fun tlsFailuresStopAtTheOrdinaryLimit() {
    val failure = HttpDataSource.HttpDataSourceException(
      SSLHandshakeException("certificate rejected"),
      dataSpec,
      PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
      HttpDataSource.HttpDataSourceException.TYPE_OPEN,
    )

    assertEquals(2_000L, policy.getRetryDelayMsFor(info(failure, 3)))
    assertEquals(C.TIME_UNSET, policy.getRetryDelayMsFor(info(failure, 4)))
  }

  @Test
  fun httpStatusFailuresKeepTheOrdinaryLimit() {
    for (status in listOf(401, 403, 404, 500)) {
      val failure = HttpDataSource.InvalidResponseCodeException(
        status,
        "HTTP $status",
        null,
        emptyMap(),
        dataSpec,
        byteArrayOf(),
      )

      assertEquals("HTTP $status", 2_000L, policy.getRetryDelayMsFor(info(failure, 3)))
      assertEquals("HTTP $status", C.TIME_UNSET, policy.getRetryDelayMsFor(info(failure, 4)))
    }
  }

  @Test
  fun parserErrorsRemainFatalAndProgressiveLiveKeepsSixRetries() {
    val failure = ParserException.createForMalformedManifest("malformed", null)

    assertEquals(C.TIME_UNSET, policy.getRetryDelayMsFor(info(failure, 1)))
    assertEquals(Int.MAX_VALUE, policy.getMinimumLoadableRetryCount(C.DATA_TYPE_MEDIA_PROGRESSIVE_LIVE))
    assertEquals(5_000L, policy.getRetryDelayMsFor(info(IOException("source failure"), 6, C.DATA_TYPE_MEDIA_PROGRESSIVE_LIVE)))
    assertEquals(C.TIME_UNSET, policy.getRetryDelayMsFor(info(IOException("source failure"), 7, C.DATA_TYPE_MEDIA_PROGRESSIVE_LIVE)))
  }

  private fun networkFailure(reason: Int) = HttpDataSource.HttpDataSourceException(
    IOException("network unavailable"),
    dataSpec,
    reason,
    HttpDataSource.HttpDataSourceException.TYPE_OPEN,
  )

  private fun info(exception: IOException, count: Int, dataType: Int = C.DATA_TYPE_MANIFEST) =
    LoadErrorHandlingPolicy.LoadErrorInfo(
      LoadEventInfo(1L, dataSpec, 0L),
      MediaLoadData(dataType),
      exception,
      count,
    )
}
