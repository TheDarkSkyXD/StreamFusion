package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import java.io.File
import java.lang.ref.WeakReference
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows

@RunWith(RobolectricTestRunner::class)
class UpdaterHandoffTest {
  @Test fun foregroundResumesAuthorizedReadyUpdateAfterBackgroundCompletion() = withEngine { engine, journal ->
    engine.snapshot()
    journal.write(record(kind = "ready", installIntent = true))
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()

    engine.onForeground(activity)
    awaitForegroundWork(engine)

    assertEquals("failed", journal.read().kind)
    assertEquals("checksum", journal.read().code)
    assertEquals("download", journal.read().retry)
    assertFalse(journal.read().installIntent)
  }

  @Test fun laterForegroundLeaseResumesReadyWhenEarlierCallbackBecomesStale() = withEngine { engine, journal ->
    engine.snapshot()
    journal.write(record(kind = "ready", installIntent = true))
    val first = Robolectric.buildActivity(Activity::class.java).setup().get()
    val second = Robolectric.buildActivity(Activity::class.java).setup().get()
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val executor = updaterExecutor(engine)
    executor.submit { entered.countDown(); release.await(5, TimeUnit.SECONDS) }
    assertTrue(entered.await(5, TimeUnit.SECONDS))

    try {
      engine.onForeground(first)
      engine.onBackground()
      engine.onForeground(second)
    } finally { release.countDown() }
    awaitForegroundWork(engine)

    assertEquals("failed", journal.read().kind)
    assertEquals("checksum", journal.read().code)
    assertFalse(journal.read().installIntent)
  }

  @Test fun duplicateForegroundCallbacksConsumeAuthorizedReadyOnce() = withEngine { engine, journal ->
    engine.snapshot()
    journal.write(record(kind = "ready", installIntent = true))
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()

    engine.onForeground(activity)
    engine.onForeground(activity)
    awaitForegroundWork(engine)

    assertEquals("failed", journal.read().kind)
    assertEquals("checksum", journal.read().code)
    assertEquals(2L, journal.read().revision)
  }

  @Test fun foregroundResumesAuthorizedPermissionAfterProcessReplacement() = withEngine(
    record(kind = "permission-needed", installIntent = true),
  ) { engine, journal ->
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    setInstallPermission(true)

    engine.onForeground(activity)
    awaitForegroundWork(engine)

    assertEquals("failed", journal.read().kind)
    assertEquals("checksum", journal.read().code)
    assertEquals("download", journal.read().retry)
    assertFalse(journal.read().installIntent)
  }

  @Test fun legacyReadyWithoutInstallIntentWaitsForExplicitInstall() = withEngine { engine, journal ->
    engine.snapshot()
    journal.write(record(kind = "ready", installIntent = false))
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()

    engine.onForeground(activity)
    awaitForegroundWork(engine)

    assertEquals("ready", journal.read().kind)
    assertFalse(journal.read().installIntent)
  }

  @Test fun deniedPermissionClearsIntentAndLaterForegroundDoesNotRetry() = withEngine(
    record(kind = "permission-needed", installIntent = true),
  ) { engine, journal ->
    assertFalse("Test requires unknown-source permission denied", enginePackageCanInstall(engine))
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()

    engine.onForeground(activity)
    engine.onForeground(activity)
    awaitForegroundWork(engine)
    val denied = journal.read()
    assertEquals("permission-needed", denied.kind)
    assertFalse(denied.installIntent)

    engine.onBackground()
    engine.onForeground(activity)
    awaitForegroundWork(engine)
    assertEquals(denied, journal.read())
  }

  @Test fun canceledOperationCannotResumeOnForeground() = withEngine { engine, journal ->
    engine.snapshot()
    journal.write(record(kind = "canceled", installIntent = false))
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()

    engine.onForeground(activity)
    awaitForegroundWork(engine)

    assertEquals("canceled", journal.read().kind)
    assertFalse(journal.read().installIntent)
  }

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
    awaitForegroundWork(engine)
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    updaterExecutor(engine).submit { entered.countDown(); release.await(5, TimeUnit.SECONDS) }
    assertTrue(entered.await(5, TimeUnit.SECONDS))
    val handoff = handoff(engine, journal, installIntent = true)

    try {
      engine.onBackground()
      engine.onForeground(activity)
      continueHandoff(engine, handoff)

      assertEquals("ready", journal.read().kind)
      assertTrue(journal.read().installIntent)
    } finally { release.countDown() }
    awaitForegroundWork(engine)

    assertEquals("failed", journal.read().kind)
    assertEquals("checksum", journal.read().code)
  }

  @Test fun currentForegroundHandoffReachesTheInstallerVerificationGate() = withEngine { engine, journal ->
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    engine.onForeground(activity)
    val handoff = handoff(engine, journal, installIntent = true)

    continueHandoff(engine, handoff)

    assertEquals("failed", journal.read().kind)
    assertEquals("checksum", journal.read().code)
    assertEquals("download", journal.read().retry)
  }

  @Test fun canceledGenerationCannotResumeAnOldVerifiedHandoff() = withEngine { engine, journal ->
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    engine.onForeground(activity)
    awaitForegroundWork(engine)
    val handoff = handoff(engine, journal, installIntent = true)
    journal.write(journal.read().copy(kind = "canceled", generation = 8))

    continueHandoff(engine, handoff)

    assertEquals("canceled", journal.read().kind)
  }

  private fun withEngine(initial: UpdateRecord? = null, test: (UpdaterEngine, UpdateJournal) -> Unit) {
    val base = RuntimeEnvironment.getApplication() as Context
    val files = Files.createTempDirectory("updater-handoff-test").toFile()
    try {
      val context = object : ContextWrapper(base) { override fun getFilesDir(): File = files }
      Shadows.shadowOf(context.packageManager).setCanRequestPackageInstalls(false)
      val journal = UpdateJournal(context)
      if (initial != null) journal.write(initial)
      val constructor = UpdaterEngine::class.java.getDeclaredConstructor(
        Context::class.java, ReleaseTransport::class.java, UpdateVerifier::class.java, UpdateJournal::class.java,
      ).apply { isAccessible = true }
      val engine = constructor.newInstance(context, GitHubReleaseTransport(), UpdateVerifier(context), journal)
      if (initial != null) UpdaterEngine::class.java.getDeclaredField("firstReconciliation")
        .apply { isAccessible = true }.setBoolean(engine, false)
      test(engine, journal)
    } finally {
      Shadows.shadowOf(base.packageManager).setCanRequestPackageInstalls(false)
      files.deleteRecursively()
    }
  }

  private fun handoff(engine: UpdaterEngine, journal: UpdateJournal, installIntent: Boolean = false): Any {
    val release = UpdateRelease.parse(mapOf(
      "tag" to "android-v0.1.4", "version" to "0.1.4", "apkBytes" to 64L,
      "apkSha256" to "a".repeat(64), "notes" to "",
      "releaseUrl" to "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.4",
    ))
    journal.write(UpdateRecord(
      revision = 1, operation = "verified-operation", release = release,
      generation = 7, kind = "ready", versionCode = 100, minSdk = 30, installIntent = installIntent,
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

  private fun awaitForegroundWork(engine: UpdaterEngine) {
    updaterExecutor(engine).submit { }.get(5, TimeUnit.SECONDS)
  }

  private fun updaterExecutor(engine: UpdaterEngine): ExecutorService =
    UpdaterEngine::class.java.getDeclaredField("executor")
      .apply { isAccessible = true }.get(engine) as ExecutorService

  private fun enginePackageCanInstall(engine: UpdaterEngine): Boolean {
    val context = UpdaterEngine::class.java.getDeclaredField("context")
      .apply { isAccessible = true }.get(engine) as Context
    return context.packageManager.canRequestPackageInstalls()
  }

  private fun setInstallPermission(granted: Boolean) {
    val context = RuntimeEnvironment.getApplication() as Context
    Shadows.shadowOf(context.packageManager).setCanRequestPackageInstalls(granted)
  }

  private fun record(kind: String, installIntent: Boolean): UpdateRecord = UpdateRecord(
    revision = 1, operation = "restored-operation", release = UpdateRelease.parse(mapOf(
      "tag" to "android-v0.1.4", "version" to "0.1.4", "apkBytes" to 64L,
      "apkSha256" to "a".repeat(64), "notes" to "",
      "releaseUrl" to "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.4",
    )), generation = 7, kind = kind, versionCode = 100, minSdk = 30, installIntent = installIntent,
  )
}
