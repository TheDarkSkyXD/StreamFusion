package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import java.io.File
import java.lang.ref.WeakReference
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class UpdaterHandoffTest {
  @Test fun lifecycleCallbacksDoNotWaitForUpdaterWorkLock() = withEngine { engine, _ ->
    val guard = UpdaterEngine::class.java.getDeclaredField("guard").apply { isAccessible = true }.get(engine)
      ?: error("Updater guard is missing")
    val held = CountDownLatch(1)
    val release = CountDownLatch(1)
    val holder = Thread {
      synchronized(guard) {
        held.countDown()
        release.await(5, TimeUnit.SECONDS)
      }
    }
    holder.start()
    assertTrue(held.await(5, TimeUnit.SECONDS))
    val completed = CountDownLatch(1)
    val callback = Thread {
      engine.onBackground()
      engine.onForeground(null)
      completed.countDown()
    }
    callback.start()
    try {
      assertTrue("Lifecycle callbacks waited for updater work", completed.await(1, TimeUnit.SECONDS))
    } finally {
      release.countDown()
      holder.join(5_000)
      callback.join(5_000)
    }
  }

  @Test fun backgroundAndLaterForegroundCannotResumeAnOldVerifiedHandoff() = withEngine { engine, journal ->
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    engine.onForeground(activity)
    val handoff = handoff(engine, journal)
    engine.onBackground()
    engine.onForeground(activity)

    continueHandoff(engine, handoff)

    assertEquals("ready", journal.read().kind)
  }

  @Test fun currentForegroundHandoffReachesTheInstallerVerificationGate() = withEngine { engine, journal ->
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    engine.onForeground(activity)
    val handoff = handoff(engine, journal)

    continueHandoff(engine, handoff)

    assertEquals("failed", journal.read().kind)
    assertEquals("checksum", journal.read().code)
    assertEquals("download", journal.read().retry)
  }

  @Test fun canceledGenerationCannotResumeAnOldVerifiedHandoff() = withEngine { engine, journal ->
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    engine.onForeground(activity)
    val handoff = handoff(engine, journal)
    journal.write(journal.read().copy(kind = "canceled", generation = 8))

    continueHandoff(engine, handoff)

    assertEquals("canceled", journal.read().kind)
  }

  private fun withEngine(test: (UpdaterEngine, UpdateJournal) -> Unit) {
    val base = RuntimeEnvironment.getApplication() as Context
    val files = Files.createTempDirectory("updater-handoff-test").toFile()
    try {
      val context = object : ContextWrapper(base) { override fun getFilesDir(): File = files }
      val journal = UpdateJournal(context)
      val constructor = UpdaterEngine::class.java.getDeclaredConstructor(
        Context::class.java, ReleaseTransport::class.java, UpdateVerifier::class.java, UpdateJournal::class.java,
      ).apply { isAccessible = true }
      val engine = constructor.newInstance(context, GitHubReleaseTransport(), UpdateVerifier(context), journal)
      test(engine, journal)
    } finally { files.deleteRecursively() }
  }

  private fun handoff(engine: UpdaterEngine, journal: UpdateJournal): Any {
    val release = UpdateRelease.parse(mapOf(
      "tag" to "android-v0.1.4", "version" to "0.1.4", "apkBytes" to 64L,
      "apkSha256" to "a".repeat(64), "notes" to "",
      "releaseUrl" to "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.4",
    ))
    journal.write(UpdateRecord(
      revision = 1, operation = "verified-operation", release = release,
      generation = 7, kind = "ready", versionCode = 100, minSdk = 30,
    ))
    val lease = UpdaterEngine::class.java.getDeclaredField("foregroundActivity")
      .apply { isAccessible = true }.get(engine) as WeakReference<*>
    val type = Class.forName("expo.modules.streamfusionnativecontracts.UpdaterEngine\$VerifiedHandoff")
    return type.getDeclaredConstructor(String::class.java, Long::class.javaPrimitiveType, WeakReference::class.java)
      .apply { isAccessible = true }.newInstance("verified-operation", 7L, lease)
  }

  private fun continueHandoff(engine: UpdaterEngine, handoff: Any) {
    UpdaterEngine::class.java.getDeclaredMethod("continueVerifiedUpdate", handoff.javaClass)
      .apply { isAccessible = true }.invoke(engine, handoff)
  }
}
