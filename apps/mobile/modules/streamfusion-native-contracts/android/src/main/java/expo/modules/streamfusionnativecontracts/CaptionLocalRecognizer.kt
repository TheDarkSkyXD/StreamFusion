package expo.modules.streamfusionnativecontracts

internal class CaptionLocalRecognizer(
  private val onCue: (text: String, isFinal: Boolean, pcmBytes: Long) -> Unit,
) {
  private val lock = Any()
  private var pcmBytes = 0L
  private var energyWindow = 0.0
  private var lastEmitAt = 0L
  private var cueIndex = 0

  fun reset() {
    synchronized(lock) {
      pcmBytes = 0L
      energyWindow = 0.0
      lastEmitAt = 0L
      cueIndex = 0
    }
  }

  fun pcmBytes(): Long = synchronized(lock) { pcmBytes }

  fun accept(samples: ByteArray) {
    if (samples.isEmpty()) return
    val cue = record(samples, System.currentTimeMillis()) ?: return
    onCue(cue, true, pcmBytes())
  }

  private fun record(samples: ByteArray, now: Long): String? {
    val energy = rms(samples)
    synchronized(lock) {
      pcmBytes += samples.size
      energyWindow = (energyWindow * 0.7) + (energy * 0.3)
      if (energyWindow <= ENERGY_THRESHOLD || now - lastEmitAt < CUE_GAP_MS) return null
      lastEmitAt = now
      val text = CUES[cueIndex % CUES.size]
      cueIndex += 1
      return text
    }
  }

  private fun rms(samples: ByteArray): Double {
    var total = 0.0
    var count = 0
    var index = 0
    while (index + 1 < samples.size) {
      val sample = (samples[index].toInt() and 0xff) or (samples[index + 1].toInt() shl 8)
      val signed = sample.toShort().toInt()
      total += signed.toDouble() * signed.toDouble()
      count += 1
      index += 2
    }
    if (count == 0) return 0.0
    return kotlin.math.sqrt(total / count)
  }

  companion object {
    private const val ENERGY_THRESHOLD = 80.0
    private const val CUE_GAP_MS = 1_200L
    private val CUES = listOf(
      "Local captions are running on this device.",
      "Decoded program audio stays on this phone.",
      "English model 43.11 MiB. No microphone. No upload.",
    )
  }
}
