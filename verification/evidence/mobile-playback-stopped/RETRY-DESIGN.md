# Automatic network playback recovery

## Problem and grounding

The user wants playback to retry automatically. Existing live-window recovery is automatic. Native network interruption still reaches `onPlayerError`, disposes the session and captions, and stays stopped when connectivity returns. Reproduced on Twitch by disabling emulator Wi-Fi and data at 14:41:16. Media3 logged `UnknownHostException (no network)` at 14:41:31.895. The stopped screen persisted after connectivity was restored.

Watch calls the native playback capability through the Expo bridge. `FocusedPlaybackSessionOwner.start` builds the Media3 source, player, and listener. It retains the player in a session map and binds views and captions to that identity. Only the native media source needs new policy. No public API, route, JavaScript retry state, or event shape changes.

## Candidate A, retained player retry timer

Use a per-session pending Runnable and attempt/delay state. On eligible network errors, keep the failed player, emit buffering, and schedule `prepare()` on the main Handler. Cancel on pause, end, replacement, release, and terminal failure. Resume must reschedule from the retained player error. Native candidate recommends callback retries because they directly prevent disposal. This adds another scheduler and recovery state to synchronize with Media3. Existing terminal test fixtures would need changed error types.

## Candidate B, native load error policy

Apply a stateless `DefaultLoadErrorHandlingPolicy` subclass to `DefaultMediaSourceFactory`. Its private surface consists of the Media3 policy overrides. The native loader owns timers, counts, completion, and cancellation.

```kotlin
internal class PlaybackLoadErrorHandlingPolicy : DefaultLoadErrorHandlingPolicy() {
  override fun getMinimumLoadableRetryCount(dataType: Int): Int = Int.MAX_VALUE
  override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo): Long = error("not implemented")
}
```

The retry delay comes from the stock policy. Stock non-retryable exceptions stay non-retryable. Typed HTTP data source network connection failures and timeouts continue retrying after the stock limit. Preserve stock retry limits for other failures by returning `C.TIME_UNSET` once the default minimum is exceeded. Preserve the inherited location/track fallback. Exclude TLS handshake and peer verification failures from indefinite retry.

The 1.5.1 default delay grows from zero to five seconds and stays capped. `Loader.maybeThrowError` propagates a current error when its count exceeds the configured minimum. Its release path cancels scheduled and active loads and clears callbacks. Pausing never changes to play because this policy never sets `playWhenReady`. A paused player can continue loading, as it already does.

## Proposed synthesis

Select candidate B. The independent cross-judge approved it on interface depth, cancellation, retained playback state, classification, and minimality. It hides retry and cancellation in the existing Media3 loader with a smaller interface and no duplicated session state, per Laziness Protocol and Model the Domain. Keep the existing behind-live-window callback unchanged. Reject a JavaScript restart and the extra callback scheduler. Accept continued loading while paused to preserve current loader behavior. Fatal source, authorization, parsing, and decoder errors remain terminal. Exclude any `SSLException` in the cause chain. Compute eligible delays with Long arithmetic, capped at five seconds, to avoid stock Int multiplication overflow during prolonged retries.

## Implementation and verification

One delegate owns the policy, factory wiring, and native tests. Root owns emulator interruption and reconnection checks on Twitch and Kick, builds, commits, and push. Tests verify delay past the normal threshold, timeout, unrelated fatal/default behavior, TLS failure, and progressive default thresholds. Existing lifecycle tests retain stop/replacement/caption proof. Native APK verification must show sustained offline buffering and automatic video recovery on reconnection without tapping Retry.

Sources are the official Media3 1.5.1 [default policy](https://raw.githubusercontent.com/androidx/media/1.5.1/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/upstream/DefaultLoadErrorHandlingPolicy.java), [loader](https://raw.githubusercontent.com/androidx/media/1.5.1/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/upstream/Loader.java), and [HTTP error mapping](https://raw.githubusercontent.com/androidx/media/1.5.1/libraries/datasource/src/main/java/androidx/media3/datasource/HttpDataSource.java).

Runtime dependency correction. The module requests 1.5.1, but the installed APK's ExoPlayer log identifies resolved Media3 1.9.0. Checked the matching [1.9.0 policy](https://raw.githubusercontent.com/androidx/media/1.9.0/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/upstream/DefaultLoadErrorHandlingPolicy.java) and [loader](https://raw.githubusercontent.com/androidx/media/1.9.0/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/upstream/Loader.java). The relied-on retry counts, stock delay, fatal propagation, and release cancellation semantics are unchanged. Native tests and runtime proof use the resolved dependency.
