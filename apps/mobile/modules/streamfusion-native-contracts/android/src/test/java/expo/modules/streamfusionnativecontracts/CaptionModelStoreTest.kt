package expo.modules.streamfusionnativecontracts

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptionModelStoreTest {
  @Test
  fun diagnosticInstallationCannotEnableProductionRecognition() {
    val root = Files.createTempDirectory("caption-model-proof").toFile()
    try {
      val store = CaptionModelStore(root)
      val installed = store.install("${CaptionCatalog.FIXTURE_URI}/install")
      assertEquals("fixture", installed["pack"])
      assertTrue(store.installed(true))
      assertFalse(store.installed())
      assertTrue((installed["downloadedBytes"] as Long) < 1024)
      assertEquals("integrity-error", store.install("${CaptionCatalog.FIXTURE_URI}/integrity-fail")["phase"])
      assertFalse(store.installed(true))
      assertEquals("not-installed", store.remove()["phase"])
    } finally { root.deleteRecursively() }
  }

  @Test
  fun officialArchiveRootDirectoryAndNestedModelFilesExtract() {
    val root = Files.createTempDirectory("caption-official-zip-shape").toFile()
    try {
      val archive = File(root, "model.zip")
      ZipOutputStream(archive.outputStream()).use { zip ->
        zip.putNextEntry(ZipEntry("${CaptionCatalog.MODEL_ROOT}/"))
        zip.closeEntry()
        zip.putNextEntry(ZipEntry("${CaptionCatalog.MODEL_ROOT}/am/"))
        zip.closeEntry()
        zip.putNextEntry(ZipEntry("${CaptionCatalog.MODEL_ROOT}/am/final.mdl"))
        zip.write(byteArrayOf(1, 2, 3))
        zip.closeEntry()
      }
      val staging = File(root, "staging")
      CaptionModelStore(root).extract(archive, staging)
      assertEquals(listOf<Byte>(1, 2, 3), File(staging, "am/final.mdl").readBytes().toList())
      assertFalse(File(root, "am").exists())
    } finally { root.deleteRecursively() }
  }
  @Test(expected = IOException::class)
  fun modelZipCannotEscapeStaging() {
    val root = Files.createTempDirectory("caption-zip-proof").toFile()
    try {
      val zip = File(root, "hostile.zip")
      ZipOutputStream(zip.outputStream()).use {
        it.putNextEntry(ZipEntry("${CaptionCatalog.MODEL_ROOT}/../../escaped"))
        it.write(byteArrayOf(1))
        it.closeEntry()
      }
      CaptionModelStore(root).extract(zip, File(root, "staging"))
    } finally { root.deleteRecursively() }
  }
}
