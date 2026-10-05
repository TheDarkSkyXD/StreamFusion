package expo.modules.streamfusionnativecontracts

internal object CaptionCatalog {
  const val MODEL_ID = "english-v1"
  const val DISPLAY_SIZE = "39.30 MiB"
  const val DOWNLOAD_BYTES = 41_205_931L
  const val MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
  const val MODEL_ROOT = "vosk-model-small-en-us-0.15"
  const val MODEL_SHA256 = "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"
  const val LANGUAGE_LABEL = "English"
  const val LICENSE = "Apache-2.0"
  const val ONE_SESSION =
    "One caption session is already running on the focused Stream."
  const val CONSTRAINED =
    "Captions paused because this device is under resource pressure."
  const val NOT_INSTALLED =
    "Install the 39.30 MiB English model to caption this Stream locally."
  const val READY =
    "English model ready offline. 39.30 MiB download. Audio stays on this device."
  const val NO_UPLOAD =
    "Decoded program PCM stays on this device. No audio upload."
  const val INTEGRITY_ERROR =
    "The English caption model failed integrity verification."
  const val FIXTURE_URI = "streamfusion-fixture://captions"

  val productFiles = mapOf(
    "am/final.mdl" to "75370a0137f9daf8f469dedd7daa4513ae7a621f03240c6e512e2b50b656a7b6",
    "graph/disambig_tid.int" to "9ad87cc166d0998f08f758f47a6223a120dfffcbee805c4849c3aa5e6bb3c0fc",
    "graph/HCLr.fst" to "5caafba3081e1646545ac6bff0dd7a318e53dcbdc86f237909ce1d2ac1293d34",
    "graph/Gr.fst" to "023c8b7e30704a9e37765c635c252e608a02f361235bf94abdcf2a5225d85b20",
    "graph/phones/word_boundary.int" to "da199d9c991e0e84681ddbb34627b915b26302d50a8fdaa23c51e2bc3a50b5c3",
    "conf/model.conf" to "8f14cb1eeb07c762c371db648c6be688d347236155ca0f64fb13b6567a8ce81f",
    "conf/mfcc.conf" to "1e2228006d01d805ad1c267fee9f79709ca87ac51bd82b0e3f5c69ba543f0fc4",
    "ivector/splice.conf" to "9f0c5f7c82d18eaf25d8bce470efa9f7741f88411fe428774bc0a9bb69a24756",
    "ivector/final.dubm" to "8c5d7dd69d2122313baaf19f61f35dd3fa18b70c62ac0687e311e1c46e6daca7",
    "ivector/global_cmvn.stats" to "33be09afcc80059847a275c3d043b51f1ab954c7c2438ddbbf4745e8ba144ff9",
    "ivector/final.ie" to "3f37faf90c375b9e4740b569398b5829ed9cc07d19be6d441f72c3b71d7efcc6",
    "ivector/online_cmvn.conf" to "a2f3571754b64297cb7efb2e7ca3df61995c5a45fcbb97188f90613552bb2dfe",
    "ivector/final.mat" to "ddd83586dc5f928cda8738b922c85ffe38fc789cb5f9151a712ca12f37265382",
    "README" to "c0cf286e4f7783306c5f6469b37db69228fb16803b03cae661edb2d7bba64ebb",
  )

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
