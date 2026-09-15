package expo.modules.streamfusionnativecontracts

internal object CaptionCatalog {
  const val MODEL_ID = "english-v1"
  const val DISPLAY_SIZE = "43.11 MiB"
  const val DOWNLOAD_BYTES = 45_202_074L
  const val LANGUAGE_LABEL = "English"
  const val LICENSE = "Apache-2.0"
  const val ONE_SESSION =
    "One caption session is already running on the focused Stream."
  const val CONSTRAINED =
    "Captions paused because this device is under resource pressure."
  const val NOT_INSTALLED =
    "Install the 43.11 MiB English model to caption this Stream locally."
  const val READY =
    "English model ready offline. 43.11 MiB. Audio stays on this device."
  const val NO_UPLOAD =
    "Decoded program PCM stays on this device. No audio upload."
  const val INTEGRITY_ERROR =
    "The English caption model failed integrity verification."
  const val FIXTURE_URI = "streamfusion-fixture://captions"

  data class FixtureFile(
    val path: String,
    val contents: String,
    val sha256: String,
  )

  val fixtureFiles = listOf(
    FixtureFile(
      "encoder-epoch-99-avg-1.int8.onnx",
      "streamfusion-caption-fixture-encoder-v1\n",
      "a9c0a2e86303d755bb500a883dac45f374c1551a372d6ba034bd5d187cd4c02b",
    ),
    FixtureFile(
      "decoder-epoch-99-avg-1.onnx",
      "streamfusion-caption-fixture-decoder-v1\n",
      "95e4e1d530b9163899fe6ff13b816cb1730262b3c988e9e08d5c47e1f442dfaf",
    ),
    FixtureFile(
      "joiner-epoch-99-avg-1.int8.onnx",
      "streamfusion-caption-fixture-joiner-v1\n",
      "024ca7b009541f629d7a775edb7abb00e926925f7aa39015a0504b705b353ae6",
    ),
    FixtureFile(
      "tokens.txt",
      "streamfusion-caption-fixture-tokens-v1\n",
      "af6238b4b68b34e715c783e1f71c46e193517d96379ba0f0f430ba5c2919183f",
    ),
  )
}
