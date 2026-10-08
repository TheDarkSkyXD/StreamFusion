package expo.modules.streamfusionnativecontracts

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class UpdaterCancellationTest {
  @Test fun delayedCancelCannotStopARetriedGeneration() {
    val application = RuntimeEnvironment.getApplication() as Context
    val files = Files.createTempDirectory("update-cancel-race-test").toFile()
    val context = TrackingContext(application, files)
    try {
      val journal = UpdateJournal(context)
      val release = UpdateRelease.parse(mapOf(
        "tag" to "android-v0.1.4", "version" to "0.1.4", "apkBytes" to 64L,
        "apkSha256" to "a".repeat(64), "notes" to "",
        "releaseUrl" to "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.4",
      ))
      val transport = CountingTransport()
      val constructor = UpdaterEngine::class.java.getDeclaredConstructor(
        Context::class.java, ReleaseTransport::class.java, UpdateVerifier::class.java, UpdateJournal::class.java,
      ).apply { isAccessible = true }
      val engine = constructor.newInstance(context, transport, UpdateVerifier(context), journal)
      val workerExit = CountDownLatch(1)
      UpdaterEngine::class.java.getDeclaredField("workerExit").apply { isAccessible = true }.set(engine, workerExit)
      journal.write(UpdateRecord(revision = 1, operation = "first", release = release,
        generation = 1, kind = "downloading"))
      val result = AtomicReference<Map<String, Any>>()
      val cancel = Thread { result.set(engine.command(mapOf("kind" to "cancel", "operation" to "first"), null)) }
      cancel.start()
      val deadline = System.currentTimeMillis() + 5_000
      while (journal.read().kind != "canceled" && System.currentTimeMillis() < deadline) Thread.sleep(10)
      assertEquals("canceled", journal.read().kind)
      journal.write(UpdateRecord(revision = 3, operation = "first", release = release,
        generation = 3, kind = "downloading"))
      workerExit.countDown()
      cancel.join(5_000)
      assertEquals(false, cancel.isAlive)
      assertEquals("canceled", (result.get()["phase"] as Map<*, *>)["kind"])
      assertEquals("downloading", journal.read().kind)
      assertEquals(0, context.stopCalls)
    } finally { files.deleteRecursively() }
  }

  @Test fun staleCancelCannotStopAnotherOperation() {
    val application = RuntimeEnvironment.getApplication() as Context
    val files = Files.createTempDirectory("update-cancel-test").toFile()
    val context = TrackingContext(application, files)
    try {
      val journal = UpdateJournal(context)
      val release = UpdateRelease.parse(mapOf(
        "tag" to "android-v0.1.4", "version" to "0.1.4", "apkBytes" to 64L,
        "apkSha256" to "a".repeat(64), "notes" to "",
        "releaseUrl" to "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.4",
      ))
      val transport = CountingTransport()
      val constructor = UpdaterEngine::class.java.getDeclaredConstructor(
        Context::class.java, ReleaseTransport::class.java, UpdateVerifier::class.java, UpdateJournal::class.java,
      ).apply { isAccessible = true }
      val engine = constructor.newInstance(context, transport, UpdateVerifier(context), journal)
      journal.write(UpdateRecord(revision = 1, operation = "first", release = release,
        generation = 1, kind = "downloading"))
      val canceled = engine.command(mapOf("kind" to "cancel", "operation" to "first"), null)
      assertEquals("canceled", (canceled["phase"] as Map<*, *>)["kind"])
      assertEquals(1, transport.cancelCalls)
      assertEquals(1, context.stopCalls)
      assertEquals(2L, journal.read().generation)

      journal.write(UpdateRecord(revision = 3, operation = "second", release = release,
        generation = 3, kind = "downloading"))
      val observed = engine.command(mapOf("kind" to "cancel", "operation" to "first"), null)
      assertEquals("downloading", (observed["phase"] as Map<*, *>)["kind"])
      assertEquals("second", journal.read().operation)
      assertEquals(3L, journal.read().generation)
      assertEquals(1, transport.cancelCalls)
      assertEquals(1, context.stopCalls)
    } finally { files.deleteRecursively() }
  }

  private class TrackingContext(base: Context, private val files: File) : ContextWrapper(base) {
    var stopCalls = 0
    override fun getFilesDir(): File = files
    override fun stopService(name: Intent): Boolean { stopCalls++; return true }
  }

  private class CountingTransport : ReleaseTransport {
    var cancelCalls = 0
    override fun manifest(release: UpdateRelease, canceled: () -> Boolean): UpdateManifest =
      error("A stale cancellation must not begin transfer")
    override fun download(release: UpdateRelease, destination: File, canceled: () -> Boolean, progress: (Long) -> Unit): Unit =
      error("A stale cancellation must not begin transfer")
    override fun cancel() { cancelCalls++ }
  }
}
