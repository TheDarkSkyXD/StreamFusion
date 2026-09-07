# Twitch session recovery and moderator dragging

Shipped to main: `3617b3958d839cb556af8fcd75660d288f7d9e37`.

## Findings and changes

- Disposable verification previously copied live OAuth credentials and browser encryption state. Twitch device-code refresh tokens are single use. Refreshing a copied token can invalidate the original and leave the replacement in a disposable profile. The verifier now seeds only preferences, window bounds, and last active tab; it never copies credentials, identities, encryption keys, or cookies, even with an explicit storage source. Regression tests cover the allowlist and future unknown credential fields.
- The saved source Twitch access token expired at 2026-09-06T02:27:53.745Z and validation returned HTTP 401. The source storage timestamp remained 2026-09-05T22:06:48.973Z through isolated testing. Historical temporary files were also expired. No usable credential recovery was found. The precise historical refresh that spent this account's token was not observed.
- Login could report success when token issuance succeeded but account identity loading returned null. The new path retains issued credentials, clears stale identity, and returns an explicit error until identity exists. Status can recover a missing identity from a valid saved token, with one request per token in flight. Stale identity responses and stale 401s cannot overwrite a newer login or affect credentials after logout.
- Moderator dragging now has a platform-colored floating header preview. Pointer updates coalesce into one animation frame and use a transform; drop-target state only changes when the target changes. Live chat and video stay mounted. Pinned AutoMod/Retention and left/right-only Mod Actions rules remain enforced. Pending animation frames and pointer capture are cleaned up on drop, cancellation, and unmount.

## Evidence

- Full desktop suite: 628 files / 7,590 tests passed (`full-tests.log`).
- Old-code semantic RED: login regression resolves null instead of rejecting (`auth-red.log`). New-code auth suites: 4 files / 100 tests passed.
- Restart integration: 6 tests passed (`restart-tests.log`), exercising persisted token reload. These are not proof of a live Twitch account restart.
- Workspace: 4 files / 32 tests passed after the final React layout-effect correction.
- Verifier seed and launcher tests: 11 passed.
- Checked app launch passed typecheck and lint; compiled Electron smoke passed and cleaned its disposable profile (`compiled-smoke/`).
- React Doctor: 90/100, no errors after correcting the new render-time ref assignment.
- Real Electron drag sample: 120 pointer moves, 158 display frames over 2.6475 seconds, frame interval p95 16.8 ms, maximum 16.9 ms. Script time 46.814 ms, task time 126.337 ms, 3 layouts. The prior invisible preview used less CPU; this is smooth-frame evidence, not a CPU-speedup claim. Evidence: `../verify-streamfusion/evidence/auth-drag-after-20260906/drag-frames-after/`.
- Real legal left/right drops and rejected top drop observed; chat/video DOM host identities retained. Reference Twitch Mod View inspected in T3.

## Live account handoff

An owned normal development app was launched with the actual `.streamfusion-dev-user-data` profile, not a disposable token clone. Its run metadata is `persistent-app/run.json`; checked startup log is `persistent-app/launch.log`. Reconnect Twitch was clicked through the real UI. Twitch authorization is pending user sign-in. Do not claim the account is connected or its live restart verified until authorization completes and an actual restart is observed. Never use the verification controller cleanup on this persistent profile.

The metadata probe's temporary copied `Local State` encryption file was deleted. No credentials were printed or included in this report. User telemetry and unrelated scratch work remain untouched and uncommitted.

Twitch refresh-token semantics: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow
