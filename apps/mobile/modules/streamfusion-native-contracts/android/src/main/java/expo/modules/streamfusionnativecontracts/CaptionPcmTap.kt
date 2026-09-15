package expo.modules.streamfusionnativecontracts

import androidx.media3.exoplayer.audio.TeeAudioProcessor
import java.nio.ByteBuffer

internal object CaptionPcmTap : TeeAudioProcessor.AudioBufferSink {
  @Volatile
  var sink: ((ByteArray, Int, Int) -> Unit)? = null

  override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) = Unit

  override fun handleBuffer(buffer: ByteBuffer) {
    val listener = sink ?: return
    val remaining = buffer.remaining()
    if (remaining <= 0) return
    val copy = ByteArray(remaining)
    val position = buffer.position()
    buffer.get(copy)
    buffer.position(position)
    listener(copy, 16_000, 1)
  }
}
