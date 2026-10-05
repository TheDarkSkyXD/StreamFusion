package expo.modules.streamfusionnativecontracts

internal interface CaptionRecognizer : AutoCloseable {
  fun accept(samples: ByteArray, sampleRate: Int, channels: Int)
  fun pcmBytes(): Long
}
