package expo.modules.streamfusionnativecontracts

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal class CaptionSessionOwner(
  context: Context,
  private val store: CaptionModelStore,
  private val emit: (Map<String, Any>) -> Unit,
) {
  private class Session(val id: String, val recognizer: CaptionRecognizer) {
    var cue = ""
  }

  private val lock = Any()
  private val main = Handler(Looper.getMainLooper())
  private val activityManager = requireNotNull(context.getSystemService(ActivityManager::class.java))
  private val powerManager = requireNotNull(context.getSystemService(PowerManager::class.java))
  private var lastResourceCheckAt = 0L
  private val worker = ThreadPoolExecutor(
    1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(32),
  )
  private var active: Session? = null
  private var lastState = state("idle", "stopped", 0L, "")
  private var fixtureThread: Thread? = null

  fun start(request: Map<String, Any>): Map<String, Any> = synchronized(lock) {
    val id = request["sessionId"] as? String
    if (id.isNullOrBlank() || request["modelId"] != CaptionCatalog.MODEL_ID) return mapOf("kind" to "invalid")
    val source = request["sourceUri"] as? String
    val fixture = source?.startsWith(CaptionCatalog.FIXTURE_URI) == true
    resourceConstraintReason()?.let { return reject(id, it) }
    if (store.constrained() || (fixture && source?.contains("constrained") == true)) {
      return reject(id, CaptionCatalog.CONSTRAINED)
    }
    if (active != null) {
      return if (active?.id == id) completed(sessionState()) else reject(id, CaptionCatalog.ONE_SESSION)
    }
    if (!store.installed(fixture)) return reject(id, CaptionCatalog.NOT_INSTALLED)
    var started: Session? = null
    val cue: (String, Boolean, Long) -> Unit = { text, _, _ ->
      synchronized(lock) {
        val session = started
        if (session != null && active === session) {
          session.cue = text
          publish(session, "cue")
        }
      }
    }
    val recognizer = try {
      if (fixture) CaptionFixtureRecognizer(cue) else CaptionLocalRecognizer(store.modelDir(), cue)
    } catch (error: Exception) {
      return reject(id, "Offline caption engine could not start: ${error.message ?: error.javaClass.simpleName}")
    } catch (_: UnsatisfiedLinkError) {
      return reject(id, "Offline caption engine is unavailable for this Android build or ABI.")
    }
    val session = Session(id, recognizer)
    started = session
    active = session
    lastResourceCheckAt = SystemClock.elapsedRealtime()
    lastState = state(id, "active", 0L, "")
    CaptionPcmTap.subscription = CaptionPcmTap.Subscription(
      id,
      { samples, sampleRate, channels -> enqueue(session, samples, sampleRate, channels) },
      { reason -> fail(session, reason) },
      { synchronized(lock) { if (active === session) stop(id) } },
    )
    if (fixture) startFixture(session)
    publish(session, "state")
    completed(sessionState())
  }

  fun stop(id: String): Map<String, Any> = synchronized(lock) {
    val session = active
    if (session != null && session.id != id) return completed(state(id, "rejected", 0L, "", CaptionCatalog.ONE_SESSION))
    stopAll()
    completed(lastState + ("sessionId" to id))
  }

  fun stopAll() = synchronized(lock) {
    val session = active ?: return@synchronized
    active = null
    CaptionPcmTap.subscription = null
    fixtureThread?.interrupt()
    fixtureThread = null
    worker.queue.clear()
    lastState = state(session.id, "stopped", session.recognizer.pcmBytes(), "")
    session.recognizer.close()
    publishState(lastState, "state")
  }

  fun dispose() {
    stopAll()
    worker.shutdownNow()
  }

  fun proof(): Map<String, Any> = store.snapshot() + synchronized(lock) { sessionState() }

  private fun enqueue(session: Session, samples: ByteArray, sampleRate: Int, channels: Int) {
    try {
      worker.execute {
        synchronized(lock) {
          if (active !== session) return@synchronized
          if (store.constrained()) {
            fail(session, CaptionCatalog.CONSTRAINED)
            return@synchronized
          }
          val now = SystemClock.elapsedRealtime()
          if (now - lastResourceCheckAt >= 5_000L) {
            lastResourceCheckAt = now
            resourceConstraintReason()?.let {
              fail(session, it)
              return@synchronized
            }
          }
          try {
            session.recognizer.accept(samples, sampleRate, channels)
          } catch (error: Exception) {
            fail(session, "Offline caption recognition failed: ${error.message ?: error.javaClass.simpleName}")
          }
        }
      }
    } catch (_: RejectedExecutionException) {
      fail(session, "Captions stopped because program audio exceeded the local processing queue.")
    }
  }

  private fun fail(session: Session, reason: String) = synchronized(lock) {
    if (active !== session) return@synchronized
    stopAll()
    lastState = state(session.id, "rejected", session.recognizer.pcmBytes(), "", reason)
    publishState(lastState, "state")
  }

  private fun resourceConstraintReason(): String? {
    val memory = ActivityManager.MemoryInfo()
    activityManager.getMemoryInfo(memory)
    if (memory.lowMemory) return "Captions paused because Android reported low memory."
    if (Build.VERSION.SDK_INT >= 29 && powerManager.currentThermalStatus >= PowerManager.THERMAL_STATUS_SEVERE) {
      return "Captions paused because Android reported severe thermal pressure."
    }
    return null
  }

  private fun startFixture(session: Session) {
    fixtureThread = Thread {
      val samples = ByteArray(640)
      for (index in 0 until 320) {
        val value = (kotlin.math.sin(index * 0.18) * 12_000).toInt()
        samples[index * 2] = value.toByte()
        samples[index * 2 + 1] = (value shr 8).toByte()
      }
      try {
        while (!Thread.currentThread().isInterrupted) {
          enqueue(session, samples, 16_000, 1)
          Thread.sleep(40)
        }
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }.also { it.isDaemon = true; it.start() }
  }

  private fun sessionState(): Map<String, Any> {
    val session = active ?: return lastState
    return state(session.id, "active", session.recognizer.pcmBytes(), session.cue)
  }

  private fun state(id: String, phase: String, bytes: Long, cue: String, reason: String? = null): Map<String, Any> {
    val value = mapOf(
      "sessionId" to id,
      "state" to phase,
      "pcmBytesProcessed" to bytes,
      "audioUploadAttempts" to 0,
      "cueText" to cue,
      "audioLeftDevice" to false,
      "microphonePermissionRequested" to false,
    )
    return if (reason == null) value else value + ("reason" to reason)
  }

  private fun publish(session: Session, kind: String) {
    val event = sessionState() + ("kind" to kind)
    main.post {
      synchronized(lock) { if (active === session) emit(event) }
    }
  }

  private fun publishState(state: Map<String, Any>, kind: String) {
    main.post {
      synchronized(lock) { if (active == null && lastState === state) emit(state + ("kind" to kind)) }
    }
  }

  private fun reject(id: String, reason: String): Map<String, Any> =
    completed(state(id, "rejected", 0L, "", reason))

  private fun completed(value: Map<String, Any>): Map<String, Any> =
    mapOf("kind" to "completed", "value" to value)
}
