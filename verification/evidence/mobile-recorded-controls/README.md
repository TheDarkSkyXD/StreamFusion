# Recorded player controls — Android, 2026-10-08

Live streams have no rewind, forward, scrubber, or recorded clock, including when the native player reports a seekable live buffer. VODs and clips place rewind and forward beside centered play/pause, with a timeline at the bottom. Skip durations still use the existing preferences.

The reference is the installed Twitch Android 31.5.2 app on emulator-5558. Its free official Twitch VOD, `@ariathome DJ Set | Amazon Ads UK Upfronts`, has controls approximately 72 dp apart in portrait and landscape. Both reference screenshots are included. StreamFusion uses the same fixed spacing and vertical placement relative to its player stage.

## Observed native behavior

- Live: paused TheBurntPeanut stream; no recorded controls or timeline.
- VOD: paused official Twitch recording; forward changed 3:15 to 3:25, rewind restored 3:15.
- Clip: paused official Twitch 23-second Patch Notes clip; forward changed 0:06 to 0:16, rewind restored 0:06.
- Fullscreen: all controls and timeline remain inside the 2400 × 1080 stage after opening Search's keyboard, submitting a search, navigating to the recording, and rotating to fullscreen.
- Transport centers are 189 physical pixels apart at density 2.625, or 72 dp, in both orientations. Native hierarchy assertions and image hashes are in `native-proof.json`.

Testing caught two interaction problems: transparent rail padding intercepted the centered controls, and the shell's KeyboardAvoidingView retained a portrait height after Search and rotation. The rail now passes touches through its padding; the shell relies on its configured Android window resizing and existing keyboard visibility/inset tracking.

## Verification

73 Node tests, 1,033 Vitest tests across 179 files, architecture import checks, mobile lint, typecheck, formatting, and 39 focused Watch tests passed. React Doctor reported no errors; its three warnings concern the existing large player component and control-flow complexity in the player and app shell. No suppression or comment was introduced.

The required pre-commit desktop smoke check compiled and launched the real Electron app, confirmed the renderer and preload bridge, and passed its SQLite integrity/table checks. Evidence: `F:/CodexWorktrees/sf-mobile-ux-20261008/.scratch/verify-streamfusion/evidence/2026-10-08T19-29-59-362Z/`.

The updated Development app was exercised on API 36.1 without uninstalling or clearing either installed StreamFusion app. Screenshots are native captures, not mockups. The floating Expo developer gear belongs to the development host. Clip transport was checked before the subsequent shell wrapper correction; the final Search-to-fullscreen check used the VOD and final source.
