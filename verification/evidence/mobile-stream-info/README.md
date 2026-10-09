# Mobile stream information card

On Android, tapping a live player reveals channel metadata with the existing player controls. Chat remains underneath. Metadata collapses with the controls after three seconds, and stays expanded while paused or while player tools hold the controls open.

The card renders the avatar, available verification badge, channel name, title, category, and horizontal language/tag pills. Follow retains guest and connected-account behavior. Subscribe opens the Twitch channel subscription page through a watch capability and an Expo adapter. Kick does not show this Twitch action. Channel navigation, fullscreen, recorded comments, and explicit Info/Related views remain available.

## Observed Android evidence

Captured on 2026-10-09. Twitch reference: Android 16, emulator-5558. StreamFusion development client: Android 11, emulator-5580. Both are 1080 × 2400 at density 420. The Twitch reference and StreamFusion used FirstTourGuardsman's live channel.

| Capture                                       | Observation                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Before](before-info.png)                     | The old player tap selected Info and removed chat.                                      |
| [Twitch expanded](twitch-tap-1s.png)          | Avatar, stream copy, scrolling tags, Follow/Subscribe row, chat underneath.             |
| [Twitch collapsed](twitch-tap-6s.png)         | Stream copy collapses with the player controls.                                         |
| [StreamFusion expanded](after-expanded.png)   | Stream metadata and actions above live chat; paused for a stable capture.               |
| [Following](after-following.png)              | Follow changed to Following; row widths stayed stable. Reverted afterward.              |
| [StreamFusion collapsed](after-collapsed.png) | Chat remains visible below compact channel actions.                                     |
| [Fullscreen](after-fullscreen.png)            | Player fills landscape; portrait card and chat are absent. Exiting returns to portrait. |

Subscribe opened Chrome at `subs.twitch.tv/firsttourguardsman`, observed in the native URL-bar hierarchy. Returning brought back the paused Watch session. Channel history navigation and live playback also worked. Native automation references were shared across sessions, so later taps used coordinates from freshly observed hierarchies. The isolated proof emulator's original Arabic display-language preference was restored.

The native session was signed out: its composer correctly remained read-only. The React interaction test uses the real ChatPanel, enters a draft, expands/collapses the card, and verifies the draft, chat subscription, and player instance survive. Native Picture-in-Picture was not established by this run; no new PiP behavior is claimed.

## Visual limits

This reproduces the Twitch information-card structure and interaction with StreamFusion's existing dark design tokens. It is not pixel-exact parity. Twitch was in its light theme. Palette, avatar ring, tag ordering, padding, button height, verification data, live text, and chat presentation differ. The baseline captures were retained unchanged.

An unmasked RGB comparison of the aligned card region (`x=0, y=671, width=1080, height=487`) found 514,099 differing pixels out of 525,960 (97.74%). Zero-pixel parity fails. This measures all color/text differences and does not isolate geometry. The saved native hierarchy measures a 48dp avatar and action widths of 500px / 496px, unchanged when Following. The geometry check permits that observed difference of less than 2dp; it does not establish equivalence to Twitch.

Run `node verification/scripts/verify-mobile-stream-info.mjs` to recheck the saved Android hierarchies. Fresh app verification requires new captures; this script validates these artifacts only.

## Checks

- Full mobile suite: 73 Node tests and 1,114 Vitest tests passed; feature architecture import proof passed.
- Final focused player/card suite: 48 tests passed across five files after sizing adjustment.
- Mobile typecheck and full ESLint passed. Changed source formatting and diff checks passed.
- React Doctor changed-file scan: 88/100, six complexity warnings in existing large functions, including concurrent discovery/shell edits; no correctness or security errors. No earlier score baseline was recorded, so no score-regression claim is made.
- Independent comment review: zero deletions or flags. One implementation owner changed Watch; unrelated work was excluded from this commit.

The design decision and ownership rationale are in [DESIGN-DECISION.md](DESIGN-DECISION.md).
