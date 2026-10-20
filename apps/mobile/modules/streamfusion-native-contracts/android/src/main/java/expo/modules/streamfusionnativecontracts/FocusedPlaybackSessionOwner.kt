package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistTracker
import androidx.media3.exoplayer.mediacodec.MediaCodecDecoderException
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.ui.PlayerView
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicReference

object FocusedPlaybackSessionOwner {
  private val SESSION_ID = Regex("^[a-zA-Z0-9._:-]{1,256}$")
  private val lock = Any()
  private val main = Handler(Looper.getMainLooper())
  private val views = mutableSetOf<StreamFusionPlaybackView>()
  private val sessions = LinkedHashMap<String, Session>()
  private var nextInterruptionId = 1
  private var emit: ((Map<String, Any>) -> Unit)? = null
  private var pictureInPictureActive = false
  private var pictureInPictureRequested = false
  private var pictureInPictureSessionId: String? = null
  private var applicationContext: Context? = null
  private var hostActivity: WeakReference<Activity>? = null
  private var observedActivity: ComponentActivity? = null
  private var pipView: PlayerView? = null
  private val pipModeListener = androidx.core.util.Consumer<androidx.core.app.PictureInPictureModeChangedInfo> { info ->
    onPictureInPictureChanged(info.isInPictureInPictureMode)
  }
  private val lifecycleObserver: LifecycleEventObserver = LifecycleEventObserver { _, event ->
    if (event == Lifecycle.Event.ON_STOP) onActivityStopped()
    if (event == Lifecycle.Event.ON_DESTROY) {
      observedActivity?.removeOnPictureInPictureModeChangedListener(pipModeListener)
      observedActivity?.lifecycle?.removeObserver(lifecycleObserver)
      observedActivity = null
      hostActivity = null
      removePipView()
    }
  }
  private val progressTicker = object : Runnable {
    override fun run() {
      val snapshot = synchronized(lock) { sessions.values.map { it.sessionId to it.player } }
      if (snapshot.isEmpty()) return
      snapshot.forEach { (sessionId, exo) -> publish(progressEvent(sessionId, exo)) }
      main.postDelayed(this, 500)
    }
  }

  fun attachEmitter(next: (Map<String, Any>) -> Unit) {
    synchronized(lock) { emit = next }
  }

  fun rememberActivity(activity: Activity?) {
    if (activity == null) return
    onMain {
      synchronized(lock) { hostActivity = WeakReference(activity) }
      if (activity is ComponentActivity && observedActivity !== activity) {
        observedActivity?.removeOnPictureInPictureModeChangedListener(pipModeListener)
        observedActivity?.lifecycle?.removeObserver(lifecycleObserver)
        observedActivity = activity
        activity.addOnPictureInPictureModeChangedListener(pipModeListener)
        activity.lifecycle.addObserver(lifecycleObserver)
      }
      disableSystemAutoEnter(activity)
    }
  }

  fun start(context: Context, request: Map<String, Any>): Map<String, Any> = onMain {
    val sessionId = request["sessionId"] as? String
    val sourceUri = request["sourceUri"] as? String
    if (sessionId.isNullOrBlank() || !SESSION_ID.matches(sessionId)) {
      return@onMain mapOf("kind" to "invalid")
    }
    if (sourceUri.isNullOrBlank() || !isHttpsMedia(sourceUri)) {
      return@onMain mapOf("kind" to "invalid")
    }
    val quarantine = TwitchAdMediaQuarantine()
    val source = playbackSource(sessionId, sourceUri, request, request, quarantine)
    val exo = ExoPlayer.Builder(context.applicationContext)
      .setMediaSourceFactory(source.factory)
      .setRenderersFactory(captionRenderers(context.applicationContext, sessionId))
      .setLoadControl(PlaybackPreferenceConfig.loadControl(request))
      .setTrackSelector(
        PlaybackPreferenceConfig.trackSelector(context.applicationContext, request),
      )
      .build()
    val initiallyMuted = request["muted"] == true
    if (initiallyMuted) exo.volume = 0f
    exo.addListener(SessionListener(sessionId, exo))
    exo.setMediaItem(source.mediaItem)
    val previous = synchronized(lock) {
      applicationContext = context.applicationContext
      if (context is Activity) {
        hostActivity = WeakReference(context)
      }
      val outgoing = sessions.remove(sessionId)
      sessions[sessionId] = Session(
        sessionId, exo, source.filteringFactory, request, quarantine,
        sourceRecovery = request["sourceRecovery"] == "resolve-live-source",
      ).also { it.muted = initiallyMuted }
      bindViewsLocked()
      outgoing
    }
    previous?.dispose()
    exo.prepare()
    exo.playWhenReady = true
    updateScreenAwakeRequests()
    startProgressTicker()
    sessionCompleted(context, sessionId)
  }

  fun end(sessionId: String): Map<String, Any> = onMain {
    if (!disposeSession(sessionId)) return@onMain missing(sessionId)
    mapOf(
      "kind" to "completed",
      "value" to mapOf(
        "kind" to "ended",
        "state" to mapOf(
          "pictureInPictureEligible" to pipEligible(null),
          "sessionId" to sessionId,
        ),
      ),
    )
  }

  fun recoverSource(request: Map<String, Any>): Map<String, Any> = onMain {
    val sessionId = request["sessionId"] as? String
    if (sessionId.isNullOrBlank() || !SESSION_ID.matches(sessionId)) return@onMain mapOf("kind" to "invalid")
    val interruptionId = (request["interruptionId"] as? Number)?.toDouble()
      ?.takeIf { it > 0 && it <= Int.MAX_VALUE && it.isFinite() && it % 1.0 == 0.0 }?.toInt()
      ?: return@onMain mapOf("kind" to "invalid")
    val sourceUri = request["sourceUri"] as? String
    if (sourceUri.isNullOrBlank() || !isHttpsMedia(sourceUri)) return@onMain mapOf("kind" to "invalid")
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    val interruption = current.interruption
    if (interruption?.id != interruptionId || interruption.phase != RecoveryPhase.WAITING) {
      return@onMain mapOf("kind" to "invalid")
    }
    val source = playbackSource(sessionId, sourceUri, request, current.startRequest, current.quarantine)
    val outgoingFactory = current.filteringFactory
    current.filteringFactory = source.filteringFactory
    current.interruption = interruption.copy(phase = RecoveryPhase.PREPARING)
    current.player.setMediaSource(source.mediaSource)
    outgoingFactory?.dispose()
    current.player.prepare()
    updateScreenAwakeRequests()
    sessionCompleted(null, sessionId)
  }

  fun setPlaying(sessionId: String, playing: Boolean): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    current.player.playWhenReady = playing
    updateScreenAwakeRequests()
    sessionCompleted(null, sessionId)
  }

  fun setMuted(sessionId: String, nextMuted: Boolean): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    if (nextMuted && !current.muted) {
      current.volumeBeforeMute = current.player.volume
    }
    current.muted = nextMuted
    current.player.volume = if (nextMuted) 0f else current.volumeBeforeMute
    sessionCompleted(null, sessionId)
  }

  fun setVolume(sessionId: String, volume: Float): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    val clamped = volume.coerceIn(0f, 1f)
    current.volumeBeforeMute = clamped
    if (!current.muted) {
      current.player.volume = clamped
    }
    sessionCompleted(null, sessionId)
  }

  fun readObservation(sessionId: String): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    observationCompleted(current)
  }

  fun setSpeed(sessionId: String, speed: Float): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    if (current.player.isCurrentMediaItemLive || speed !in listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)) {
      return@onMain unsupported("Playback speed is available for recorded media only.")
    }
    current.player.setPlaybackSpeed(speed)
    observationCompleted(current)
  }

  private fun observationCompleted(current: Session): Map<String, Any> {
    val player = current.player
    val format = player.videoFormat
    val counters = player.videoDecoderCounters
    counters?.ensureUpdated()
    return mapOf("kind" to "completed", "value" to mapOf(
      "sessionId" to current.sessionId,
      "speed" to player.playbackParameters.speed.toDouble(),
      "bufferedMs" to player.totalBufferedDuration.coerceAtLeast(0L).toDouble(),
      "width" to format?.width?.takeIf { it > 0 },
      "height" to format?.height?.takeIf { it > 0 },
      "frameRate" to format?.frameRate?.takeIf { it > 0 },
      "bitrate" to format?.bitrate?.takeIf { it > 0 },
      "codec" to (format?.codecs ?: format?.sampleMimeType),
      "droppedFrames" to counters?.droppedBufferCount,
      "renderedFrames" to counters?.renderedOutputBufferCount
    ))
  }

  fun listQualities(sessionId: String): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    qualityCompleted(current)
  }

  fun setQuality(sessionId: String, quality: String): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    if (quality == "auto") {
      current.player.trackSelectionParameters = current.player.trackSelectionParameters
        .buildUpon()
        .clearVideoSizeConstraints()
        .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
        .setForceHighestSupportedBitrate(false)
        .build()
      current.selectedQuality = "auto"
      current.resolvedHighestQuality = null
      return@onMain qualityCompleted(current)
    }
    if (quality == "highest") {
      current.player.trackSelectionParameters = current.player.trackSelectionParameters
        .buildUpon()
        .clearVideoSizeConstraints()
        .setForceHighestSupportedBitrate(true)
        .build()
      current.selectedQuality = "highest"
      current.resolvedHighestQuality = highestSelectedQuality(current.player.currentTracks)
      applyHighestQuality(current, current.player.currentTracks)
      return@onMain qualityCompleted(current)
    }
    val height = quality.removeSuffix("p").toIntOrNull()
      ?: return@onMain mapOf("kind" to "invalid")
    current.player.trackSelectionParameters = current.player.trackSelectionParameters
      .buildUpon()
      .setMaxVideoSize(Int.MAX_VALUE, height)
      .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
      .setForceHighestSupportedBitrate(false)
      .build()
    current.selectedQuality = quality
    current.resolvedHighestQuality = null
    qualityCompleted(current)
  }

  fun seekTo(sessionId: String, positionMs: Double): Map<String, Any> = onMain {
    val current = requireSession(sessionId) ?: return@onMain missing(sessionId)
    val duration = current.player.duration
    if (
      !current.player.isCurrentMediaItemSeekable ||
      duration <= 0L ||
      duration == C.TIME_UNSET
    ) {
      return@onMain unsupported("Seeking is not available for this live session.")
    }
    current.player.seekTo(positionMs.toLong().coerceIn(0L, duration))
    publish(progressEvent(sessionId, current.player))
    sessionCompleted(null, sessionId)
  }

  fun enterPictureInPicture(activity: Activity?, sessionId: String): Map<String, Any> = onMain {
    val session = requireSession(sessionId) ?: return@onMain missing(sessionId)
    val host = resolveHost(activity)
    if (host == null) {
      return@onMain unsupported("Picture in Picture needs the current Activity.")
    }
    if (!pipEligible(host)) {
      return@onMain unsupported("Picture in Picture is not available on this device.")
    }
    if (!canEnterPip(session)) {
      return@onMain unsupported("Picture in Picture needs a playing video.")
    }
    pictureInPictureRequested = true
    pictureInPictureSessionId = sessionId
    attachPipView(host, session)
    val entered = try {
      host.enterPictureInPictureMode(pipParams())
    } catch (_: IllegalStateException) {
      pictureInPictureRequested = false
      pictureInPictureSessionId = null
      removePipView()
      return@onMain unsupported("Picture in Picture could not start from this screen.")
    }
    if (!entered) {
      pictureInPictureRequested = false
      pictureInPictureSessionId = null
      removePipView()
      return@onMain unsupported("The system refused Picture in Picture.")
    }
    sessionCompleted(host, sessionId)
  }

  fun onUserLeavesActivity(activity: Activity?) = onMain {
    val host = resolveHost(activity) ?: return@onMain
    if (pictureInPictureActive || pictureInPictureRequested || !pipEligible(host)) return@onMain
    val session = synchronized(lock) {
      sessions.values.lastOrNull { !it.muted && it.player.volume > 0f && canEnterPip(it) }
        ?: sessions.values.singleOrNull()?.takeIf { canEnterPip(it) }
    } ?: return@onMain
    if (!canEnterPip(session)) return@onMain
    pictureInPictureRequested = true
    pictureInPictureSessionId = session.sessionId
    attachPipView(host, session)
    val entered = try {
      host.enterPictureInPictureMode(pipParams())
    } catch (_: IllegalStateException) {
      false
    }
    if (!entered) {
      pictureInPictureRequested = false
      pictureInPictureSessionId = null
      removePipView()
    }
  }

  fun pauseForBackground() = onMain {
    val players = synchronized(lock) {
      val pipSessionId = pictureInPictureSessionId.takeIf {
        pictureInPictureRequested || pictureInPictureActive
      }
      sessions.values.filter { it.sessionId != pipSessionId }.map { it.player }
    }
    players.forEach { it.playWhenReady = false }
    updateScreenAwakeRequests()
  }

  fun onForeground(activity: Activity?) = onMain {
    val inPip = activity?.isInPictureInPictureMode == true
    if (inPip) {
      synchronized(lock) { pictureInPictureActive = true }
      return@onMain
    }
    onPictureInPictureChanged(false)
  }

  fun release() = onMain {
    val outgoing = synchronized(lock) {
      views.forEach { it.detachPlayer() }
      val players = sessions.values.toList()
      sessions.clear()
      applicationContext = null
      pictureInPictureActive = false
      pictureInPictureRequested = false
      pictureInPictureSessionId = null
      players
    }
    disableSystemAutoEnter(resolveHost(null))
    removePipView()
    observedActivity?.removeOnPictureInPictureModeChangedListener(pipModeListener)
    observedActivity?.lifecycle?.removeObserver(lifecycleObserver)
    observedActivity = null
    outgoing.forEach { it.dispose() }
    stopProgressTicker()
  }

  fun register(view: StreamFusionPlaybackView) = onMain {
    synchronized(lock) {
      views.add(view)
      bindViewsLocked()
    }
  }

  fun unregister(view: StreamFusionPlaybackView) = onMain {
    synchronized(lock) {
      views.remove(view)
      view.detachPlayer()
    }
  }

  fun bindIfMatches(view: StreamFusionPlaybackView, sessionId: String?) = onMain {
    synchronized(lock) {
      val session = if (pictureInPictureRequested || pictureInPictureActive) null else sessionId?.let(sessions::get)
      if (session != null) {
        view.attachPlayer(session.player)
        view.keepScreenOn = view.isAttachedToWindow && shouldKeepScreenAwake(session)
      } else {
        view.detachPlayer()
      }
    }
  }

  private fun bindViewsLocked() {
    views.forEach { view ->
      val session = if (pictureInPictureRequested || pictureInPictureActive) null else view.boundSessionId()?.let(sessions::get)
      if (session != null) {
        view.attachPlayer(session.player)
        view.keepScreenOn = view.isAttachedToWindow && shouldKeepScreenAwake(session)
      } else {
        view.detachPlayer()
      }
    }
  }

  private fun shouldKeepScreenAwake(session: Session): Boolean {
    val player = session.player
    return player.playWhenReady && (
      session.interruption != null ||
        (player.playerError == null &&
          (player.playbackState == Player.STATE_BUFFERING || player.playbackState == Player.STATE_READY))
      )
  }

  private fun updateScreenAwakeRequests() {
    synchronized(lock) {
      views.forEach { view ->
        val session = view.boundSessionId()?.let(sessions::get)
        view.keepScreenOn = view.isAttachedToWindow &&
          !pictureInPictureRequested && !pictureInPictureActive &&
          session != null && shouldKeepScreenAwake(session)
      }
      pipView?.keepScreenOn = pictureInPictureSessionId?.let(sessions::get)
        ?.let(::shouldKeepScreenAwake) == true
    }
  }

  private fun canEnterPip(session: Session): Boolean = FocusedPipPolicy.canEnter(
    hasSession = synchronized(lock) {
      sessions[session.sessionId] === session &&
        (views.any { it.boundSessionId() == session.sessionId && it.isAttachedToWindow } || pipView != null)
    },
    playWhenReady = session.player.playWhenReady,
    playbackState = session.player.playbackState,
    hasFailure = session.player.playerError != null,
  )

  private fun pipParams(): PictureInPictureParams {
    val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setAutoEnterEnabled(false)
    return builder.build()
  }

  private fun disableSystemAutoEnter(activity: Activity?) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || activity == null || !pipEligible(activity)) return
    activity.setPictureInPictureParams(pipParams())
  }

  private fun attachPipView(activity: Activity, session: Session) {
    val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
    views.forEach { it.detachPlayer() }
    removePipView()
    val view = PlayerView(activity).apply {
      useController = false
      layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      player = session.player
      keepScreenOn = shouldKeepScreenAwake(session)
    }
    content.addView(view)
    pipView = view
  }

  private fun removePipView() {
    pipView?.let { view ->
      view.keepScreenOn = false
      view.player = null
      (view.parent as? ViewGroup)?.removeView(view)
    }
    pipView = null
    synchronized(lock) { bindViewsLocked() }
  }

  private fun onPictureInPictureChanged(entered: Boolean) {
    if (entered) {
      val host = resolveHost(null)
      val session = pictureInPictureSessionId?.let(::requireSession)
        ?: synchronized(lock) { sessions.values.lastOrNull() }?.takeIf(::canEnterPip)
        ?: return
      if (pipView == null && host != null) attachPipView(host, session)
      val sessionId = session.sessionId
      pictureInPictureSessionId = sessionId
      pictureInPictureRequested = false
      pictureInPictureActive = true
      publish(mapOf("kind" to "picture-in-picture-entered", "sessionId" to sessionId))
      return
    }
    val wasActive = pictureInPictureActive
    val sessionId = pictureInPictureSessionId
    pictureInPictureRequested = false
    pictureInPictureActive = false
    pictureInPictureSessionId = null
    removePipView()
    if (wasActive && sessionId != null) {
      publish(mapOf("kind" to "picture-in-picture-exited", "sessionId" to sessionId))
    }
  }

  private fun onActivityStopped() {
    onPictureInPictureChanged(false)
    pauseForBackground()
  }

  private fun requireSession(sessionId: String): Session? = synchronized(lock) {
    sessions[sessionId]
  }

  private fun disposeSession(sessionId: String, expectedPlayer: ExoPlayer? = null): Boolean {
    val outgoing = synchronized(lock) {
      val current = sessions[sessionId] ?: return false
      if (expectedPlayer != null && current.player !== expectedPlayer) return false
      sessions.remove(sessionId)
      if (pictureInPictureSessionId == sessionId) {
        pictureInPictureActive = false
        pictureInPictureRequested = false
        pictureInPictureSessionId = null
      }
      bindViewsLocked()
      current
    }
    outgoing.dispose()
    if (pictureInPictureSessionId == null) removePipView()
    if (synchronized(lock) { sessions.isEmpty() }) stopProgressTicker()
    return true
  }

  private fun missing(sessionId: String) = mapOf(
    "kind" to "completed",
    "value" to mapOf("kind" to "missing", "sessionId" to sessionId),
  )

  private fun unsupported(diagnostic: String) = mapOf(
    "code" to "NATIVE_OPERATION_UNSUPPORTED",
    "diagnostic" to diagnostic,
    "kind" to "unsupported",
  )

  private fun resolveHost(activity: Activity?): Activity? {
    val candidates = listOf(activity, synchronized(lock) { hostActivity?.get() })
    return candidates.firstOrNull { host ->
      host != null && !host.isFinishing && !host.isDestroyed
    }
  }

  private fun pipEligible(context: Context?): Boolean {
    val resolved = context ?: return false
    return resolved.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
  }

  private fun sessionCompleted(context: Context?, sessionId: String) = mapOf(
    "kind" to "completed",
    "value" to mapOf(
      "pictureInPictureEligible" to pipEligible(context ?: applicationContext),
      "sessionId" to sessionId,
    ),
  )

  private fun qualityCompleted(current: Session) = mapOf(
    "kind" to "completed",
    "value" to mapOf(
      "qualities" to videoQualities(current.player),
      "selected" to if (current.selectedQuality == "highest") {
        current.resolvedHighestQuality ?: "auto"
      } else {
        current.selectedQuality
      },
      "sessionId" to current.sessionId,
    ),
  )

  private fun videoQualities(current: ExoPlayer): List<String> {
    val heights = linkedSetOf<Int>()
    for (group in current.currentTracks.groups) {
      if (group.type != C.TRACK_TYPE_VIDEO) continue
      for (index in 0 until group.length) {
        val height = group.getTrackFormat(index).height
        if (height > 0) heights.add(height)
      }
    }
    return listOf("auto") + heights.sortedDescending().map { "${it}p" }
  }

  private fun applyHighestQuality(current: Session, tracks: Tracks) {
    val override = tracks.groups.asSequence()
      .filter { it.type == C.TRACK_TYPE_VIDEO }
      .flatMap { group ->
        (0 until group.length).asSequence()
          .filter { group.isTrackSupported(it) && group.getTrackFormat(it).height > 0 }
          .map { TrackSelectionOverride(group.mediaTrackGroup, it) }
      }
      .maxWithOrNull(compareBy<TrackSelectionOverride> {
        it.mediaTrackGroup.getFormat(it.trackIndices.single()).height
      }.thenBy {
        it.mediaTrackGroup.getFormat(it.trackIndices.single()).frameRate
      }.thenBy {
        it.mediaTrackGroup.getFormat(it.trackIndices.single()).bitrate
      }) ?: return
    val parameters = current.player.trackSelectionParameters
    if (parameters.overrides[override.mediaTrackGroup] == override) return
    current.player.trackSelectionParameters = parameters.buildUpon()
      .setOverrideForType(override)
      .build()
  }

  private fun highestSelectedQuality(tracks: Tracks): String? = tracks.groups
    .asSequence()
    .filter { it.type == C.TRACK_TYPE_VIDEO }
    .flatMap { group ->
      (0 until group.length).asSequence()
        .filter { group.isTrackSelected(it) && group.isTrackSupported(it) }
        .map { group.getTrackFormat(it).height }
    }
    .filter { it > 0 }
    .maxOrNull()
    ?.let { "${it}p" }

  private fun requestHeaders(request: Map<String, Any>): Map<String, String> {
    val raw = request["requestHeaders"] as? Map<*, *> ?: return emptyMap()
    val headers = linkedMapOf<String, String>()
    for ((key, value) in raw) {
      if (key is String && key.isNotBlank() && value is String && value.isNotBlank()) {
        headers[key] = value
      }
    }
    return headers
  }

  private class PlaybackSource(
    val factory: DefaultMediaSourceFactory,
    val mediaItem: androidx.media3.common.MediaItem,
    val filteringFactory: FilteringDataSource.Factory?,
  ) {
    val mediaSource: MediaSource get() = factory.createMediaSource(mediaItem)
  }

  private fun playbackSource(
    sessionId: String,
    sourceUri: String,
    sourceRequest: Map<String, Any>,
    preferences: Map<String, Any>,
    quarantine: TwitchAdMediaQuarantine,
  ): PlaybackSource {
    val headers = requestHeaders(sourceRequest)
    val httpFactory = DefaultHttpDataSource.Factory()
      .setAllowCrossProtocolRedirects(true)
      .setDefaultRequestProperties(headers)
    headers["User-Agent"]?.let(httpFactory::setUserAgent)
    val filterMode = playlistFilterMode(sourceRequest)
    val filteringFactory = if (filterMode == "passthrough") null else FilteringDataSource.Factory(
      httpFactory,
      filterMode,
      { diagnostic, adsDetected ->
        publish(mapOf(
          "kind" to "filtering",
          "sessionId" to sessionId,
          "diagnostic" to diagnostic,
          "adsDetected" to adsDetected,
        ))
      },
      sourceUri,
      (sourceRequest["filtering"] as? Map<*, *>)?.get("channelName") as? String,
      quarantine,
    )
    return PlaybackSource(
      DefaultMediaSourceFactory(filteringFactory ?: httpFactory)
        .setLoadErrorHandlingPolicy(PlaybackLoadErrorHandlingPolicy()),
      PlaybackPreferenceConfig.mediaItem(sourceUri, mimeType(sourceUri), preferences),
      filteringFactory,
    )
  }

  private fun playlistFilterMode(request: Map<String, Any>): String {
    val filtering = request["filtering"] as? Map<*, *> ?: return "passthrough"
    val enabled = isTruthy(filtering["enabled"])
    val platform = filtering["platform"] as? String
    val mode = filtering["mode"] as? String ?: "passthrough"
    if (!enabled || platform != "twitch") return "passthrough"
    return if (mode == "canary" || mode == "strip") mode else "passthrough"
  }

  private fun isTruthy(value: Any?): Boolean {
    return when (value) {
      is Boolean -> value
      is Number -> value.toInt() != 0
      is String -> value.equals("true", ignoreCase = true)
      else -> false
    }
  }

  private fun isHttpsMedia(sourceUri: String): Boolean {
    return PlaybackSourceUri.isAcceptedHttpsMedia(sourceUri)
  }

  private fun mimeType(sourceUri: String): String {
    return PlaybackSourceUri.mimeTypeFor(sourceUri)
  }

  private fun captionRenderers(context: Context, sessionId: String): DefaultRenderersFactory {
    return object : DefaultRenderersFactory(context) {
      override fun buildAudioSink(
        context: Context,
        enableFloatOutput: Boolean,
        enableAudioTrackPlaybackParams: Boolean,
      ): AudioSink {
        return DefaultAudioSink.Builder(context)
          .setEnableFloatOutput(enableFloatOutput)
          .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
          .setAudioProcessors(arrayOf(TeeAudioProcessor(CaptionPcmTap.forSession(sessionId))))
          .build()
      }
    }
  }

  private fun startProgressTicker() {
    main.removeCallbacks(progressTicker)
    main.post(progressTicker)
  }

  private fun stopProgressTicker() {
    main.removeCallbacks(progressTicker)
  }

  private fun progressEvent(sessionId: String, exo: ExoPlayer): Map<String, Any> {
    val duration = exo.duration
    val seekable =
      exo.isCurrentMediaItemSeekable && duration > 0L && duration != C.TIME_UNSET
    return mapOf(
      "kind" to "progress",
      "sessionId" to sessionId,
      "positionMs" to exo.currentPosition.toDouble(),
      "durationMs" to if (duration == C.TIME_UNSET) 0.0 else duration.toDouble(),
      "seekable" to seekable,
    )
  }

  private fun publish(event: Map<String, Any>) {
    main.post { emit?.invoke(event) }
  }

  private fun <T> onMain(block: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return block()
    }
    val done = CountDownLatch(1)
    val result = AtomicReference<Result<T>>()
    main.post {
      try {
        result.set(runCatching(block))
      } finally {
        done.countDown()
      }
    }
    done.await()
    return requireNotNull(result.get()).getOrThrow()
  }

  private class Session(
    val sessionId: String,
    val player: ExoPlayer,
    var filteringFactory: FilteringDataSource.Factory?,
    val startRequest: Map<String, Any>,
    val quarantine: TwitchAdMediaQuarantine,
    val sourceRecovery: Boolean,
    var muted: Boolean = false,
    var selectedQuality: String = "auto",
    var resolvedHighestQuality: String? = null,
    var volumeBeforeMute: Float = 1f,
  ) {
    var interruption: RecoveryInterruption? = null
    var lastRecoverableError: PlaybackException? = null
    var decoderRestarted = false

    fun dispose() {
      CaptionPcmTap.endSession(sessionId)
      player.release()
      filteringFactory?.dispose()
    }
  }

  private enum class RecoveryPhase { WAITING, PREPARING }

  private data class RecoveryInterruption(val id: Int, val phase: RecoveryPhase)

  private class SessionListener(
    private val sessionId: String,
    private val player: ExoPlayer,
  ) : Player.Listener {
    private fun currentSession(): Session? = synchronized(lock) {
      sessions[sessionId]?.takeIf { it.player === player }
    }

    override fun onTracksChanged(tracks: Tracks) {
      val session = currentSession() ?: return
      if (session.selectedQuality == "highest") {
        session.resolvedHighestQuality = highestSelectedQuality(tracks)
        applyHighestQuality(session, tracks)
      }
      if (session.player.playWhenReady) {
        publish(mapOf("kind" to "playing", "sessionId" to sessionId))
      }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      val session = currentSession() ?: return
      updateScreenAwakeRequests()
      when (playbackState) {
        Player.STATE_BUFFERING -> publish(mapOf("kind" to "buffering", "sessionId" to sessionId))
        Player.STATE_READY -> {
          val recovered = session.interruption?.takeIf { it.phase == RecoveryPhase.PREPARING }
          if (recovered != null) {
            session.interruption = null
            publish(mapOf(
              "kind" to "source-recovered",
              "sessionId" to sessionId,
              "interruptionId" to recovered.id,
            ))
          }
          if (session.player.playWhenReady) {
            publish(mapOf("kind" to "playing", "sessionId" to sessionId))
          } else {
            publish(
              mapOf(
                "kind" to "paused",
                "sessionId" to sessionId,
                "reason" to "user",
              ),
            )
          }
        }
        Player.STATE_ENDED -> {
          if (disposeSession(sessionId, player)) {
            publish(mapOf("kind" to "ended", "sessionId" to sessionId))
          }
        }
      }
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      currentSession() ?: return
      updateScreenAwakeRequests()
      if (playWhenReady) {
        publish(mapOf("kind" to "playing", "sessionId" to sessionId))
        return
      }
      val pausedReason =
        if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS) {
          "background"
        } else {
          "user"
        }
      publish(
        mapOf(
          "kind" to "paused",
          "sessionId" to sessionId,
          "reason" to pausedReason,
        ),
      )
    }

    override fun onPlayerError(error: PlaybackException) {
      val session = currentSession() ?: return
      if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
        session.player.seekToDefaultPosition()
        session.player.prepare()
        return
      }
      if (session.sourceRecovery && !session.decoderRestarted &&
        error.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED &&
        generateSequence<Throwable>(error) { it.cause }.any { it is MediaCodecDecoderException }) {
        session.decoderRestarted = true
        session.player.prepare()
        updateScreenAwakeRequests()
        return
      }
      if (session.sourceRecovery && isRecoverableSourceError(error)) {
        if (session.lastRecoverableError === error) return
        if (session.interruption?.phase == RecoveryPhase.WAITING) return
        session.lastRecoverableError = error
        val interruptionId = nextInterruptionId++
        session.interruption = RecoveryInterruption(interruptionId, RecoveryPhase.WAITING)
        updateScreenAwakeRequests()
        publish(mapOf(
          "kind" to "source-recovery-required",
          "sessionId" to sessionId,
          "interruptionId" to interruptionId,
        ))
        return
      }
      if (!disposeSession(sessionId, player)) return
      publish(
        mapOf(
          "kind" to "failed",
          "sessionId" to sessionId,
          "code" to failureCode(error),
          "detail" to "Focused playback stopped.",
        ),
      )
    }
  }

  private fun isRecoverableSourceError(error: PlaybackException): Boolean {
    if (generateSequence<Throwable>(error) { it.cause }.any {
        it is HlsPlaylistTracker.PlaylistStuckException || it is HlsPlaylistTracker.PlaylistResetException
      }) return true
    val response = generateSequence<Throwable>(error) { it.cause }
      .filterIsInstance<HttpDataSource.InvalidResponseCodeException>()
      .firstOrNull() ?: return false
    return response.responseCode in setOf(401, 403, 404, 408, 429) || response.responseCode >= 500
  }

  private fun failureCode(error: PlaybackException): String {
    val message = error.errorCodeName.lowercase()
    return when {
      message.contains("decoder") -> "PLAYBACK_DECODER_UNSUPPORTED"
      message.contains("http") || message.contains("network") || message.contains("timeout") ->
        "PLAYBACK_NETWORK_FAILED"
      message.contains("parsing") || message.contains("format") || message.contains("manifest") ->
        "PLAYBACK_SOURCE_REJECTED"
      else -> "PLAYBACK_UNKNOWN"
    }
  }
}
