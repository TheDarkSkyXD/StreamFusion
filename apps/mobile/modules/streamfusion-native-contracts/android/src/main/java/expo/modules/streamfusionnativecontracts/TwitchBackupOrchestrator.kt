package expo.modules.streamfusionnativecontracts

import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import kotlin.math.min
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal class TwitchBackupOrchestrator(
  sourceUri: String,
  requestedChannel: String?,
  private val transport: TwitchBackupTransport = TwitchBackupHttp(),
  private val executor: ExecutorService = Executors.newSingleThreadExecutor(),
  private val now: () -> Long = System::currentTimeMillis,
) {
  private enum class OutputSource { ORIGINAL, BACKUP }

  private data class Backup(
    val playerType: String,
    val rendition: TwitchRendition,
    val playlist: String,
    val fetchedAt: Long,
    val sequenceOffset: Long = 0,
    val discontinuityOffset: Long = 0,
  )

  private class RenditionState {
    var candidate: Backup? = null
    var served: Backup? = null
    var searching = false
    var refreshing = false
    var misses = 0
    var nextRetryAt = 0L
    var cleanPolls = 0
    var cleanSince: Long? = null
    var lastCleanEnd: Long? = null
    var preloaded = false
    var outputEnd: Long? = null
    var outputDiscontinuity = 0L
    var outputSource = OutputSource.ORIGINAL
    var originalSequenceOffset = 0L
    var originalDiscontinuityOffset = 0L
  }

  private val playerTypes = listOf("embed", "popout", "autoplay", "picture-by-picture", "thunderdome")
  private val channel = (requestedChannel?.takeIf { it.matches(Regex("[A-Za-z0-9_]{1,25}")) }
    ?: TwitchBackupPlaylist.channelFromUsher(sourceUri))?.lowercase(Locale.US)
  private val originalUsher = sourceUri.takeIf { TwitchBackupPlaylist.channelFromUsher(it) != null }
  private val renditions = mutableMapOf<String, TwitchRendition>()
  private val states = mutableMapOf<String, RenditionState>()
  private val masters = mutableMapOf<String, Pair<Long, List<TwitchRendition>>>()
  @Volatile private var disposed = false

  @Synchronized
  fun process(uri: String, playlist: String): PlaybackPlaylistFilter.Result {
    if (disposed) return PlaybackPlaylistFilter.rewrite(playlist, "strip")
    if (TwitchBackupPlaylist.isMaster(playlist)) {
      renditions.clear()
      TwitchBackupPlaylist.renditions(playlist, uri).forEach { renditions[it.url] = it }
      return PlaybackPlaylistFilter.Result(false, false, "Twitch master playlist observed.", playlist)
    }
    val marked = PlaybackPlaylistFilter.hasAds(playlist)
    val target = renditions[uri]
    val scope = target?.let { "${it.resolution}:${it.frameRate}:${it.codecs}" } ?: uri
    val state = states.getOrPut(scope) { RenditionState() }
    val moment = now()
    if (!marked) {
      if (state.outputSource == OutputSource.BACKUP) {
        state.cleanSince = state.cleanSince ?: moment
        state.cleanPolls++
        if (state.cleanPolls < 2 || moment - state.cleanSince!! < 20_000) {
          val backup = playableBackup(state, moment)
          if (backup != null) {
            scheduleRefresh(state)
            return backed(state, backup, false, "Waiting for stable clean Twitch media.")
          }
          scheduleRefresh(state)
          return held(playlist, false, "Waiting for a fresh backup before original recovery.")
        }
        state.served = null
        state.candidate = null
        state.originalSequenceOffset = (state.outputEnd ?: 0) - (TwitchBackupPlaylist.sequence(playlist) ?: 0)
        state.originalDiscontinuityOffset = state.outputDiscontinuity + 1 - TwitchBackupPlaylist.discontinuitySequence(playlist)
        state.outputSource = OutputSource.ORIGINAL
      } else if (channel != null && !state.preloaded) {
        state.preloaded = true
        scheduleSearch(state, target)
      }
      state.lastCleanEnd = TwitchBackupPlaylist.endSequence(playlist)
      state.cleanPolls = 0
      state.cleanSince = null
      val output = if (
        state.outputSource == OutputSource.ORIGINAL &&
        state.originalSequenceOffset == 0L &&
        state.originalDiscontinuityOffset == 0L
      ) playlist else TwitchBackupPlaylist.rebase(
        playlist,
        state.originalSequenceOffset,
        state.originalDiscontinuityOffset,
      ) ?: playlist
      recordOutput(state, output)
      return PlaybackPlaylistFilter.Result(false, output != playlist, "No Twitch ad markers in this playlist.", output)
    }

    state.cleanPolls = 0
    state.cleanSince = null
    val candidate = state.candidate
    if (candidate != null && moment - candidate.fetchedAt <= 8_000) {
      val start = state.outputEnd ?: state.lastCleanEnd ?: TwitchBackupPlaylist.sequence(playlist)
      val candidateSequence = TwitchBackupPlaylist.sequence(candidate.playlist)
      if (start != null && candidateSequence != null) {
        val discontinuityOffset = state.outputDiscontinuity + 1 -
          TwitchBackupPlaylist.discontinuitySequence(candidate.playlist)
        state.served = candidate.copy(
          sequenceOffset = start - candidateSequence,
          discontinuityOffset = discontinuityOffset,
        )
        state.outputSource = OutputSource.BACKUP
      }
      state.candidate = null
    }
    val backup = playableBackup(state, moment)
    if (backup != null) {
      scheduleRefresh(state)
      return backed(state, backup, true, "Ads detected; using verified clean Twitch backup (${backup.playerType}).")
    }
    state.served = null
    scheduleSearch(state, target)
    return held(playlist, true, "Ads detected; held unsafe media while searching for a clean backup.")
  }

  @Synchronized
  fun dispose() {
    if (disposed) return
    disposed = true
    states.clear()
    renditions.clear()
    masters.clear()
    executor.shutdownNow()
    transport.cancel()
  }

  private fun playableBackup(state: RenditionState, moment: Long): Backup? {
    val backup = state.served ?: return null
    return backup.takeIf { moment - it.fetchedAt <= 12_000 }
  }

  private fun backed(state: RenditionState, backup: Backup, ad: Boolean, diagnostic: String): PlaybackPlaylistFilter.Result {
    val output = TwitchBackupPlaylist.rebase(
      backup.playlist,
      backup.sequenceOffset,
      backup.discontinuityOffset,
    ) ?: return held(backup.playlist, ad, "Verified backup could not be aligned; holding media.")
    recordOutput(state, output)
    return PlaybackPlaylistFilter.Result(ad, true, diagnostic, output)
  }

  private fun recordOutput(state: RenditionState, playlist: String) {
    state.outputEnd = TwitchBackupPlaylist.endSequence(playlist)
    state.outputDiscontinuity = TwitchBackupPlaylist.endDiscontinuitySequence(playlist)
  }

  private fun held(playlist: String, ad: Boolean, diagnostic: String) =
    PlaybackPlaylistFilter.Result(ad, true, diagnostic, PlaybackPlaylistFilter.holdUnsafeMediaPlaylist(playlist))

  private fun scheduleSearch(state: RenditionState, target: TwitchRendition?) {
    if (channel == null || state.searching || disposed || now() < state.nextRetryAt) return
    state.searching = true
    try {
      executor.execute {
        if (disposed) return@execute
        val found = runCatching { findBackup(target) }.getOrNull()
        synchronized(this) {
          if (disposed) return@synchronized
          state.searching = false
          if (found != null) {
            state.candidate = found
            state.misses = 0
            state.nextRetryAt = 0
          } else {
            state.misses++
            state.nextRetryAt = now() + min(2_000L shl min(state.misses - 1, 3), 10_000L)
          }
        }
      }
    } catch (_: RejectedExecutionException) {
      state.searching = false
    }
  }

  private fun findBackup(target: TwitchRendition?): Backup? {
    val login = channel ?: return null
    val deferred = mutableListOf<Pair<String, TwitchRendition>>()
    for (playerType in playerTypes) {
      if (Thread.currentThread().isInterrupted) return null
      val candidates = loadMaster(login, playerType)
      val ranked = TwitchBackupPlaylist.ranked(candidates, target)
      val exact = ranked.filter { target == null || it.resolution == target.resolution }
      for (rendition in exact) {
        val prepared = inspect(playerType, rendition)
        if (prepared != null) return prepared
      }
      deferred.addAll(ranked.filterNot { it in exact }.map { playerType to it })
    }
    for ((playerType, rendition) in deferred) {
      val prepared = inspect(playerType, rendition)
      if (prepared != null) return prepared
    }
    return null
  }

  private fun loadMaster(login: String, playerType: String): List<TwitchRendition> {
    synchronized(this) {
      val cached = masters[playerType]
      if (cached != null && now() - cached.first < 15_000) return cached.second
    }
    val token = transport.token(login, playerType) ?: return emptyList()
    val masterUrl = usherUrl(login, token) ?: return emptyList()
    val master = transport.text(masterUrl) ?: return emptyList()
    val parsed = TwitchBackupPlaylist.renditions(master, masterUrl)
    synchronized(this) { if (!disposed) masters[playerType] = now() to parsed }
    return parsed
  }

  private fun inspect(playerType: String, rendition: TwitchRendition): Backup? {
    if (Thread.currentThread().isInterrupted) return null
    val playlist = transport.text(rendition.url) ?: return null
    if (PlaybackPlaylistFilter.hasAds(playlist) || !TwitchBackupPlaylist.hasPlayableSegment(playlist)) return null
    val absolute = TwitchBackupPlaylist.absoluteMedia(playlist, rendition.url) ?: return null
    if (TwitchBackupPlaylist.sequence(absolute) == null) return null
    return Backup(playerType, rendition, absolute, now())
  }

  private fun scheduleRefresh(state: RenditionState) {
    val served = state.served ?: return
    if (state.refreshing || disposed || now() - served.fetchedAt < 2_000) return
    state.refreshing = true
    try {
      executor.execute {
        if (disposed) return@execute
        val refreshed = runCatching {
          transport.text(served.rendition.url)
            ?.takeIf { !PlaybackPlaylistFilter.hasAds(it) && TwitchBackupPlaylist.hasPlayableSegment(it) }
            ?.let { TwitchBackupPlaylist.absoluteMedia(it, served.rendition.url) }
        }.getOrNull()
        synchronized(this) {
          if (disposed) return@synchronized
          state.refreshing = false
          if (state.served !== served) return@synchronized
          if (refreshed == null) {
            state.served = null
            state.nextRetryAt = 0
          } else if (TwitchBackupPlaylist.aligned(served.playlist, refreshed)) {
            state.served = served.copy(playlist = refreshed, fetchedAt = now())
          } else {
            state.served = null
            state.nextRetryAt = 0
          }
        }
      }
    } catch (_: RejectedExecutionException) {
      state.refreshing = false
    }
  }

  private fun usherUrl(login: String, token: Pair<String, String>): String? {
    val base = originalUsher?.toHttpUrlOrNull()?.newBuilder()
      ?: "https://usher.ttvnw.net/api/channel/hls/$login.m3u8".toHttpUrlOrNull()?.newBuilder()
      ?: return null
    base.removeAllQueryParameters("parent_domains")
    base.removeAllQueryParameters("referrer")
    base.setQueryParameter("sig", token.first)
    base.setQueryParameter("token", token.second)
    base.setQueryParameter("allow_source", "true")
    base.setQueryParameter("allow_audio_only", "true")
    base.setQueryParameter("playlist_include_framerate", "true")
    return base.build().toString()
  }
}
