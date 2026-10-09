package expo.modules.streamfusionnativecontracts

import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageInstaller
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class UpdaterInstallResultTest {
  @Test fun failedInstallerCallbackSurvivesRestoreAndRetryClearsIt() = withEngine { engine, journal ->
    engine.onInstallResult(41, PackageInstaller.STATUS_FAILURE_CONFLICT, null, "  conflicting certificate  ")

    val failed = journal.read()
    assertEquals("failed", failed.kind)
    assertEquals("install-failed", failed.code)
    assertEquals("install", failed.retry)
    assertEquals(InstallerFailureDetail(5, "conflicting certificate"), failed.installerFailure)
    assertEquals(mapOf("status" to 5, "message" to "conflicting certificate"),
      (engine.snapshot()["phase"] as Map<*, *>)["installerFailure"])

    engine.command(mapOf("kind" to "retry", "operation" to "install-operation"), null)
    assertNull(journal.read().installerFailure)
  }

  @Test fun staleSessionCannotOverwriteCurrentFailure() = withEngine { engine, journal ->
    engine.onInstallResult(40, PackageInstaller.STATUS_FAILURE_BLOCKED, null, "stale reason")
    assertEquals("awaiting-approval", journal.read().kind)
    assertNull(journal.read().installerFailure)

    engine.onInstallResult(41, PackageInstaller.STATUS_FAILURE_BLOCKED, null, "policy blocked")
    assertEquals("install-blocked", journal.read().code)
    assertEquals(InstallerFailureDetail(2, "policy blocked"), journal.read().installerFailure)
    engine.onInstallResult(41, PackageInstaller.STATUS_FAILURE_INVALID, null, "late reason")
    assertEquals(InstallerFailureDetail(2, "policy blocked"), journal.read().installerFailure)
  }

  private fun withEngine(test: (UpdaterEngine, UpdateJournal) -> Unit) {
    val base = RuntimeEnvironment.getApplication() as Context
    val files = Files.createTempDirectory("updater-installer-result-test").toFile()
    try {
      val context = object : ContextWrapper(base) { override fun getFilesDir(): File = files }
      val journal = UpdateJournal(context)
      val release = UpdateRelease.parse(mapOf(
        "tag" to "android-v0.1.4", "version" to "0.1.4", "apkBytes" to 64L,
        "apkSha256" to "a".repeat(64), "notes" to "",
        "releaseUrl" to "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.4",
      ))
      journal.write(UpdateRecord(revision = 1, operation = "install-operation", release = release,
        generation = 2, kind = "awaiting-approval", sessionId = 41, versionCode = 100,
        minSdk = 30, stageAt = System.currentTimeMillis()))
      val constructor = UpdaterEngine::class.java.getDeclaredConstructor(
        Context::class.java, ReleaseTransport::class.java, UpdateVerifier::class.java, UpdateJournal::class.java,
      ).apply { isAccessible = true }
      val engine = constructor.newInstance(context, GitHubReleaseTransport(), UpdateVerifier(context), journal)
      test(engine, journal)
    } finally { files.deleteRecursively() }
  }
}
