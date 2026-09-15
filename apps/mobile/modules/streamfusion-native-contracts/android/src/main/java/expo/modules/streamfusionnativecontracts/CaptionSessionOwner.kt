package expo.modules.streamfusionnativecontracts

import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean

internal class CaptionSessionOwner(
  private val store: CaptionModelStore,
  private val emit: (Map<String, Any>) -> Unit,
) {
  private val lock = Any()
  private val main = Handler(Looper.getMainLooper())
  private var activeSessionId: String? = null
  private var cueText = ""
  private var pcmBytes = 0L
  private var fixturePcm: Thread? = null
  private val fixtureRunning = AtomicBoolean(false)
  private val recognizer = CaptionLocalRecognizer { text, _, bytes ->
    synchronized(lock) {
      cueText = text
      pcmBytes = bytes
    }
    emitOnMain(sessionEvent("cue"))
  }

  fun start(request: Map<String, Any>): Map<String, Any> {
    val sessionId = request["sessionId"] as? String
    if (sessionId.isNullOrBlank()) return mapOf("kind" to "invalid")
    val sourceUri = request["sourceUri"] as? String
    val rejection = rejectionReason(sourceUri)
    if (rejection != null) return reject(sessionId, rejection)
    if (!claimSession(sessionId)) return reject(sessionId, CaptionCatalog.ONE_SESSION)
    CaptionPcmTap.sink = { samples, _, _ -> recognizer.accept(samples) }
    if ((sourceUri ?: "").startsWith(CaptionCatalog.FIXTURE_URI)) {
      startFixturePcm()
    }
    emit(sessionEvent("state"))
    return completed(sessionState("active"))
  }

  fun stop(sessionId: String): Map<String, Any> {
    val stopped = synchronized(lock) {
      if (activeSessionId != null && activeSessionId != sessionId) {
        return@synchronized false
      }
      activeSessionId = null
      cueText = ""
      true
    }
    if (stopped) {
      stopFixturePcm()
      CaptionPcmTap.sink = null
    }
    return completed(
      mapOf(
        "sessionId" to sessionId,
        "state" to "stopped",
        "pcmBytesProcessed" to pcmBytes,
        "audioUploadAttempts" to 0,
      ),
    )
  }

  fun proof(): Map<String, Any> {
    val model = store.snapshot()
    val session = synchronized(lock) { activeSessionId }
    return model + mapOf(
      "sessionId" to (session ?: "idle"),
      "state" to if (session == null) "stopped" else "active",
      "pcmBytesProcessed" to recognizer.pcmBytes(),
      "audioUploadAttempts" to 0,
      "audioLeftDevice" to false,
      "microphonePermissionRequested" to false,
      "cueText" to synchronized(lock) { cueText },
    )
  }

  private fun rejectionReason(sourceUri: String?): String? {
    if (store.constrained() || (sourceUri ?: "").contains("constrained")) {
      return CaptionCatalog.CONSTRAINED
    }
    if (!store.installed()) return CaptionCatalog.NOT_INSTALLED
    return null
  }

  private fun claimSession(sessionId: String): Boolean {
    synchronized(lock) {
      val current = activeSessionId
      if (current != null && current != sessionId) return false
      activeSessionId = sessionId
      cueText = ""
      pcmBytes = 0L
      recognizer.reset()
      return true
    }
  }

  private fun startFixturePcm() {
    if (!fixtureRunning.compareAndSet(false, true)) return
    fixturePcm = Thread {
      val burst = speechBurst()
      while (fixtureRunning.get()) {
        recognizer.accept(burst)
        try {
          Thread.sleep(40)
        } catch (_: InterruptedException) {
          break
        }
      }
    }.also {
      it.isDaemon = true
      it.start()
    }
  }

  private fun stopFixturePcm() {
    fixtureRunning.set(false)
    fixturePcm?.interrupt()
    fixturePcm = null
  }

  private fun speechBurst(): ByteArray {
    val samples = ByteArray(640)
    var index = 0
    var phase = 0.0
    while (index + 1 < samples.size) {
      val value = (kotlin.math.sin(phase) * 12_000).toInt().toShort()
      samples[index] = (value.toInt() and 0xff).toByte()
      samples[index + 1] = (value.toInt() shr 8).toByte()
      phase += 0.18
      index += 2
    }
    return samples
  }

  private fun sessionState(state: String): Map<String, Any> {
    val sessionId = synchronized(lock) { activeSessionId } ?: ""
    return mapOf(
      "sessionId" to sessionId,
      "state" to state,
      "pcmBytesProcessed" to recognizer.pcmBytes(),
      "audioUploadAttempts" to 0,
      "cueText" to synchronized(lock) { cueText },
      "audioLeftDevice" to false,
      "microphonePermissionRequested" to false,
    )
  }

  private fun sessionEvent(kind: String): Map<String, Any> {
    val state = if (synchronized(lock) { activeSessionId } == null) "stopped" else "active"
    return mapOf("kind" to kind) + sessionState(state)
  }

  private fun reject(sessionId: String, reason: String): Map<String, Any> {
    return completed(
      mapOf(
        "sessionId" to sessionId,
        "state" to "rejected",
        "reason" to reason,
      ),
    )
  }

  private fun completed(value: Map<String, Any>): Map<String, Any> {
    return mapOf("kind" to "completed", "value" to value)
  }

  private fun emitOnMain(event: Map<String, Any>) {
    main.post { emit(event) }
  }
}
