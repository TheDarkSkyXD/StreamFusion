package expo.modules.streamfusionnativecontracts

internal class CaptionFixtureRecognizer(
  private val onCue: (text: String, isFinal: Boolean, pcmBytes: Long) -> Unit,
) : CaptionRecognizer {
  private val lock = Any()
  private var pcmBytes = 0L
  private var energyWindow = 0.0
  private var lastEmitAt = 0L
  private var cueIndex = 0

  override fun pcmBytes(): Long = synchronized(lock) { pcmBytes }

  override fun accept(samples: ByteArray, sampleRate: Int, channels: Int) {
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

  override fun close() = Unit

  companion object {
    private const val ENERGY_THRESHOLD = 80.0
    private const val CUE_GAP_MS = 1_200L
    private val CUES = listOf(
      "Diagnostic caption fixture is running.",
      "Generated diagnostic PCM stays on this phone.",
      "Diagnostic fixture only. No speech recognition.",
    )
  }
}
