package expo.modules.streamfusionnativecontracts

import android.content.Context
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import java.util.UUID

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
}
