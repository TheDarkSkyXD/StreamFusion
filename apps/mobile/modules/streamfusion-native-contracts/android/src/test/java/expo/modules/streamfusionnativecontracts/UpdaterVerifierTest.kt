package expo.modules.streamfusionnativecontracts

import android.content.Context
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class UpdaterVerifierTest {
  private val context = RuntimeEnvironment.getApplication() as Context
  private val manifest = UpdateManifest(6, 30, "StreamFusion-android-v0.1.4.apk")

  @Test fun rejectsBytesThatMatchMetadataButAreNotASignedApk() {
    val file = File(context.cacheDir, "updater-invalid.apk")
    file.writeText("an archive must have a valid Android APK signature")
    try {
      val release = UpdateRelease(
        "android-v0.1.4", "0.1.4", file.length(), sha256(file), "",
        "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.4",
      )
      val failure = assertThrows(UpdateFailureException::class.java) {
        UpdateVerifier(context).verify(file, release, manifest)
      }
      assertEquals("signature", failure.code)
    } finally { file.delete() }
  }

  @Test fun rejectsChecksumBeforeArchiveParsing() {
    val file = File(context.cacheDir, "updater-invalid.apk")
    file.writeText("not the expected APK")
    try {
      val release = UpdateRelease(
        "android-v0.1.4", "0.1.4", file.length(), "0".repeat(64), "",
        "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.4",
      )
      val failure = assertThrows(UpdateFailureException::class.java) {
        UpdateVerifier(context).verify(file, release, manifest)
      }
      assertEquals("checksum", failure.code)
    } finally { file.delete() }
  }
}
