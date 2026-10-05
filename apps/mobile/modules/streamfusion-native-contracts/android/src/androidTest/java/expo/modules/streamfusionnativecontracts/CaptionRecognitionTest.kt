package expo.modules.streamfusionnativecontracts

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CaptionRecognitionTest {
  @Test
  fun transcribesSpokenProgramPcmWithThePinnedEnglishModel() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val store = CaptionModelStore(File(context.filesDir, "caption-recognition-proof"))
    try {
      val installed = store.install(null)
      assertEquals(installed["statusMessage"].toString(), "ready", installed["phase"])
      assertEquals("product", installed["pack"])
      assertEquals(true, installed["sha256Verified"])
      val cues = mutableListOf<String>()
      CaptionLocalRecognizer(store.modelDir()) { text, final, _ ->
        if (final) cues.add(text)
      }.use { recognizer ->
        val wave = instrumentation.context.assets.open("vosk-test.wav").use { it.readBytes() }
        val header = ByteBuffer.wrap(wave).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(wave, 0, 4))
        assertEquals(16_000, header.getInt(24))
        assertEquals(1, header.getShort(22).toInt())
        var offset = 12
        while (String(wave, offset, 4) != "data") offset += 8 + header.getInt(offset + 4)
        val size = header.getInt(offset + 4)
        val pcm = wave.copyOfRange(offset + 8, offset + 8 + size)
        pcm.asList().chunked(4_000).forEach { recognizer.accept(it.toByteArray(), 16_000, 1) }
        recognizer.accept(ByteArray(96_000), 16_000, 1)
        assertTrue("Actual transcript: $cues", cues.joinToString(" ").contains("one zero zero zero one"))
        assertTrue(recognizer.pcmBytes() >= pcm.size)
      }
    } finally {
      store.remove()
    }
  }
}
