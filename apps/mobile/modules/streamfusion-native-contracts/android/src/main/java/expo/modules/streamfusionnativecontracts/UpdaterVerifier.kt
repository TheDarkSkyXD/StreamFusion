package expo.modules.streamfusionnativecontracts

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.android.apksig.ApkVerifier
import java.io.File
import java.security.MessageDigest
import java.security.cert.Certificate

internal class UpdateVerifier(private val context: Context) {
  fun installedVersion(): Long = installedPackage().longVersionCode

  fun verify(file: File, release: UpdateRelease, manifest: UpdateManifest) {
    if (!file.isFile || file.length() != release.apkBytes) throw UpdateFailureException("checksum")
    if (sha256(file) != release.apkSha256) throw UpdateFailureException("checksum")
    val verified = try {
      ApkVerifier.Builder(file)
        .setMinCheckedPlatformVersion(Build.VERSION.SDK_INT)
        .setMaxCheckedPlatformVersion(Build.VERSION.SDK_INT)
        .build().verify()
    } catch (_: Exception) { throw UpdateFailureException("signature") }
    if (!verified.isVerified || verified.signerCertificates.isEmpty()) throw UpdateFailureException("signature")
    val archive = context.packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
      ?: throw UpdateFailureException("package")
    if (archive.packageName != context.packageName) throw UpdateFailureException("package")
    if (archive.versionName != release.version || archive.longVersionCode != manifest.versionCode) {
      throw UpdateFailureException("version")
    }
    if (archive.applicationInfo?.minSdkVersion != manifest.minSdk || manifest.minSdk > Build.VERSION.SDK_INT) {
      throw UpdateFailureException("sdk")
    }
    val installed = installedPackage()
    if (archive.longVersionCode <= installed.longVersionCode) throw UpdateFailureException("version")
    val current = installed.signingInfo?.apkContentsSigners?.map { digest(it.toByteArray()) }?.toSet().orEmpty()
    val candidate = verified.signerCertificates.map(::digest).toSet()
    if (current.isEmpty() || candidate != current) throw UpdateFailureException("signature")
    if (context.packageName == PRODUCTION_PACKAGE && candidate != setOf(PRODUCTION_CERTIFICATE)) {
      throw UpdateFailureException("signature")
    }
  }

  private fun installedPackage() = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)

  private fun digest(cert: Certificate): String = digest(cert.encoded)
  private fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(it) }

  companion object {
    private const val PRODUCTION_PACKAGE = "com.thedarkskyxd.streamfusion"
    private const val PRODUCTION_CERTIFICATE = "e84285558899c9eef61d5c8cd28f5fdb59ff70240246e7a073cb622642ef3c57"
  }
}
