package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Window
import android.view.WindowInsets
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

class UpdaterProofApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    val constructor = UpdaterEngine::class.java.getDeclaredConstructor(
      android.content.Context::class.java, ReleaseTransport::class.java,
      UpdateVerifier::class.java, UpdateJournal::class.java,
    ).apply { isAccessible = true }
    val engine = constructor.newInstance(
      this, ProofFileTransport(this), UpdateVerifier(this), UpdateJournal(this),
    )
    UpdaterEngine::class.java.getDeclaredField("singleton").apply {
      isAccessible = true
      set(null, engine)
    }
  }
}

private class ProofFileTransport(private val application: Application) : ReleaseTransport {
  @Volatile private var canceled = false

  override fun manifest(release: UpdateRelease, canceled: () -> Boolean): UpdateManifest {
    this.canceled = false
    if (canceled()) throw UpdateCanceledException()
    return UpdateManifest(2, 30, "StreamFusion-${release.tag}.apk")
  }

  override fun download(
    release: UpdateRelease,
    destination: File,
    canceled: () -> Boolean,
    progress: (Long) -> Unit,
  ) {
    this.canceled = false
    val source = File(application.filesDir, "candidate.apk")
    if (!source.isFile) throw java.io.IOException("Copy candidate.apk into private files first")
    val delay = application.getSharedPreferences("proof", MODE_PRIVATE).getLong("chunkDelayMs", 0)
    source.inputStream().use { input ->
      FileOutputStream(destination, false).use { output ->
        val buffer = ByteArray(64 * 1024)
        var bytes = 0L
        while (true) {
          if (this.canceled || canceled()) throw UpdateCanceledException()
          val read = input.read(buffer)
          if (read < 0) break
          output.write(buffer, 0, read)
          bytes += read
          progress(bytes)
          if (delay > 0) Thread.sleep(delay)
        }
        output.fd.sync()
        if (bytes != release.apkBytes) throw UpdateFailureException("metadata")
      }
    }
  }

  override fun cancel() { canceled = true }

  companion object { private const val MODE_PRIVATE = 0 }
}

class UpdaterProofActivity : Activity() {
  private val worker = Executors.newSingleThreadExecutor()
  private val handler = Handler(Looper.getMainLooper())
  private lateinit var status: TextView
  private lateinit var update: Button
  private lateinit var install: Button
  private lateinit var cancel: Button
  private val marker by lazy { File(filesDir, "update-keeps-data") }
  private val engine by lazy { UpdaterEngine.get(this) }
  private var busy = false
  private var currentOperation: String? = null
  private var currentKind = "idle"
  private val refresh = object : Runnable {
    override fun run() {
      if (!isFinishing && !isDestroyed) {
        worker.execute { renderSnapshot() }
        handler.postDelayed(this, 300)
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestWindowFeature(Window.FEATURE_NO_TITLE)
    window.setDecorFitsSystemWindows(false)
    if (!marker.exists()) marker.writeText("retained across APK replacement")
    intent.getLongExtra("chunkDelayMs", 0).takeIf { it > 0 }?.let {
      getSharedPreferences("proof", MODE_PRIVATE).edit().putLong("chunkDelayMs", it).apply()
    }
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(32, 32, 32, 32)
      setOnApplyWindowInsetsListener { view, insets ->
        val bars = insets.getInsets(WindowInsets.Type.systemBars())
        view.setPadding(32, bars.top + 32, 32, bars.bottom + 32)
        WindowInsets.CONSUMED
      }
    }
    status = TextView(this).apply { textSize = 18f }
    update = Button(this).apply { text = "Update"; setOnClickListener { requestUpdate() } }
    install = Button(this).apply { text = "Install / Retry"; setOnClickListener { requestInstall() } }
    cancel = Button(this).apply { text = "Cancel"; setOnClickListener { command("cancel") } }
    listOf(status, update, install, cancel).forEach {
      layout.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }
    setContentView(layout)
  }

  override fun onResume() {
    super.onResume()
    engine.onForeground(this)
    handler.post(refresh)
  }

  override fun onPause() {
    handler.removeCallbacks(refresh)
    engine.onBackground()
    super.onPause()
  }

  override fun onDestroy() {
    worker.shutdown()
    super.onDestroy()
  }

  private fun requestUpdate() {
    busy = true
    worker.execute {
      val file = File(filesDir, "candidate.apk")
      try {
        require(file.isFile) { "Copy candidate.apk into this app's private files directory" }
        val tag = "android-v0.1.6-alpha.2"
        val release = mapOf(
          "tag" to tag, "version" to "0.1.6-alpha.2", "apkBytes" to file.length(),
          "apkSha256" to sha256(file), "notes" to "Native installer proof",
          "releaseUrl" to "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/$tag",
        )
        engine.command(mapOf("kind" to "download", "release" to release), this)
        renderSnapshot()
      } catch (error: Exception) { showError(error) }
      finally { busy = false }
    }
  }

  private fun requestInstall() {
    when (currentKind) {
      "ready", "permission-needed", "awaiting-approval" -> command("install")
      "failed", "paused", "canceled" -> command("retry")
    }
  }

  private fun command(kind: String) {
    val operation = currentOperation ?: return
    busy = true
    worker.execute {
      try {
        engine.command(mapOf("kind" to kind, "operation" to operation), this)
        renderSnapshot()
      } catch (error: Exception) { showError(error) }
      finally { busy = false }
    }
  }

  private fun renderSnapshot() {
    val phase = engine.snapshot()["phase"] as Map<*, *>
    val kind = phase["kind"] as String
    val operation = phase["operation"] as? String
    val version = packageManager.getPackageInfo(packageName, 0).longVersionCode
    val markerValue = if (marker.exists()) marker.readText() else "MISSING"
    runOnUiThread {
      currentKind = kind
      currentOperation = operation
      status.text = "versionCode=$version\nphase=$kind\nbytes=${phase["bytes"] ?: "-"}\nerror=${phase["code"] ?: "-"}\nmarker=$markerValue"
      update.isEnabled = !busy && kind in setOf("idle", "installed", "failed", "canceled")
      install.isEnabled = !busy && kind in setOf("ready", "permission-needed", "awaiting-approval", "failed", "paused", "canceled")
      cancel.isEnabled = !busy && kind in setOf("downloading", "paused", "verifying", "ready", "permission-needed", "staging")
    }
  }

  private fun showError(error: Exception) = runOnUiThread {
    status.text = "Command error: ${error.message}"
  }

  companion object { private const val MODE_PRIVATE = 0 }
}
