package expo.modules.streamfusionnativecontracts

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.soloader.SoLoader
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import java.lang.reflect.Proxy
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StreamFusionStorageRecoveryTest {
  private fun invoke(operation: (Promise) -> Unit): Any? {
    val result = CompletableFuture<Any?>()
    val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
      when (method.name) {
        "resolve" -> result.complete(args?.firstOrNull())
        "reject" -> result.completeExceptionally(args?.filterIsInstance<Throwable>()?.firstOrNull() ?: IllegalStateException("The native operation was rejected."))
      }
      null
    } as Promise
    operation(promise)
    return result.get(30, TimeUnit.SECONDS)
  }

  @Test
  fun restoresEncryptedRowsAndSchemaUnderTheOriginalKey() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    SoLoader.init(context, OpenSourceMergedSoMapping)
    val module = StreamFusionStorageModule(BridgeReactContext(context))
    val prefix = "storage-recovery-${UUID.randomUUID()}"
    val product = "$prefix.db"
    val backup = "$prefix.backup.db"
    val productKey = "11".repeat(32)
    val backupKey = "22".repeat(32)
    var handle: Int? = null
    try {
      val opened = invoke { module.openDatabase(product, productKey, it) } as ReadableMap
      val sourceHandle = opened.getInt("handle")
      handle = sourceHandle
      invoke { module.execute(sourceHandle, "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT", it) }
      invoke { module.execute(sourceHandle, "INSERT INTO settings VALUES ('proof', 'preserved setting')", it) }
      invoke { module.execute(sourceHandle, "PRAGMA user_version = 5", it) }
      invoke { module.backupDatabase(sourceHandle, backup, backupKey, it) }
      invoke { module.closeDatabase(sourceHandle, it) }
      handle = null
      invoke { module.quarantineDatabase(product, "proof", 1.0, it) }
      invoke { module.restoreDatabase(backup, product, backupKey, productKey, it) }
      val restored = invoke { module.openDatabase(product, productKey, it) } as ReadableMap
      val restoredHandle = restored.getInt("handle")
      handle = restoredHandle
      val parameters = com.facebook.react.bridge.Arguments.createArray()
      val rows = invoke { module.query(restoredHandle, "SELECT value FROM settings WHERE key = 'proof'", parameters, it) } as ReadableArray
      assertEquals("preserved setting", requireNotNull(rows.getMap(0)).getString("value"))
      val version = invoke { module.query(restoredHandle, "PRAGMA user_version", parameters, it) } as ReadableArray
      assertEquals(5, requireNotNull(version.getMap(0)).getInt("user_version"))
      val integrity = invoke { module.query(restoredHandle, "PRAGMA cipher_integrity_check", parameters, it) } as ReadableArray
      assertEquals(0, integrity.size())
    } finally {
      handle?.let { open -> invoke { module.closeDatabase(open, it) } }
      invoke { module.deleteDatabase(product, it) }
      invoke { module.deleteDatabase(backup, it) }
      invoke { module.deleteQuarantines(product, it) }
      module.invalidate()
    }
  }
}
