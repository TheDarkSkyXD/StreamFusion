package expo.modules.streamfusionnativecontracts

import android.database.Cursor
import android.net.Uri
import android.util.Base64
import androidx.sqlite.db.SimpleSQLiteQuery
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import net.zetetic.database.DatabaseErrorHandler
import net.zetetic.database.sqlcipher.SQLiteDatabase
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.Executors

class StreamFusionStorageModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private data class OpenDatabase(val database: SQLiteDatabase, val encrypted: Boolean)

  private val executor = Executors.newSingleThreadExecutor()
  private val databases = mutableMapOf<Int, OpenDatabase>()
  private var nextHandle = 1
  private val secureStore by lazy { StreamFusionSecureStore(context) }
  private val random = SecureRandom()
  private val names = Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$")
  private val keys = Regex("^[a-f0-9]{64}$")
  private val directory = File(context.filesDir, "SQLite")
  private val recovery = File(context.filesDir, "recovery")
  private val sidecars = listOf("", "-wal", "-shm", "-journal")

  override fun getName(): String = "StreamFusionStorage"

  private fun async(promise: Promise, operation: () -> Any?) {
    executor.execute {
      try {
        NativeBridge.resolve(promise, operation())
      } catch (error: Exception) {
        promise.reject("STORAGE_OPERATION_FAILED", error)
      }
    }
  }

  private fun file(name: String): File {
    require(names.matches(name) && name != "." && name != "..") { "Invalid database name." }
    return File(directory, name)
  }

  private fun key(value: String): String {
    require(keys.matches(value)) { "The database encryption key is invalid." }
    return "x'$value'"
  }

  private fun database(handle: Int): OpenDatabase =
    databases[handle] ?: throw IllegalStateException("The database handle is closed.")

  private fun loadCipher() {
    System.loadLibrary("sqlcipher")
  }

  private fun open(name: String, encryptionKey: String?, wal: Boolean = true): SQLiteDatabase {
    loadCipher()
    directory.mkdirs()
    val path = file(name)
    val password = encryptionKey?.let(::key) ?: ""
    val preserveCorruptFile = DatabaseErrorHandler { _, _ -> }
    val opened = SQLiteDatabase.openDatabase(
      path.absolutePath,
      password,
      null,
      SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY,
      preserveCorruptFile,
      null,
    )
    try {
      opened.query(SimpleSQLiteQuery("SELECT count(*) FROM sqlite_master")).use { it.moveToFirst() }
      if (encryptionKey != null) opened.execSQL("PRAGMA cipher_memory_security = ON")
      opened.execSQL("PRAGMA foreign_keys = ON")
      if (wal) opened.query(SimpleSQLiteQuery("PRAGMA journal_mode = WAL")).use { it.moveToFirst() }
      return opened
    } catch (error: Exception) {
      opened.close()
      throw error
    }
  }

  private fun version(): String? {
    return try {
      loadCipher()
      SQLiteDatabase.openDatabase(
        ":memory:", "", null,
        SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY,
        DatabaseErrorHandler { _, _ -> }, null,
      ).use { db ->
        db.query(SimpleSQLiteQuery("PRAGMA cipher_version")).use { cursor ->
          if (cursor.moveToFirst()) cursor.getString(0) else null
        }
      }
    } catch (_: LinkageError) {
      null
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun databaseExists(name: String): Boolean = file(name).exists()

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun randomBytes(length: Int): String {
    require(length in 1..4096) { "Invalid random byte count." }
    val bytes = ByteArray(length)
    random.nextBytes(bytes)
    val digits = "0123456789abcdef"
    return buildString(bytes.size * 2) {
      for (byte in bytes) {
        append(digits[(byte.toInt() and 255) ushr 4])
        append(digits[byte.toInt() and 15])
      }
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun randomUuid(): String = UUID.randomUUID().toString()

  @ReactMethod
  fun cipherVersion(promise: Promise) = async(promise) { version() }

  @ReactMethod
  fun openDatabase(name: String, encryptionKey: String?, promise: Promise) = async(promise) {
    val opened = open(name, encryptionKey)
    val handle = nextHandle++
    databases[handle] = OpenDatabase(opened, encryptionKey != null)
    mapOf("handle" to handle, "path" to file(name).absolutePath, "cipherVersion" to (if (encryptionKey == null) "unencrypted" else version()))
  }

  @ReactMethod
  fun closeDatabase(handle: Int, promise: Promise) = async(promise) {
    database(handle).database.close()
    databases.remove(handle)
    null
  }

  @ReactMethod
  fun execute(handle: Int, source: String, promise: Promise) = async(promise) {
    database(handle).database.execSQL(source)
    null
  }

  private fun args(parameters: ReadableArray): Array<Any?> = parameters.toArrayList().map { value ->
    if (value is Map<*, *> && value["kind"] == "blob") {
      Base64.decode(value["base64"] as String, Base64.DEFAULT)
    } else if (value is Boolean) {
      if (value) 1 else 0
    } else {
      value
    }
  }.toTypedArray()

  private fun rows(cursor: Cursor): List<Map<String, Any?>> {
    val values = mutableListOf<Map<String, Any?>>()
    while (cursor.moveToNext()) {
      val row = mutableMapOf<String, Any?>()
      for (index in 0 until cursor.columnCount) {
        row[cursor.getColumnName(index)] = when (cursor.getType(index)) {
          Cursor.FIELD_TYPE_NULL -> null
          Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(index).toDouble()
          Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(index)
          Cursor.FIELD_TYPE_BLOB -> mapOf("kind" to "blob", "base64" to Base64.encodeToString(cursor.getBlob(index), Base64.NO_WRAP))
          else -> cursor.getString(index)
        }
      }
      values.add(row)
    }
    return values
  }

  private fun query(db: SQLiteDatabase, source: String, args: Array<Any?>): List<Map<String, Any?>> =
    db.query(SimpleSQLiteQuery(source, args)).use(::rows)

  @ReactMethod
  fun query(handle: Int, source: String, parameters: ReadableArray, promise: Promise) = async(promise) {
    query(database(handle).database, source, args(parameters))
  }

  @ReactMethod
  fun run(handle: Int, source: String, parameters: ReadableArray, promise: Promise) = async(promise) {
    val db = database(handle).database
    db.execSQL(source, args(parameters))
    val result = query(db, "SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowId", emptyArray()).first()
    result
  }

  private fun removeArtifacts(name: String) {
    for (suffix in sidecars) {
      val artifact = file("$name$suffix")
      if (artifact.exists() && !artifact.delete()) throw IllegalStateException("A database artifact could not be deleted.")
    }
  }

  private fun removeSidecars(name: String) {
    for (suffix in sidecars.drop(1)) {
      val artifact = file("$name$suffix")
      if (artifact.exists() && !artifact.delete()) throw IllegalStateException("A database sidecar could not be deleted.")
    }
  }

  @ReactMethod
  fun deleteDatabase(name: String, promise: Promise) = async(promise) { removeArtifacts(name); null }

  @ReactMethod
  fun databaseAppearsEncrypted(name: String, promise: Promise) = async(promise) {
    val artifact = file(name)
    if (!artifact.exists() || artifact.length() == 0L) false else {
      val header = ByteArray(15)
      artifact.inputStream().use { it.read(header) }
      !header.contentEquals("SQLite format 3".toByteArray(StandardCharsets.US_ASCII))
    }
  }

  @ReactMethod
  fun databaseContainsBytes(name: String, value: String, promise: Promise) = async(promise) {
    val needle = value.toByteArray(StandardCharsets.UTF_8)
    require(needle.isNotEmpty()) { "The search value is empty." }
    val artifact = file(name)
    if (!artifact.exists()) false else {
      val prefix = IntArray(needle.size)
      for (index in 1 until needle.size) {
        var length = prefix[index - 1]
        while (length > 0 && needle[index] != needle[length]) length = prefix[length - 1]
        if (needle[index] == needle[length]) length++
        prefix[index] = length
      }
      var matched = 0
      artifact.inputStream().buffered().use { stream ->
        while (true) {
          val next = stream.read()
          if (next < 0) break
          while (matched > 0 && next != (needle[matched].toInt() and 255)) matched = prefix[matched - 1]
          if (next == (needle[matched].toInt() and 255)) matched++
          if (matched == needle.size) return@async true
        }
      }
      false
    }
  }

  @ReactMethod
  fun corruptDatabase(name: String, promise: Promise) = async(promise) {
    val artifact = file(name)
    require(artifact.exists()) { "Cannot corrupt a missing database." }
    removeSidecars(name)
    artifact.writeText("corrupt-streamfusion-database")
    null
  }

  @ReactMethod
  fun quarantineDatabase(name: String, reason: String, timestamp: Double, promise: Promise) = async(promise) {
    val original = file(name)
    if (!original.exists()) return@async Uri.fromFile(original).toString()
    recovery.mkdirs()
    val safeReason = reason.replace(Regex("[^a-zA-Z0-9-]"), "-").lowercase()
    val stamp = "${timestamp.toLong()}.$safeReason.quarantine"
    var primary = Uri.fromFile(original).toString()
    for (suffix in sidecars) {
      val source = file("$name$suffix")
      if (!source.exists()) continue
      val destination = File(recovery, "$name$suffix.$stamp")
      if (!source.renameTo(destination)) throw IllegalStateException("The database could not be quarantined.")
      if (suffix.isEmpty()) primary = Uri.fromFile(destination).toString()
    }
    primary
  }

  @ReactMethod
  fun deleteQuarantines(name: String, promise: Promise) = async(promise) {
    file(name)
    recovery.listFiles()?.filter { it.name.startsWith("$name.") }?.forEach {
      if (!it.delete()) throw IllegalStateException("A quarantine could not be deleted.")
    }
    null
  }

  private fun scalar(db: SQLiteDatabase, source: String): Long =
    db.query(SimpleSQLiteQuery(source)).use { cursor ->
      require(cursor.moveToFirst()) { "The database query returned no result." }
      cursor.getLong(0)
    }

  @ReactMethod
  fun backupDatabase(handle: Int, backupName: String, encryptionKey: String, promise: Promise) = async(promise) {
    val source = database(handle)
    val backup = file(backupName)
    val temporaryName = "$backupName.pending"
    val temporary = file(temporaryName)
    removeArtifacts(temporaryName)
    val db = source.database
    db.query(SimpleSQLiteQuery("PRAGMA wal_checkpoint(TRUNCATE)")).use { it.moveToFirst() }
    val userVersion = scalar(db, "PRAGMA user_version")
    val destinationKey = if (source.encrypted) key(encryptionKey) else ""
    val escapedPath = temporary.absolutePath.replace("'", "''")
    try {
      db.execSQL("ATTACH DATABASE '$escapedPath' AS streamfusion_backup KEY \"$destinationKey\"")
      try {
        db.query(SimpleSQLiteQuery("SELECT sqlcipher_export('streamfusion_backup')")).use { it.moveToFirst() }
        db.execSQL("PRAGMA streamfusion_backup.user_version = $userVersion")
      } finally {
        db.execSQL("DETACH DATABASE streamfusion_backup")
      }
      if (!temporary.exists() || temporary.length() == 0L) throw IllegalStateException("The database backup is empty.")
      open(temporaryName, if (source.encrypted) encryptionKey else null, wal = false).use { check ->
        check.query(SimpleSQLiteQuery("PRAGMA quick_check")).use { cursor ->
          require(cursor.moveToFirst() && cursor.getString(0) == "ok") { "The database backup is invalid." }
        }
        require(scalar(check, "PRAGMA user_version") == userVersion) { "The database backup lost its schema version." }
      }
      removeSidecars(temporaryName)
      val previous = file("$backupName.previous")
      removeArtifacts(previous.name)
      if (backup.exists() && !backup.renameTo(previous)) throw IllegalStateException("The previous backup could not be retained.")
      if (!temporary.renameTo(backup)) {
        if (previous.exists()) previous.renameTo(backup)
        throw IllegalStateException("The database backup could not be installed.")
      }
      removeArtifacts(previous.name)
      removeSidecars(temporaryName)
    } catch (error: Exception) {
      removeArtifacts(temporaryName)
      throw error
    }
    null
  }

  @ReactMethod
  fun restoreDatabase(backupName: String, name: String, backupKey: String, databaseKey: String, promise: Promise) = async(promise) {
    val backup = file(backupName)
    require(backup.exists()) { "The recovery backup is unavailable." }
    val temporaryName = "$name.restoring"
    val temporary = file(temporaryName)
    removeArtifacts(temporaryName)
    backup.copyTo(temporary, overwrite = true)
    try {
      val encrypted = temporary.inputStream().use { input ->
        val header = ByteArray(15)
        input.read(header)
        !header.contentEquals("SQLite format 3".toByteArray(StandardCharsets.US_ASCII))
      }
      if (encrypted) {
        open(temporaryName, backupKey, wal = false).use { db ->
          db.query(SimpleSQLiteQuery("PRAGMA journal_mode = DELETE")).use { it.moveToFirst() }
          db.query(SimpleSQLiteQuery("PRAGMA rekey = \"${key(databaseKey)}\"")).use { it.moveToFirst() }
        }
        open(temporaryName, databaseKey, wal = false).use { db ->
          db.query(SimpleSQLiteQuery("PRAGMA quick_check")).use { cursor ->
            require(cursor.moveToFirst() && cursor.getString(0) == "ok") { "The restored database is invalid." }
          }
        }
      } else {
        open(temporaryName, null, wal = false).close()
      }
      removeArtifacts(name)
      if (!temporary.renameTo(file(name))) throw IllegalStateException("The restored database could not be installed.")
      removeSidecars(temporaryName)
    } catch (error: Exception) {
      removeArtifacts(temporaryName)
      throw error
    }
    null
  }

  @ReactMethod
  fun secretIsAvailable(promise: Promise) = async(promise) { secureStore.available() }

  @ReactMethod
  fun secretGet(key: String, promise: Promise) = async(promise) { secureStore.get(key) }

  @ReactMethod
  fun secretSet(key: String, value: String, promise: Promise) = async(promise) { secureStore.set(key, value); null }

  @ReactMethod
  fun secretDelete(key: String, promise: Promise) = async(promise) { secureStore.delete(key); null }

  override fun invalidate() {
    executor.execute { databases.values.forEach { it.database.close() }; databases.clear() }
    executor.shutdown()
    super.invalidate()
  }
}
