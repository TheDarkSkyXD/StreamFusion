package expo.modules.streamfusionnativecontracts

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class CaptionPcmConverterTest {
  private fun pcm(vararg values: Int): ByteArray = values.flatMap {
    listOf(it.toByte(), (it shr 8).toByte())
  }.toByteArray()

  @Test
  fun downmixesStereoAndResamplesActualFortyEightKhz() {
    val input = pcm(1000, 3000, 2000, 4000, 3000, 5000, 4000, 6000, 5000, 7000, 6000, 8000)
    assertArrayEquals(pcm(2000, 5000), CaptionPcmConverter().convert(input, 48_000, 2))
  }

  @Test
  fun conversionSurvivesBuffersEndingInsideStereoFrames() {
    val input = pcm(-1000, 1000, 2000, 4000, 5000, 7000, 8000, 10000)
    val converter = CaptionPcmConverter()
    val output = converter.convert(input.copyOfRange(0, 5), 16_000, 2) +
      converter.convert(input.copyOfRange(5, input.size), 16_000, 2)
    assertArrayEquals(pcm(0, 3000, 6000, 9000), output)
  }

  @Test
  fun linearlyInterpolatesEightKhzInputAcrossChunks() {
    val converter = CaptionPcmConverter()
    val output = converter.convert(pcm(0, 2000), 8_000, 1) + converter.convert(pcm(4000), 8_000, 1)
    assertArrayEquals(pcm(0, 1000, 2000, 3000, 4000), output)
    assertEquals(10, output.size)
  }
}
