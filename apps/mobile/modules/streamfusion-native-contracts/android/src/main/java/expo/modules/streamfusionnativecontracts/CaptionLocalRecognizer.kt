package expo.modules.streamfusionnativecontracts

import java.io.File
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer

internal class CaptionLocalRecognizer(
  modelDirectory: File,
  private val onCue: (String, Boolean, Long) -> Unit,
) : CaptionRecognizer {
  private val model = Model(modelDirectory.absolutePath)
  private val recognizer = try {
    Recognizer(model, 16_000f)
  } catch (error: Exception) {
    model.close()
    throw error
  }
  private val converter = CaptionPcmConverter()
  private var processed = 0L
  private var lastText = ""

  override fun pcmBytes(): Long = processed

  override fun accept(samples: ByteArray, sampleRate: Int, channels: Int) {
    val mono = converter.convert(samples, sampleRate, channels)
    if (mono.isEmpty()) return
    processed += samples.size
    val final = recognizer.acceptWaveForm(mono, mono.size)
    val response = JSONObject(if (final) recognizer.result else recognizer.partialResult)
    val text = response.optString(if (final) "text" else "partial").trim()
    if (text.isNotEmpty() && (text != lastText || final)) {
      lastText = text
      onCue(text, final, processed)
    }
  }

  override fun close() {
    recognizer.close()
    model.close()
  }
}
