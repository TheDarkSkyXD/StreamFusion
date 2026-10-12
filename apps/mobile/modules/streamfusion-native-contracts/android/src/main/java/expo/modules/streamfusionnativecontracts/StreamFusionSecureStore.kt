package expo.modules.streamfusionnativecontracts

import android.content.Context
import android.preference.PreferenceManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class StreamFusionSecureStore(private val context: Context) {
  private val service = "streamfusion.mobile.secrets"
  private val prefs = context.getSharedPreferences("SecureStore", Context.MODE_PRIVATE)
  private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private val alias = "AES/GCM/NoPadding:$service:keystoreUnauthenticated"
  private val legacyAlias = "AES/GCM/NoPadding:$service"

  fun available(): Boolean = android.os.Build.VERSION.SDK_INT >= 23

  fun get(key: String): String? {
    val encoded = prefs.getString("$service-$key", null) ?: prefs.getString(key, null) ?: return null
    val item = JSONObject(encoded)
    if (item.optString("scheme") != "aes" || item.optBoolean("requireAuthentication", false)) {
      throw IllegalStateException("The stored credential has an unsupported encryption scheme.")
    }
    val storedService = item.optString("keystoreAlias", service)
    if (storedService != service) throw IllegalStateException("The stored credential belongs to a different service.")
    val keyAlias = if (item.optBoolean("usesKeystoreSuffix", false)) alias else legacyAlias
    val secret = keyStore.getKey(keyAlias, null) as? SecretKey
      ?: throw IllegalStateException("The stored credential key is unavailable.")
    val tagLength = item.getInt("tlen")
    if (tagLength < 96) throw IllegalStateException("The stored credential tag is invalid.")
    val iv = Base64.decode(item.getString("iv"), Base64.DEFAULT)
    val ciphertext = Base64.decode(item.getString("ct"), Base64.DEFAULT)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(tagLength, iv))
    return String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
  }

  fun set(key: String, value: String) {
    if (prefs.contains("$service-$key") || prefs.contains(key)) get(key)
    val secret = keyStore.getKey(alias, null) as? SecretKey ?: createKey()
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secret)
    val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
    val tagLength = cipher.parameters.getParameterSpec(GCMParameterSpec::class.java).tLen
    val item = JSONObject()
      .put("ct", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
      .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put("tlen", tagLength)
      .put("scheme", "aes")
      .put("usesKeystoreSuffix", true)
      .put("keystoreAlias", service)
      .put("requireAuthentication", false)
    if (!prefs.edit().putString("$service-$key", item.toString()).remove(key).commit()) {
      throw IllegalStateException("The credential could not be saved.")
    }
  }

  fun delete(key: String) {
    if (!prefs.edit().remove("$service-$key").remove(key).commit()) {
      throw IllegalStateException("The credential could not be deleted.")
    }
    PreferenceManager.getDefaultSharedPreferences(context).edit().remove(key).commit()
  }

  private fun createKey(): SecretKey {
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        alias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setKeySize(256)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setUserAuthenticationRequired(false)
        .build(),
    )
    return generator.generateKey()
  }
}
