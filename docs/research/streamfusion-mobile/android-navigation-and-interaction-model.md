# Android navigation and interaction model

- Status: approved design for [Prototype Android navigation and parity interactions](https://github.com/TheDarkSkyXD/StreamFusion/issues/104)
- Selected prototype: B, revised with the approved **Following** and **Activity** destinations
- Primary source: [interactive navigation prototype](./prototypes/android-navigation-prototype.html)

## Decision

StreamFusion Mobile uses five top-level destinations on compact Android windows:

1. **Find** contains unified recommendations, categories, and search across Twitch and Kick.
2. **Following** contains live and offline followed channels, including StreamFusion Guest Follows.
3. **Watch** owns the active single-stream or Multistream session.
4. **Activity** contains in-app notifications from channels, media jobs, moderation, device health, and updates.
5. **More** contains the media library, moderation, settings, diagnostics, accounts, and maintenance actions.

The compact navigation bar does not contain **Media**, **Multistream**, or **You**. Multistream remains a mode inside **Watch**. The media library remains inside **More**.

The five destinations keep frequent viewing and notification tasks one tap away. Secondary tools remain complete without competing for their own permanent destination.

## Compact shell

Every compact screen uses the same shell:

- The top app bar shows the current context, global search when relevant, and an account shortcut into **More**.
- The bottom navigation bar shows **Find**, **Following**, **Watch**, **Activity**, and **More** in that order.
- Each destination owns its nested navigation history.
- A persistent **Now Playing** strip appears above the navigation bar while media continues outside **Watch**.
- Active recording and download jobs add status to the **Now Playing** strip when media is active. Without active media, job status appears as a compact activity strip in the same position.
- Android notifications remain the source of background controls after StreamFusion leaves the foreground.

Selecting the active destination returns to that destination's root after the first repeat selection. A second repeat selection scrolls the root to the top. Switching destinations preserves the other destination histories for the current app session.

Android system Back handles the nearest visible layer first:

1. Close a dialog, menu, or supporting sheet.
2. Return from a nested detail to its destination root.
3. Return through the Android task history.

Deep links may open a nested screen such as a stream, a moderation room, a download, or a diagnostic report. A deep link does not turn that screen into a new top-level destination.

## Find

**Find** is the unified discovery entry. It contains:

- Recommended live streams from both Platforms.
- Categories and category detail.
- Unified channel, stream, video, and clip search.
- Provider and language filters.
- Direct entry into single-stream playback or a Multistream slot.

Platform colors identify provider-owned content only. Twitch purple and Kick green do not become navigation accents.

## Following

**Following** is a permanent compact destination. Live channels appear before offline channels. Each row identifies whether the relationship comes from Twitch, Kick, or a StreamFusion Guest Follow.

The screen provides follow management, notification state, and provider-auth status without mixing recommendations into the followed-channel list. Selecting a live channel opens **Watch**. Selecting an offline channel opens its channel detail.

## Watch

**Watch** owns one active media session and has two modes:

- **Single** presents one live stream, video, or clip with playback controls, captions, chat, related content, recording, and eligible downloads.
- **Multistream** presents up to six configured slots with one audio owner and the active-video limit from the Capability Profile.

On a compact portrait screen, video remains the primary area. Chat uses a supporting sheet with closed, peek, and expanded states. Closing chat does not stop playback or discard its session. Info, related content, and playback tools use the same supporting-sheet region instead of stacking independent overlays.

Starting Multistream from a single stream keeps that stream as the focused slot and the audio owner. Returning to **Single** does not destroy the configured Multistream room. The user explicitly ends or clears either session.

Runtime Degradation appears inside **Watch** before it changes visible work. The message names the active limit, the preserved focused task, and the recovery action. Paused Multistream slots remain in the layout as live thumbnails.

Local captions stay attached to the focused single stream or focused Multistream slot. Starting captions may reduce other video work according to the approved device policy.

## Activity

**Activity** is the local in-app notification feed. It combines these notification classes:

- Followed-channel and Guest Follow live alerts.
- Recording, download, export, and recovery state changes.
- Runtime Degradation and device-health warnings that require attention.
- Moderation alerts for eligible managed channels.
- App update, account, and maintenance notices.

Unread state appears as a count on the **Activity** destination. Filters separate all activity, channel activity, and job activity. Each item shows its source, time, read state, and the action or artifact it opens.

Selecting an item opens the exact destination and nested detail. A live alert opens **Watch**. A job alert opens the media-library job. A degradation alert opens the affected **Watch** session or **Diagnostics** when no session remains.

Activity stays device-local. The lifecycle decision owns retention, deduplication, read-state persistence, and reconciliation after process death.

Activity does not replace Android system notifications. Android notifications deliver time-sensitive background state and controls. Activity provides the in-app history and return path.

## More and secondary tools

**More** groups secondary tools behind one bottom-navigation destination:

- **Media library** contains downloads, recordings, exports, and watch history.
- **Moderation** contains eligible managed channels and Platform-specific actions.
- **Settings** contains playback, chat, appearance, account, notification, storage, and privacy controls.
- **Diagnostics** contains the Capability Profile, active Runtime Degradation reasons, app health, redacted reports, and recovery actions.
- **Accounts and maintenance** contains Platform connections, update state, local-data controls, and destructive actions with confirmation.

The top app-bar account shortcut opens the account section inside **More**. Account state does not compete with unread notifications on **Activity**.

## Background jobs and recovery

Recording and download interactions follow one presentation model:

- The foreground screen shows the current state, progress, storage impact, and available controls.
- The compact activity strip keeps active work visible outside the media library.
- Each meaningful state change creates or updates one item in **Activity**.
- The Android notification exposes valid background controls.
- Returning through a notification or deep link opens the exact job detail.
- A recovered, paused, failed, finalized, or timed-out job states what happened and preserves each recoverable artifact.

The interface warns before the four-hour certified recording window ends. Safe finalization remains an explicit visible state, not a generic failure.

## Unsupported and constrained devices

An installable device that fails qualification sees the unsupported result before media work starts. The result explains the failed baseline and links to a diagnostic report. The app still permits safe access to the report and any already recoverable local artifacts.

A temporary constraint uses the Runtime Degradation presentation from the approved device policy. The warning stays next to the affected task. Global health state remains available in **Diagnostics**.

## Adaptive windows

The information architecture stays the same on phones, tablets, and foldables. Window width changes the navigation component and pane arrangement, not the destination names.

- Compact width uses the five-item bottom navigation bar.
- Medium and expanded widths use a labeled navigation rail with **Find**, **Following**, **Watch**, **Activity**, and **More**.
- **Find** and **Following** expand from a single feed into an adaptive grid or list-detail layout.
- **Watch** uses a supporting pane for chat, info, related content, or Multistream controls when space permits.
- **Activity** may show a notification list and the selected detail side by side.
- **More** opens as a constrained pane or sheet instead of stretching a phone layout across the window.

Fold and unfold transitions preserve the selected destination, the active media session, the supporting-sheet state, the Multistream layout, and the focused item.

## Design and accessibility rules

The Android client keeps the StreamFusion design system:

- Void Black and the three higher tonal surfaces establish depth.
- Resting cards and containers have no shadows.
- Storm Crimson marks live or critical state and remains scarce.
- Twitch purple and Kick green identify their Platforms only.
- Inter remains the product typeface.
- Interactive targets provide at least 48 density-independent pixels in each touch dimension.
- Text supports Android font scaling without clipping controls or hiding task state.
- Motion respects reduced-motion preferences and never carries required status by itself.

## Ownership handoffs

- [Choose the Android capability and trusted-service architecture](https://github.com/TheDarkSkyXD/StreamFusion/issues/103) owns route composition, application boundaries, and native capability adapters.
- [Define Android persistence, background, and notification behavior](https://github.com/TheDarkSkyXD/StreamFusion/issues/105) owns destination-history restoration, job journals, process-death recovery, and notification mechanics.
- [Define Android verification and GitHub release evidence](https://github.com/TheDarkSkyXD/StreamFusion/issues/106) owns accessibility, adaptive-window, lifecycle, and interaction evidence.
- [Choose the Platform integration support policy for Android](https://github.com/TheDarkSkyXD/StreamFusion/issues/109) owns provider availability and the behavior of unavailable provider actions.
- [Android device support and capability policy](./android-device-support-and-capability-policy.md) owns qualification and Runtime Degradation order.

## Rejected prototype directions

- The original five-item Outcome dock gave the media library and Multistream permanent navigation instead of **Following** and **Activity**.
- The six-workspace Command rail exposed every tool but consumed too much compact width.
- The original Watch deck grouped media and account tools under **You**. The approved revision gives **Following**, **Activity**, and **More** explicit destinations.

## Sources

- [Interactive navigation prototype](./prototypes/android-navigation-prototype.html)
- [StreamFusion design system](../../../DESIGN.md)
- [Continuous Android parity contract](./continuous-parity-contract.md)
- [Android device support and capability policy](./android-device-support-and-capability-policy.md)
- [Android layout and navigation patterns](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns)
- [Android canonical adaptive layouts](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts)
