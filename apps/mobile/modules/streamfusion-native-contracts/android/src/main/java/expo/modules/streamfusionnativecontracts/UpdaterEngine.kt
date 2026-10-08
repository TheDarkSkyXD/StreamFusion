package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.FileInputStream
import java.io.IOException
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

internal class UpdaterEngine private constructor(
  private val context: Context,
  private val transport: ReleaseTransport,
  private val verifier: UpdateVerifier,
  private val journal: UpdateJournal,
) {
  private val guard = Any()
  private val executor = Executors.newSingleThreadExecutor()
  private val listeners = CopyOnWriteArrayList<(Long) -> Unit>()
  private var worker: Future<*>? = null
  private var workerExit: CountDownLatch? = null
  private var servicePending = false
  private var firstReconciliation = true
  @Volatile private var foregroundActivity: WeakReference<Activity>? = null
  private data class VerifiedHandoff(val operation: String, val generation: Long, val activity: WeakReference<Activity>)
  private data class PermissionReturn(val operation: String, val generation: Long)
  private var permissionReturn: PermissionReturn? = null

  fun listen(listener: (Long) -> Unit) { listeners.add(listener) }
  fun unlisten(listener: (Long) -> Unit) { listeners.remove(listener) }

  fun snapshot(): Map<String, Any> = synchronized(guard) {
    reconcileLocked().wire()
  }

  fun command(input: Map<String, Any>, activity: Activity?): Map<String, Any> {
    val kind = input["kind"] as? String ?: error("Invalid update command")
    return when (kind) {
      "download" -> {
        rememberActivity(activity)
        val release = UpdateRelease.parse(input["release"] as? Map<*, *> ?: error("Missing release"))
        val current = synchronized(guard) { reconcileLocked() }
        if (current.kind in ACTIVE_KINDS) return current.wire()
        awaitWorkerExit()
        synchronized(guard) {
          val latest = reconcileLocked()
          if (latest.kind in ACTIVE_KINDS) return@synchronized latest.wire()
          abandonLocked(latest)
          journal.partial.delete(); journal.verified.delete()
          val next = saveLocked(UpdateRecord(
            revision = latest.revision, operation = journal.newOperation(), release = release,
            generation = latest.generation + 1, kind = "downloading", stageAt = System.currentTimeMillis(),
          ))
          startServiceLocked(next)
          journal.read().wire()
        }
      }
      "cancel" -> cancel(input["operation"] as? String ?: error("Missing operation"))
      "retry" -> retry(input["operation"] as? String ?: error("Missing operation"), activity)
      "install" -> install(input["operation"] as? String ?: error("Missing operation"), activity)
      else -> error("Invalid update command")
    }
  }

  private fun cancel(operation: String): Map<String, Any> {
    var exit: CountDownLatch? = null
    var canceled = false
    val next = synchronized(guard) {
      val current = journal.read()
      if (current.operation != operation || current.kind in TERMINAL_KINDS || current.kind == "awaiting-approval") {
        return@synchronized current
      }
      canceled = true
      val invalidated = saveLocked(current.copy(generation = current.generation + 1, kind = "canceled", installIntent = false, sessionId = -1))
      exit = workerExit
      transport.cancel()
      abandonLocked(current)
      invalidated
    }
    if (!canceled) return next.wire()
    val stopped = try { exit?.await(35, TimeUnit.SECONDS) ?: true }
      catch (_: InterruptedException) { Thread.currentThread().interrupt(); false }
    synchronized(guard) {
      val current = journal.read()
      if (current.operation == next.operation && current.generation == next.generation && current.kind == "canceled") {
        if (stopped) { journal.partial.delete(); journal.verified.delete() }
        context.stopService(Intent(context, UpdaterForegroundService::class.java))
      }
    }
    return next.wire()
  }

  private fun retry(operation: String, activity: Activity?): Map<String, Any> {
    rememberActivity(activity)
    val observed = synchronized(guard) { reconcileLocked() }
    if (observed.operation != operation || observed.kind in setOf("downloading", "verifying", "staging", "awaiting-approval", "installed")) {
      return observed.wire()
    }
    awaitWorkerExit()
    return synchronized(guard) {
      val current = reconcileLocked()
      if (current.operation != operation) return@synchronized current.wire()
      if (current.kind == "ready" || current.kind == "permission-needed" ||
        (current.kind == "failed" && current.retry == "install")) {
        return@synchronized installLocked(current, activity).wire()
      }
      if (current.kind != "paused" && current.kind != "canceled" &&
        !(current.kind == "failed" && current.retry == "download")) return@synchronized current.wire()
      abandonLocked(current)
      journal.partial.delete(); journal.verified.delete()
      val next = saveLocked(current.copy(
        kind = "downloading", generation = current.generation + 1, bytes = 0,
        versionCode = 0, minSdk = 0, sessionId = -1, installIntent = false,
        reason = null, code = null, retry = null, stageAt = System.currentTimeMillis(),
      ))
      startServiceLocked(next)
      journal.read().wire()
    }
  }

  private fun awaitWorkerExit() {
    val exit = synchronized(guard) { workerExit }
    if (exit != null && !exit.await(35, TimeUnit.SECONDS)) {
      error("Previous update work is still stopping")
    }
  }

  private fun install(operation: String, activity: Activity?): Map<String, Any> = synchronized(guard) {
    rememberActivity(activity)
    val current = reconcileLocked()
    if (current.operation != operation) return@synchronized current.wire()
    if (current.kind == "awaiting-approval") return@synchronized continueApprovalLocked(current).wire()
    installLocked(current, activity).wire()
  }

  private fun continueApprovalLocked(current: UpdateRecord): UpdateRecord {
    val pending = consentPendingIntent(current.sessionId, null, PendingIntent.FLAG_NO_CREATE)
      ?: return failLocked(current, "interrupted", "install")
    return try { pending.send(); current }
      catch (_: PendingIntent.CanceledException) { failLocked(current, "interrupted", "install") }
  }

  private fun installLocked(current: UpdateRecord, activity: Activity?): UpdateRecord {
    if (current.kind !in setOf("ready", "permission-needed", "failed") ||
      (current.kind == "failed" && current.retry != "install")) return current
    val release = current.release ?: return current
    val manifest = UpdateManifest(current.versionCode, current.minSdk, "StreamFusion-${release.tag}.apk")
    try { verifier.verify(journal.verified, release, manifest) }
    catch (error: UpdateFailureException) { return failLocked(current, error.code, "download") }
    if (!context.packageManager.canRequestPackageInstalls()) {
      val waiting = saveLocked(current.copy(kind = "permission-needed", installIntent = false, code = null, retry = null))
      val operation = waiting.operation ?: return waiting
      val lease = foregroundActivity?.takeIf { it.get() === activity }
      if (lease != null && activity != null) activity.runOnUiThread {
        synchronized(guard) {
          val latest = journal.read()
          if (foreground(lease) == null || latest.operation != waiting.operation ||
            latest.generation != waiting.generation || latest.kind != "permission-needed") return@synchronized
          try {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
              Uri.parse("package:${context.packageName}")))
            permissionReturn = PermissionReturn(operation, waiting.generation)
            saveLocked(latest.copy(installIntent = true))
          } catch (_: Exception) {
            failLocked(latest, "install-failed", "install")
          }
        }
      }
      return waiting
    }
    abandonLocked(current)
    val next = saveLocked(current.copy(
      kind = "staging", generation = current.generation + 1, installIntent = false,
      code = null, retry = null, sessionId = -1, stageAt = System.currentTimeMillis(),
    ))
    val exit = CountDownLatch(1)
    workerExit = exit
    worker = executor.submit { try { stage(next.generation) } finally { staleCleanup(next.generation); exit.countDown() } }
    return next
  }

  fun onForeground(activity: Activity?) {
    val lease = activity?.let(::WeakReference)
    val request = synchronized(guard) {
      foregroundActivity = lease
      permissionReturn.also { permissionReturn = null }
    } ?: return
    executor.submit {
      synchronized(guard) {
        val current = reconcileLocked()
        if (current.operation != request.operation || current.generation != request.generation ||
          current.kind != "permission-needed") return@synchronized
        val returned = saveLocked(current.copy(installIntent = false))
        if (lease != null && foreground(lease) != null) {
          try {
            if (context.packageManager.canRequestPackageInstalls()) installLocked(returned, activity)
          }
          catch (_: Exception) {
            val latest = journal.read()
            if (latest.operation == request.operation && latest.generation == request.generation &&
              latest.kind == "permission-needed") failLocked(latest, "install-failed", "install")
          }
        }
      }
    }
  }

  fun onBackground() { synchronized(guard) { foregroundActivity = null } }

  fun startTransferFromService() {
    synchronized(guard) {
      servicePending = false
      val current = journal.read()
      if (current.kind != "downloading" && !(current.kind == "paused" && current.reason == "process-interrupted")) return
      if (worker?.isDone == false) return
      val next = if (current.kind == "paused") saveLocked(current.copy(
        kind = "downloading", generation = current.generation + 1, bytes = 0, reason = null,
      )) else current
      val exit = CountDownLatch(1)
      workerExit = exit
      worker = executor.submit {
        val handoff = try { transfer(next.generation) } finally { staleCleanup(next.generation); exit.countDown() }
        if (handoff != null) executor.submit { continueVerifiedUpdate(handoff) }
      }
    }
  }

  fun serviceLimit() {
    synchronized(guard) {
      servicePending = false
      val current = journal.read()
      if (current.kind == "downloading") {
        saveLocked(current.copy(kind = "paused", reason = "service-limit", generation = current.generation + 1))
        transport.cancel(); worker?.cancel(true)
      }
    }
  }

  private fun transfer(generation: Long): VerifiedHandoff? {
    val current = synchronized(guard) { journal.read().takeIf { it.generation == generation && it.kind == "downloading" } } ?: return null
    val release = current.release ?: return null
    var handoff: VerifiedHandoff? = null
    try {
      val manifest = transport.manifest(release) { !isCurrent(generation, "downloading") }
      if (manifest.versionCode <= verifier.installedVersion()) throw UpdateFailureException("version")
      synchronized(guard) {
        val latest = journal.read()
        if (latest.generation != generation || latest.kind != "downloading") return null
        saveLocked(latest.copy(versionCode = manifest.versionCode, minSdk = manifest.minSdk))
      }
      if ((journal.partial.parentFile?.usableSpace ?: 0L) < release.apkBytes + 16L * 1024 * 1024) {
        throw UpdateFailureException("storage")
      }
      journal.partial.delete()
      var lastPublished = 0L
      transport.download(release, journal.partial, { !isCurrent(generation, "downloading") }) { bytes ->
        val now = System.currentTimeMillis()
        if (now - lastPublished >= 200 || bytes == release.apkBytes) {
          synchronized(guard) {
            val latest = journal.read()
            if (latest.generation == generation && latest.kind == "downloading") {
              saveLocked(latest.copy(bytes = bytes))
            }
          }
          lastPublished = now
        }
      }
      synchronized(guard) {
        val latest = journal.read()
        if (latest.generation != generation || latest.kind != "downloading") return null
        saveLocked(latest.copy(kind = "verifying", bytes = release.apkBytes))
      }
      verifier.verify(journal.partial, release, manifest)
      synchronized(guard) {
        val latest = journal.read()
        if (latest.generation != generation || latest.kind != "verifying") return null
        if (journal.verified.exists()) journal.verified.delete()
        if (!journal.partial.renameTo(journal.verified)) throw UpdateFailureException("storage")
        val ready = saveLocked(latest.copy(kind = "ready"))
        val lease = foregroundActivity
        if (lease != null && foreground(lease) != null && ready.operation != null) {
          handoff = VerifiedHandoff(ready.operation, ready.generation, lease)
        }
      }
    } catch (_: UpdateCanceledException) {
      pauseIfCurrent(generation, "network")
    } catch (error: UpdateFailureException) {
      synchronized(guard) {
        val latest = journal.read()
        if (latest.generation == generation) failLocked(latest, error.code, "download")
      }
    } catch (_: IOException) {
      pauseIfCurrent(generation, "network")
    } catch (_: Exception) {
      synchronized(guard) {
        val latest = journal.read()
        if (latest.generation == generation) failLocked(latest, "interrupted", "download")
      }
    } finally {
      context.stopService(Intent(context, UpdaterForegroundService::class.java))
    }
    return handoff
  }

  private fun foreground(lease: WeakReference<Activity>): Activity? {
    if (foregroundActivity !== lease) return null
    return lease.get()?.takeUnless { it.isFinishing || it.isDestroyed }
  }

  private fun rememberActivity(activity: Activity?) {
    if (activity == null) return
    synchronized(guard) {
      if (foregroundActivity?.get() !== activity) foregroundActivity = WeakReference(activity)
    }
  }

  private fun continueVerifiedUpdate(handoff: VerifiedHandoff) {
    synchronized(guard) {
      val current = journal.read()
      val activity = foreground(handoff.activity) ?: return
      if (current.operation != handoff.operation || current.generation != handoff.generation ||
        current.kind != "ready") return
      try { installLocked(current, activity) }
      catch (_: Exception) {
        val latest = journal.read()
        if (latest.operation == handoff.operation && latest.generation == handoff.generation &&
          latest.kind in setOf("ready", "permission-needed")) failLocked(latest, "install-failed", "install")
      }
    }
  }

  private fun stage(generation: Long) {
    val initial = synchronized(guard) { journal.read().takeIf { it.kind == "staging" && it.generation == generation } } ?: return
    val release = initial.release ?: return
    val manifest = UpdateManifest(initial.versionCode, initial.minSdk, "StreamFusion-${release.tag}.apk")
    val installer = context.packageManager.packageInstaller
    var sessionId = -1
    try {
      verifier.verify(journal.verified, release, manifest)
      val parameters = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
        setAppPackageName(context.packageName)
        setAppLabel("StreamFusion update ${initial.operation}")
        setSize(release.apkBytes)
        if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
      }
      sessionId = installer.createSession(parameters)
      synchronized(guard) {
        val latest = journal.read()
        if (latest.generation != generation || latest.kind != "staging") {
          installer.abandonSession(sessionId); return
        }
        saveLocked(latest.copy(sessionId = sessionId))
      }
      installer.openSession(sessionId).use { session ->
        session.openWrite("base.apk", 0, release.apkBytes).use { output ->
          FileInputStream(journal.verified).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              if (!isCurrent(generation, "staging")) throw UpdateCanceledException()
              val read = input.read(buffer)
              if (read < 0) break
              output.write(buffer, 0, read)
            }
          }
          session.fsync(output)
        }
        synchronized(guard) {
          val latest = journal.read()
          if (latest.generation != generation || latest.kind != "staging") throw UpdateCanceledException()
          val intent = Intent(context, UpdateInstallReceiver::class.java).apply {
            action = "expo.modules.streamfusionnativecontracts.INSTALL_RESULT"
            data = Uri.parse("streamfusion-update://session/$sessionId")
            putExtra("sessionId", sessionId)
          }
          val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
          val callback = PendingIntent.getBroadcast(context, sessionId, intent, flags)
          saveLocked(latest.copy(kind = "awaiting-approval", stageAt = System.currentTimeMillis()))
          session.commit(callback.intentSender)
        }
      }
    } catch (_: UpdateCanceledException) {
      if (sessionId >= 0) try { installer.abandonSession(sessionId) } catch (_: Exception) { }
    } catch (error: UpdateFailureException) {
      if (sessionId >= 0) try { installer.abandonSession(sessionId) } catch (_: Exception) { }
      synchronized(guard) {
        val latest = journal.read()
        if (latest.generation == generation) failLocked(latest, error.code, if (error.code in setOf("checksum", "signature", "package", "version", "sdk")) "download" else "install")
      }
    } catch (_: Exception) {
      if (sessionId >= 0) try { installer.abandonSession(sessionId) } catch (_: Exception) { }
      synchronized(guard) {
        val latest = journal.read()
        if (latest.generation == generation) failLocked(latest, "install-failed", "install")
      }
    }
  }

  fun onInstallResult(sessionId: Int, status: Int, approval: Intent?) {
    synchronized(guard) {
      val current = journal.read()
      if (current.sessionId != sessionId || current.kind !in setOf("awaiting-approval", "staging")) return
      when (status) {
        PackageInstaller.STATUS_PENDING_USER_ACTION -> {
          saveLocked(current.copy(kind = "awaiting-approval"))
          if (approval != null) {
            val pending = showConsentNotification(sessionId, approval)
            val lease = foregroundActivity
            val activity = lease?.let(::foreground)
            if (lease != null && activity != null) activity.runOnUiThread {
              synchronized(guard) {
                val latest = journal.read()
                if (foreground(lease) == null || latest.sessionId != sessionId ||
                  latest.generation != current.generation || latest.kind != "awaiting-approval") return@synchronized
                try { pending.send() }
                catch (_: Exception) { failLocked(latest, "install-failed", "install") }
              }
            }
          } else failLocked(current, "install-failed", "install")
        }
        PackageInstaller.STATUS_SUCCESS -> {
          clearConsentNotification()
          val target = current.versionCode
          if (target > 0 && verifier.installedVersion() >= target) {
            saveLocked(current.copy(kind = "installed", installIntent = false, sessionId = -1))
            journal.partial.delete(); journal.verified.delete()
          }
        }
        else -> {
          clearConsentNotification()
          failLocked(current, if (status == PackageInstaller.STATUS_FAILURE_BLOCKED ||
            status == PackageInstaller.STATUS_FAILURE_ABORTED) "install-blocked" else "install-failed", "install")
        }
      }
    }
  }

  private fun reconcileLocked(): UpdateRecord {
    var current = journal.read()
    if (current.kind == "unsupported" || current.kind == "idle" || current.release == null) return current
    if (current.versionCode > 0 && current.kind !in setOf("downloading", "paused", "verifying", "failed", "canceled") &&
      verifier.installedVersion() >= current.versionCode) {
      if (current.kind != "installed") current = saveLocked(current.copy(kind = "installed", sessionId = -1))
      journal.partial.delete(); journal.verified.delete()
      return current
    }
    if (current.kind == "downloading" && !servicePending && worker?.isDone != false) {
      current = saveLocked(current.copy(kind = "paused", reason = "process-interrupted", bytes = journal.partial.length()))
    }
    if (current.kind == "staging" && worker?.isDone != false) {
      abandonOrphanSessionsLocked(current)
      abandonLocked(current)
      current = failLocked(current, "interrupted", "install")
    }
    if (firstReconciliation && current.kind in setOf("failed", "canceled")) {
      abandonOrphanSessionsLocked(current)
    }
    if (firstReconciliation && (current.kind == "ready" || current.kind == "permission-needed")) {
      val release = current.release ?: return current
      try { verifier.verify(journal.verified, release, UpdateManifest(
        current.versionCode, current.minSdk, "StreamFusion-${release.tag}.apk")) }
      catch (error: UpdateFailureException) { current = failLocked(current, error.code, "download") }
    }
    firstReconciliation = false
    if (current.kind == "awaiting-approval" && current.sessionId >= 0 &&
      System.currentTimeMillis() - current.stageAt > 30_000 &&
      context.packageManager.packageInstaller.mySessions.none { it.sessionId == current.sessionId }) {
      current = failLocked(current, "interrupted", "install")
    }
    return current
  }

  private fun pauseIfCurrent(generation: Long, reason: String) {
    synchronized(guard) {
      val current = journal.read()
      if (current.generation == generation && current.kind == "downloading") {
        saveLocked(current.copy(kind = "paused", reason = reason, bytes = journal.partial.length()))
      }
    }
  }

  private fun staleCleanup(generation: Long) {
    synchronized(guard) {
      val current = journal.read()
      if (current.generation != generation && current.kind == "canceled") {
        journal.partial.delete(); journal.verified.delete()
      }
    }
  }

  private fun isCurrent(generation: Long, kind: String): Boolean = synchronized(guard) {
    val current = journal.read()
    current.generation == generation && current.kind == kind
  }

  private fun failLocked(current: UpdateRecord, code: String, retry: String): UpdateRecord =
    saveLocked(current.copy(kind = "failed", code = code, retry = retry, installIntent = false))

  private fun saveLocked(record: UpdateRecord): UpdateRecord {
    val next = journal.write(record.copy(revision = record.revision + 1))
    listeners.forEach { listener -> try { listener(next.revision) } catch (_: Exception) { } }
    return next
  }

  private fun startServiceLocked(record: UpdateRecord) {
    val intent = Intent(context, UpdaterForegroundService::class.java).putExtra("generation", record.generation)
    servicePending = true
    try {
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    } catch (_: RuntimeException) {
      servicePending = false
      saveLocked(record.copy(kind = "paused", reason = "service-limit"))
    }
  }

  private fun consentPendingIntent(sessionId: Int, approval: Intent?, flags: Int): PendingIntent? {
    if (sessionId < 0) return null
    val launch = Intent(context, UpdateConsentActivity::class.java).apply {
      if (approval != null) putExtra("approval", approval)
      data = Uri.parse("streamfusion-update://consent/$sessionId")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return PendingIntent.getActivity(context, sessionId, launch, flags or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun showConsentNotification(sessionId: Int, approval: Intent): PendingIntent {
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
      NotificationChannel(CONSENT_CHANNEL, "Install update", NotificationManager.IMPORTANCE_HIGH),
    )
    val pending = requireNotNull(consentPendingIntent(sessionId, approval, PendingIntent.FLAG_UPDATE_CURRENT))
    try { manager.notify(CONSENT_NOTIFICATION, Notification.Builder(context, CONSENT_CHANNEL)
      .setContentTitle("Finish installing StreamFusion")
      .setContentText("Approve the downloaded update")
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentIntent(pending).setAutoCancel(false).build()) }
    catch (_: SecurityException) { }
    return pending
  }

  private fun clearConsentNotification() {
    context.getSystemService(NotificationManager::class.java).cancel(CONSENT_NOTIFICATION)
  }

  private fun abandonLocked(record: UpdateRecord) {
    if (record.sessionId >= 0 && record.kind != "awaiting-approval") {
      try { context.packageManager.packageInstaller.abandonSession(record.sessionId) } catch (_: Exception) { }
    }
  }

  private fun abandonOrphanSessionsLocked(record: UpdateRecord) {
    val operation = record.operation ?: return
    val installer = context.packageManager.packageInstaller
    for (session in installer.mySessions) {
      if (session.sessionId == record.sessionId ||
        session.appPackageName != context.packageName ||
        session.appLabel?.toString() != "StreamFusion update $operation" ||
        session.createdMillis < record.stageAt
      ) continue
      try { installer.abandonSession(session.sessionId) } catch (_: Exception) { }
    }
  }

  companion object {
    private val ACTIVE_KINDS = setOf("downloading", "paused", "verifying", "ready", "permission-needed", "staging", "awaiting-approval")
    private val TERMINAL_KINDS = setOf("idle", "installed", "canceled", "failed", "unsupported")
    private const val CONSENT_CHANNEL = "streamfusion-update-consent"
    private const val CONSENT_NOTIFICATION = 16310
    @Volatile private var singleton: UpdaterEngine? = null
    fun get(context: Context): UpdaterEngine = singleton ?: synchronized(this) {
      singleton ?: UpdaterEngine(context.applicationContext, GitHubReleaseTransport(),
        UpdateVerifier(context.applicationContext), UpdateJournal(context.applicationContext)).also { singleton = it }
    }
  }
}
