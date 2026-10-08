# Mobile player controls correction

Quality and Fullscreen now appear only in the existing video controls. Captions, Record or Download, and More sit at the top of the same player stage. The below-video toolbar is removed. Secondary tool sheets remain available in fullscreen.

## Native evidence

Verified on emulator-5558 with StreamFusion Development 0.1.4-alpha.1, version code 6, using the current Metro source. The existing app data was preserved. The emulator needed a cold restart after its input dispatcher stopped delivering touches. Failed hierarchy captures were rejected.

| Check | Evidence |
| --- | --- |
| Each control appears once, within the portrait player stage | [Portrait screenshot](portrait.png), [native bounds](native-proof.json) |
| On-player settings opens and 720p selection is retained | [Selected quality](quality-selected.png) |
| Controls stay within the landscape stage | [Fullscreen screenshot](fullscreen.png) |
| Captions opens from the fullscreen player | [Captions sheet](fullscreen-captions.png) |
| Media opens from the fullscreen player | [Media sheet](fullscreen-media.png) |
| More opens from the fullscreen player | [More sheet](fullscreen-more.png) |

Back dismissed the More sheet, then returned to portrait. Quality was returned to Auto afterward. Playback was paused to hold the controls visible for screenshots. The gray floating gear is Expo development tooling.

The checks opened sheets without installing a caption model or starting a recording. Active caption recognition, a recorded-video download, and native PiP entry were not repeated for this placement correction.

## Automated checks

The [mobile test output](mobile-test.log) records 73 Node tests and 1,027 Vitest tests across 179 files, plus the feature architecture proof. [Lint](mobile-lint.log) and [typecheck](mobile-typecheck.log) passed. Focused tests cover stage ancestry, unique Quality and Fullscreen controls, secondary button callbacks, hidden controls, fullscreen sheets, PiP suppression, and one player mount across presentation changes.

React Doctor scanned the five changed mobile files and scored 92. It reported complexity warnings in the existing large WatchRoute and WatchScreen functions. The diff review found no casts, new compatibility paths, or unrelated changes. Comment review found zero new comments and no required fixes.

## Decisions

[The design decision](decision.md) records the selected approach. Experience First moved tools onto the video. Laziness Protocol removed the duplicate row and kept PlayerControls unchanged. Model the Domain keeps the selected secondary sheet in one route-owned discriminant so its timer can hold controls visible. Prove It Works required native taps and inspected screenshots.

The existing driver can repeat the interactions. Set ANDROID_SERIAL to emulator-5558, then run `node verification/scripts/drive-mobile-ux.mjs tap player-quality quality` or replace the target with `watch-tool-captions`, `watch-tool-media`, or `watch-tool-more`. The driver saves captures in mobile-twitch-ux. Pause playback first for stable visible controls.
