# Android update UX

Status: research complete

Date: 2026-10-16

## Recommendation

Remove the repeated availability banner from the app shell. Make Settings > Updates the durable place to discover a release, read its notes, and recover an unfinished update. Use clear action labels and preserve the existing next-day deferral and native update operation.

This is a product recommendation informed by Android guidance. The official sources do not prescribe StreamFusion's settings location or a particular reminder interval.

## Official guidance

- Android distinguishes flexible updates, which allow continued app use during download, from immediate updates for changes critical to core functionality. [Android in-app updates](https://developer.android.com/guide/playcore/in-app-updates).
- Google warns against requesting updates too often. Its guide considers release age and importance when deciding whether to prompt. It also recommends allowing continued use after cancellation when the app can function. [Update requests and cancellation](https://developer.android.com/guide/playcore/in-app-updates/kotlin-java).
- A flexible update should show download progress and notify the user when installation is ready. Google recommends confirmation before a restart so users can choose when to stop using the app. This guidance concerns Google Play's flow, not StreamFusion's APK installer contract. [Flexible update completion](https://developer.android.com/guide/playcore/in-app-updates/kotlin-java).
- Android describes Material dialogs as interruptive. Use that interruption for a deliberate decision rather than routine release awareness. [Dialogs](https://developer.android.com/develop/ui/compose/components/dialog).
- Material snackbars provide brief feedback without interrupting use and can include an action. They suit a single event better than a permanent notice repeated across destinations. [Snackbars](https://developer.android.com/develop/ui/compose/components/snackbar).

Play Core is the source of these UX principles. StreamFusion distributes public GitHub APKs and should retain its own verified native download and Android approval mechanisms.

## Inspected baseline

The current [update documentation](../../../apps/mobile/UPDATES.md) describes automatic checks, next-day postponement, a native background download, verification, and an operation journal. A download accepted by the user continues to Android approval when ready, including after returning to the app.

The [update presentation](../../../apps/mobile/src/features/app-update/domain/update-presentation.ts) already models download, verification, ready, permission, approval, interruption, and failure states. The [settings panel](../../../apps/mobile/src/features/settings/components/support-settings-panels.tsx) already has release notes, manual checks, and installation recovery. Before this change, `UpdateAvailableNotice` repeated the availability message and action outside that destination. The [dialog](../../../apps/mobile/src/features/app-update/components/update-dialog.tsx) labeled acceptance and deferral "Yes" and "No".

The [release contract](../../../apps/mobile/src/features/app-update/capabilities/android-updater.ts) already includes version, APK byte size, and release notes. Improving that information does not require another metadata endpoint.

## Smallest good change

1. Remove the global availability notice. Keep Settings > Updates reachable through normal settings navigation. An "Update available" subtitle on the existing Updates row is enough for discovery inside Settings.
2. Retain the existing deferred offer policy. Changing tabs must not reopen an offer or bypass deferral. Keep automatic checking separate from automatic interruption.
3. Show the release version and formatted APK size before downloading. Keep real release notes and the GitHub release link in Updates. A missing notes message should stay honest.
4. Replace "Yes" with "Download update" and "No" with "Later". Tell the user that Android will request installation after download. If a button only opens details, label it "View update" rather than implying it starts the transfer.
5. Keep transferred bytes, total size, progress, and explicit cancellation visible while downloading. Label verification as "Verifying update" rather than implying network transfer continues.
6. Preserve the current state-specific recovery actions in Settings. "Install update", "Open Android settings", and "Continue installation" explain the next step better than a generic "Open update". Keep errors and retry actions near that operation.

These recommendations preserve the updater's security checks, cancellation semantics, native intent, and installation journal. They do not require notifications, another global banner, or a new prompt scheduler.

## Watching and installation timing

Avoid introducing new automatic dialogs during playback. A check that discovers a release should not itself navigate away from watching.

The fuller flexible-update experience would let a viewer download now and explicitly choose "Install update" later. That would require changing StreamFusion's current automatic handoff after download. Treat it as a separate product and native lifecycle decision. Removing a banner alone cannot provide that guarantee, and changing the native intent contract is outside this small UI improvement.

## Verification scope

This note is based on official documentation and inspected repository sources. It does not claim device verification.

The implementation is ready when ordinary destinations have no repeated availability banner, Settings exposes the release and recovery actions, deferral survives navigation, and the existing native download and approval flow still works after restart.
