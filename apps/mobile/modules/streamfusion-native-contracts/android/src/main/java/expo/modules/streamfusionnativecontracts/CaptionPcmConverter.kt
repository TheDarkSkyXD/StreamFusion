package expo.modules.streamfusionnativecontracts

import java.io.ByteArrayOutputStream

internal class CaptionPcmConverter {
  private var sampleRate = 0
  private var channels = 0
  private var frameIndex = 0L
  private var nextOutputAt = 0.0
  private var previous = 0.0
  private var tail = ByteArray(0)

  fun convert(bytes: ByteArray, rate: Int, channelCount: Int): ByteArray {
    require(rate in 8_000..192_000 && channelCount in 1..8) { "Unsupported program PCM format." }
    if (sampleRate != rate || channels != channelCount) {
      sampleRate = rate
      channels = channelCount
      frameIndex = 0L
      nextOutputAt = 0.0
      previous = 0.0
      tail = ByteArray(0)
    }
    val input = tail + bytes
    val frameBytes = channelCount * 2
    val completeBytes = input.size - input.size % frameBytes
    tail = input.copyOfRange(completeBytes, input.size)
    val output = ByteArrayOutputStream()
    var offset = 0
    while (offset < completeBytes) {
      var sum = 0.0
      repeat(channelCount) { channel ->
        val position = offset + channel * 2
        val value = ((input[position].toInt() and 0xff) or (input[position + 1].toInt() shl 8)).toShort()
        sum += value.toDouble()
      }
      val mono = sum / channelCount
      while (nextOutputAt <= frameIndex) {
        val fraction = if (frameIndex == 0L) 1.0 else nextOutputAt - (frameIndex - 1)
        val value = (previous + (mono - previous) * fraction).toInt().coerceIn(-32768, 32767)
        output.write(value and 0xff)
        output.write((value shr 8) and 0xff)
        nextOutputAt += sampleRate / 16_000.0
      }
      previous = mono
      frameIndex += 1
      offset += frameBytes
    }
    return output.toByteArray()
  }
}
