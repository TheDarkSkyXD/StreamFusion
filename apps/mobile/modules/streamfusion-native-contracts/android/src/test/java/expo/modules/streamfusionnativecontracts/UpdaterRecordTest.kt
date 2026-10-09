package expo.modules.streamfusionnativecontracts

import android.content.Context
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import java.util.UUID
import org.json.JSONObject

@RunWith(RobolectricTestRunner::class)
class UpdaterRecordTest {
  private val release = mapOf<String, Any>(
    "tag" to "android-v0.1.4-alpha.1",
    "version" to "0.1.4-alpha.1",
    "apkBytes" to 24L,
    "apkSha256" to "a".repeat(64),
    "notes" to "Update notes",
    "releaseUrl" to "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.4-alpha.1",
  )

  @Test fun releaseAcceptsOnlyCanonicalIdentity() {
    val parsed = UpdateRelease.parse(release)
    assertEquals("android-v0.1.4-alpha.1", parsed.tag)
    assertEquals(24L, parsed.apkBytes)
    assertThrows(IllegalArgumentException::class.java) {
      UpdateRelease.parse(release + ("releaseUrl" to "https://example.com/android-v0.1.4-alpha.1"))
    }
    assertThrows(IllegalArgumentException::class.java) {
      UpdateRelease.parse(release + ("apkSha256" to "0".repeat(63)))
    }
  }

  @Test fun journalRestoresTheSameOperationAfterRecreation() {
    val context = RuntimeEnvironment.getApplication() as Context
    val root = File(context.filesDir, "app-update")
    root.deleteRecursively()
    val operation = UUID.randomUUID().toString()
    val first = UpdateJournal(context)
    first.write(UpdateRecord(
      revision = 8, operation = operation, release = UpdateRelease.parse(release),
      generation = 3, kind = "paused", bytes = 12, reason = "network",
      versionCode = 6, minSdk = 30,
    ))
    val restored = UpdateJournal(context).read()
    assertEquals(operation, restored.operation)
    assertEquals(3L, restored.generation)
    assertEquals(6L, restored.versionCode)
    assertEquals(mapOf("kind" to "paused", "operation" to operation,
      "release" to UpdateRelease.parse(release).wire(), "bytes" to 12L,
      "reason" to "network"), restored.wire()["phase"])
    root.deleteRecursively()
  }

  @Test fun corruptJournalDoesNotClaimAnInstalledUpdate() {
    val context = RuntimeEnvironment.getApplication() as Context
    val root = File(context.filesDir, "app-update").apply { mkdirs() }
    File(root, "operation.json").writeText("not-json")
    val phase = UpdateJournal(context).read().wire()["phase"] as Map<*, *>
    assertEquals("unsupported", phase["kind"])
    assertTrue((phase["message"] as String).contains("unavailable"))
    root.deleteRecursively()
  }

  @Test fun installerFailureRestoresFromSchemaOneJournalAndOnlyFailedWireExposesIt() {
    val context = RuntimeEnvironment.getApplication() as Context
    val root = File(context.filesDir, "app-update")
    root.deleteRecursively()
    try {
      val failure = InstallerFailureDetail.fromCallback(5, "  signature conflict  ")
      val record = UpdateRecord(revision = 3, operation = "failed-install", release = UpdateRelease.parse(release),
        generation = 2, kind = "failed", code = "install-blocked", retry = "install", installerFailure = failure)
      val journal = UpdateJournal(context)
      journal.write(record)
      val restored = UpdateJournal(context).read()
      assertEquals(1, restored.json().getInt("schema"))
      assertEquals(mapOf("status" to 5, "message" to "signature conflict"),
        (restored.wire()["phase"] as Map<*, *>)["installerFailure"])
      assertNull((restored.copy(kind = "ready").wire()["phase"] as Map<*, *>)["installerFailure"])

      val legacy = record.json().apply { remove("installerFailure") }
      assertNull(UpdateRecord.fromJson(legacy).installerFailure)
      val malformed = record.json().apply {
        put("installerFailure", JSONObject().put("status", 5).put("message", "x".repeat(1025)))
      }
      assertThrows(IllegalArgumentException::class.java) { UpdateRecord.fromJson(malformed) }
    } finally { root.deleteRecursively() }
  }

  @Test fun callbackBoundsAndTrimsInstallerMessage() {
    val detail = InstallerFailureDetail.fromCallback(4, "  " + "x".repeat(1100) + "  ")
    assertEquals(4, detail?.status)
    assertEquals("x".repeat(1024), detail?.message)
    assertNull(InstallerFailureDetail.fromCallback(4, " \n "))
    assertNull(InstallerFailureDetail.fromCallback(0, "success"))
  }
}
