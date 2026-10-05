package expo.modules.streamfusionnativecontracts

import androidx.media3.common.C
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicReference

internal object CaptionPcmTap {
  data class Subscription(
    val sessionId: String,
    val pcm: (ByteArray, Int, Int) -> Unit,
    val unavailable: (String) -> Unit,
    val ended: () -> Unit,
  )

  private val current = AtomicReference<Subscription?>(null)
  var subscription: Subscription?
    get() = current.get()
    set(value) { current.set(value) }

  fun endSession(sessionId: String) {
    while (true) {
      val listener = current.get()?.takeIf { it.sessionId == sessionId } ?: return
      if (current.compareAndSet(listener, null)) {
        listener.ended()
        return
      }
    }
  }

  fun forSession(sessionId: String): TeeAudioProcessor.AudioBufferSink =
    object : TeeAudioProcessor.AudioBufferSink {
      private var sampleRate = 0
      private var channels = 0
      private var encoding = C.ENCODING_INVALID

      override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
        sampleRate = sampleRateHz
        channels = channelCount
        this.encoding = encoding
      }

      override fun handleBuffer(buffer: ByteBuffer) {
        val listener = subscription?.takeIf { it.sessionId == sessionId } ?: return
        if (encoding != C.ENCODING_PCM_16BIT || sampleRate <= 0 || channels <= 0) {
          listener.unavailable("This player did not provide supported PCM16 program audio.")
          return
        }
        val remaining = buffer.remaining()
        if (remaining <= 0) return
        val copy = ByteArray(remaining)
        buffer.duplicate().get(copy)
        listener.pcm(copy, sampleRate, channels)
      }
    }
}
