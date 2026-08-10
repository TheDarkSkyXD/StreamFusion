---
concept: twitch-ad-presentation-continuity
summary: Touch Twitch ad status shielding HLS recovery media events or player remounts and viewers can see a commercial interstitial or spinner or have play and mute intent overwritten. Keep the persistent cover through exact clean-frame release and keep every user control separate from internal safety state; skip for Kick VOD or controls unrelated to Twitch live presentation.
files:
  - {
      path: apps/desktop/src/components/player/twitch/twitch-live-player.tsx,
      role: owns the persistent clean frame poster and placeholder cover,
    }
  - {
      path: apps/desktop/src/components/player/twitch/twitch-hls-player.tsx,
      role: hides unsafe media and verifies the exact clean replacement frame,
    }
  - {
      path: apps/desktop/src/components/player/twitch/twitch-adblock-service.ts,
      role: prewarms verified clean A/V substitutions and holds unsafe playlist media,
    }
  - {
      path: apps/desktop/src/components/player/twitch/twitch-adblock-loader.ts,
      role: preserves channel ownership across redirected media URLs and fails closed on processing errors,
    }
  - {
      path: apps/desktop/src/backend/services/twitch-manifest-proxy.ts,
      role: applies the same fail-closed unsafe-media boundary in the main-process interception path,
    }
  - {
      path: apps/desktop/src/lib/twitch-unsafe-media-hold.ts,
      role: removes media-bearing URIs and tags from a known-unsafe playlist while retaining timing metadata,
    }
  - {
      path: apps/desktop/src/pages/Stream/index.tsx,
      role: preserves same-channel Twitch player identity across token refresh,
    }
  - {
      path: apps/desktop/tests/components/player/twitch/twitch-live-player-ad-presentation-gate.test.tsx,
      role: guards synchronous cover visibility remount persistence and fallbacks,
    }
  - {
      path: apps/desktop/tests/components/player/twitch/twitch-live-player-audio-safety.test.tsx,
      role: guards user audio intent at the real volumechange and persisted-store seam,
    }
  - {
      path: apps/desktop/tests/components/player/twitch/twitch-hls-player-adblock-status.test.tsx,
      role: guards shield ordering stale callbacks and verified clean release,
    }
  - {
      path: apps/desktop/tests/components/player/twitch/twitch-ad-first-frame-gate.test.tsx,
      role: guards unsafe appended frames from reaching visible presentation,
    }
  - {
      path: apps/desktop/tests/adblock/fixtures/twitch-playlists/ad-commercial-break-interstitial.m3u8,
      role: represents an opaque Twitch commercial-break presentation that must never be shown,
    }
---

# twitch-ad-presentation-continuity

## Load this concept when

- Changing Twitch ad-status handling or the opacity and mute presentation shield.
- Changing clean-frame detection or `requestVideoFrameCallback` handling.
- Remounting or re-keying `TwitchHlsPlayer` during URL refresh or recovery.
- Changing the Twitch live-player poster canvas stacking or loading overlays.
- Changing media event listeners or the ownership of play pause mute volume quality or PiP state.
- Diagnosing a black flash commercial-break interstitial spinner false Play icon or random mute even
  though ad blocking succeeds.

## The scar

The last-resort Twitch presentation shield sets the unsafe video element to opacity zero and mutes
it. That prevents ad video or audio already appended to Chromium's media pipeline from leaking.
The player container is black though, so the same safety mechanism caused a random black player at
ad entry and during some recovery paths. Normal substitution must avoid this last-resort path:
prewarm a verified clean A/V rendition and publish the clean substitution atomically, without first
broadcasting an unsafe status that physically mutes clean content.

Removing the opacity shield is not a fix. HLS status can become healthy before Chromium has
painted the clean replacement frame, and buffered ad media can still be presented during that
gap. Likewise, mounting a cover from React state after hiding the video leaves a one-paint race
where the black container is visible.

The ad-block player boundary also retained a legacy pause/resume callback. If invoked, it called
`video.pause()` and scheduled `play()` 100 ms later. That briefly overrode the viewer's playback
state and could remain paused when the delayed play was interrupted. Ad recovery does not need
media pause authority; HLS loading and the presentation shield already own the required work.

The active runtime pause path was the ad-hold watchdog: after 15 seconds without a fragment it
called the page refresh callback. That advanced playback identity, remounted the keyed HLS child,
and teardown paused the old video. If replacement autoplay was interrupted or denied, playback
stayed paused. Ad holds now retry with HLS `startLoad(-1)` in place and cannot refresh the page.

The 2026-08-09 observation separated two similar-looking paths. During ordinary ad substitution,
`waiting` could set the generic startup loader while a stable clean-frame or poster cover was
already visible. During Vite HMR, teardown actually changed the old element to `paused=true` and
`readyState=0`, then the replacement element automatically recovered. Deriving the Play icon from
that transient element snapshot made internal recovery look like a viewer pause even though no
one clicked. Playback intent now belongs to an explicit per-channel model, not media events.

The same ownership leak existed for audio. The unsafe-presentation shield correctly wrote
`video.muted = true`, but Twitch live listened to every `volumechange` and copied the physical
element into the persisted volume store. The rerender then changed the HLS player's requested mute
prop, so exact clean release restored `true` and the viewer appeared randomly muted. Twitch live
has no native media controls; viewer mute and volume commands already enter through explicit
handlers. Generic media `volumechange` events therefore have no authority to write preference.

Three fail-open seams also allowed an interstitial to reach Chromium before the visual gate could
help. The renderer's old "strip" path classified an ad but left its media URIs in the returned
playlist; the main-process proxy returned the original unsafe playlist when no clean backup was
ready; and the renderer loader returned the original response when playlist processing threw.
Known-unsafe media now fails closed at both interception paths: retain only non-media timing and ad
metadata, expose no segment part map prefetch or rendition URI, and surface processing failure as a
loader error. Visual shielding remains defense in depth, not the first line of defense.

Repeated `ad-started` callbacks also called `hls.stopLoad()` followed by `hls.startLoad(-1)`.
Duplicate status notifications could discard useful clean buffering and jump the live edge about
once per signal, presenting as a one-second freeze. Ad lifecycle transitions are now idempotent
metadata transitions. They never stop or restart HLS; a bounded restart belongs only to a
separately proven network or fatal recovery path.

Media URL rotation exposed another ownership gap when more than one Twitch player was registered.
The loader already knows its channel, so that identity must travel with every media-playlist
processing call. Never infer a rotated URL's owner from a single-player fallback in multistream.

Do not special-case a phrase from Twitch's commercial-break slate. The leak was an actual Twitch
commercial interstitial presentation, and its text can vary. Treat the whole unsafe playlist and
its first appended frame as opaque unsafe content. A pending backup-selection state is not a
reason to delay shielding.

## Rules that prevent a repeat

1. Keep unsafe Twitch media hidden and muted. The cover is presentation continuity and never a
   substitute for the ad-frame safety gate.
2. `TwitchLivePlayer` owns the cover outside the keyed `TwitchHlsPlayer`. A recovery remount may
   replace the HLS child but must not erase the last safe presentation.
3. The cover layers stay mounted. The pre-shield callback must synchronously capture and reveal
   the selected layer in the same call stack before the video opacity becomes zero. React state
   alone is too late for the no-black guarantee.
4. Prefer the currently presented clean frame. If it cannot be drawn or no frame exists during
   preroll use the current route's stream poster. If route-matched metadata is not ready, derive
   the Twitch live-preview URL from the normalized current route login; never reuse prior-route
   metadata. If the poster fails use the non-black Twitch placeholder. Keep the compact blocking
   status visible over every cover, without marketing copy or a spinner.
5. A repeated unsafe signal or keyed recovery remount must retain the active cover. Do not
   replace a valid captured frame with a blank new video element or downgrade it to a poster.
6. Ordinary playback-health frames are not authority to uncover the player. Release only after
   the clean playlist target is buffered and `requestVideoFrameCallback` reports that exact
   media time as presented.
7. Restore the real video's opacity and requested mute state before synchronously hiding the
   cover. Reversing that order creates the same black flash at ad exit.
8. Increment the presentation generation and cancel stale frame callbacks on rapid ad re-entry.
   An old clean callback must not uncover a newer unsafe presentation.
9. Clear every cover layer in a layout effect when channel or stream identity changes. Never
   display the previous channel's captured frame on the new route.
10. Ad blocking must never call `video.pause()` or `video.play()`. Only viewer controls own the
    media element's paused state. Ad-start and ad-end transitions also must not call HLS
    `stopLoad()` or `startLoad()`; duplicate transition signals are idempotent.
11. The ad-hold watchdog must not receive page refresh authority. Parent refresh/remount remains
    available to fatal playback and offline recovery, but an active ad hold recovers inside HLS.
12. Model explicit viewer playback intent separately from `paused`, `waiting`, and `playing`.
    Internal reload remount token refresh visibility recovery HMR and media events preserve that
    intent. Playing intent resumes through recovery; deliberate pause never auto-resumes.
13. Ordinary ad substitution is not startup buffering. When blocking is active suppress the
    centered loader, including repeated `waiting` or `stalled` events and the interval after an
    exact clean substitute releases the cover. Show the loader only when no stable presentation
    exists during genuine startup or recovery. Keep the top-left player status visible as
    "Blocking ads" or "Blocking midroll ads" during active substitution. The label is informational:
    it must not hide loading or recovery state, alter playback, or weaken presentation shielding.
14. Shield every unsafe status immediately. Do not keep the video visible while backup selection
    is pending; that exception can expose the first Twitch commercial-interstitial frame.
15. Same-channel manifest or token refresh must keep the parent cover and player identity. A 403
    asks the parent for a fresh token but does not pause media or key a replacement by URL revision.
16. Physical ad-audio suppression is private presentation-safety state. It may mute the unsafe
    element, but it must never change the mute icon requested mute ref persisted volume or user
    preference. Exact verified clean release restores the prior requested mute state.
17. Generic `volumechange` events cannot write Twitch live preference. Only explicit viewer mute
    or volume commands own that store. This prevents rapid ad re-entry recovery remount and HMR
    from contaminating audio intent.
18. The same ownership boundary covers every user-facing control: ad detection and recovery may
    not change play pause mute volume quality seek fullscreen theater or PiP state. Internal HLS
    and presentation gates are separate models and are never represented as viewer choices.
19. Start clean backup discovery from ordinary clean playback. If a verified clean A/V substitute
    is warm when an ad begins publish one safe status with its player type already selected. Do not
    emit a transient unsafe status that mutes the clean feed before the substitute is ready.
20. When no verified clean A/V source exists fail closed: a static clean-frame or poster cover and
    physical audio suppression are safer than an interstitial leak. This fallback may create an
    unavoidable audible gap, but it cannot be persisted or shown as user mute. Measure it honestly.
21. A known-unsafe playlist must expose no appendable media to either renderer HLS or the
    main-process proxy. Remove segment URIs and media-bearing tags such as map part preload
    rendition-report and Twitch prefetch before release; loader processing errors fail closed.
22. Pass explicit channel ownership from each playlist loader into media processing so redirect
    or token-rotated URLs cannot bypass the unsafe boundary when multiple players exist. The
    main-process interceptor has no equivalent channel closure, so positively classified unowned
    Twitch media must also fail closed while unowned clean media remains transparent.

## Regression seam

Keep coverage at both ownership layers. The live-player tests prove canvas capture poster and
placeholder fallbacks same-stack visibility remount persistence verified-only release and route
identity clearing. The HLS tests prove the pre-shield callback happens before opacity mutation
and that only the exact buffered and presented clean target releases the shield. They also prove
the registered ad-block callback surface cannot change the media element's paused state. The
live-player seam also proves no ad callback can reach page refresh/remount. The first-frame fixture
proves classification and pre-shielding happen before playlist release and that commercial-
interstitial media never reaches fragment admission or `SourceBuffer`. The service seam proves
clean prewarming and a single atomically safe warmed transition; the HLS seam proves that transition
does not physically mute. The audio-safety seam uses the real `useVolume` hook and persisted Zustand
store to prove both user-muted directions internal `volumechange` isolation rapid re-entry remount
continuity and explicit-control ownership. Repeated ad-start tests must assert zero HLS stop/restart,
zero pause, and continuous clean presentation.

The 2026-08-09 event capture is recorded in
`.scratch/logs/twitch-ad-playback-event-timeline.md`. It distinguishes natural ad transitions from
the Vite HMR boundary and records the manifest 403 recovery. Proof images belong under
`.scratch/images/`; keep the final stable Electron run separate from the earlier diagnostic
observations.

Do not treat one healthy screenshot as proof of ordering. The deterministic same-stack and
exact-media-time tests are what guard the one-frame races that screenshots can miss.
