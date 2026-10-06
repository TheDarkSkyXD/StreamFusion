# Mobile UI verification checkpoint

This checkpoint describes the initial mockup integration at commit `67dd623`. The later [chat parity verification](chat-parity-verification.md) records the current chat publication cadence, saved retention limit, provider cosmetics, events, and additional verification.

Desktop labels, icon families, and semantic colors are authoritative for equivalent controls. Android sheets, safe areas, touch targets, and capability notices follow the mobile host. The vocabulary audit records source comparisons. It does not prove every story pixel-identical.

## Implemented workflows

[Implementation evidence](implementation-evidence.json) maps the 13 initially missing workflows to production owners. The original 160-story ownership ledger remains unchanged as historical evidence. Production screens use injected controllers and capability ports. Storybook additionally contains 13 production-provider stories, for 173 total stories. The verifier compares the approved 160 story IDs to the saved immutable manifest.

Moderation context survives permission requests, consumed return navigation is cleared, and Retention is reachable on Twitch and Kick. Optional Twitch subscriptions and Bits permissions can be requested explicitly. Development auth fixture entry points are confined to Diagnostics developer tools. Unsupported provider operations retain accurate handoffs.

## Automated checks

The delivery run exercises 71 Node source/native checks, 923 Vitest tests in 163 files, and the architecture boundary proof. Mobile typecheck and zero-warning ESLint pass after the final changes. Storybook builds and its coverage verifier checks 21 mobile routes, 14 desktop routes, 16 settings sections, 22 presentation modules, 28 components, and 173 stories. Android source export and the rebuilt x86_64 development APK establish bundle and native compatibility.

Local logs are retained under E:/Codex/artifacts. Delivery files use the mobile-ui-test-delivery, mobile-ui-lint-delivery, mobile-ui-typecheck-delivery, mobile-ui-storybook-delivery, mobile-ui-storybook-verify-delivery, and mobile-ui-android-export-delivery prefixes. The native APK build is recorded in mobile-ui-native-final-build.log.

Player Tools tests mount the production component, observe real port results, verify serialized polling, and verify timer cancellation plus late-result fencing after unmount. React Doctor's timer-cleanup diagnostic is reviewed against this test and the explicit effect cleanup. It is not accepted as evidence of a timer leak.

## Android observations

The Android API 30 development client was cold restarted with cleared Metro bundles and the rebuilt native APK. Captures retain their original 1080 by 2400 dimensions. Observed public Kick browsing includes Home artwork and live viewer counts, category artwork, live video, chat and emotes, and native Video Stats. Connected Accounts reports unavailable configured client IDs and preserves guest browsing. Following shows the actual guest state. Settings controls use desktop labels and switch colors. Kick and Twitch seek bars use their desktop platform colors. Player Tools uses the desktop Timer and Activity icons, and Video Stats uses the desktop Skipped Frames label for native dropped-frame observations. Storybook Settings reuses the production Settings tile rows and their category icons. Android sheets extend through app navigation, preserve system bars, and keep content above the keyboard.

Chat publications are bounded to four per second and retain the latest 100 messages. Rows are virtualized and memoized. Plain text runs are combined without changing spaces or emotes. Native inverted-list anchoring replaces scroll-after-layout callbacks. Software 1080p60 decoding produced substantial dropped frames on this emulator. These screenshots do not qualify playback capacity or prove smooth high-load playback on physical hardware.

Authenticated Twitch or Kick writes were not performed because this environment has no qualified connected account. Provider-port tests cover authorization and operations, but do not establish live provider acceptance. The final 173 rendered Storybook screenshots are packaged in E:/Codex/artifacts/streamfusion-mobile-final-mockups-173.zip. The initial 160 mockup screenshots remain available separately. Updated native screenshots are packaged in E:/Codex/artifacts/streamfusion-mobile-desktop-parity-screenshots.zip. Native captures verify selected workflows, not every story state. Pixel comparison uses exact RGBA values with explicit crops and masks; no blanket pixel-parity claim is made.

## Shutdown and delivery

ADB confirmed final shutdown of emulator-5566 with "OK: killing emulator, bye bye" and "OK". The captured result is E:/Codex/artifacts/mobile-ui-emulator-final-shutdown.log. Metro was stopped afterward. The normal commit hook must pass the desktop preview smoke before delivery. The original checkout's 49 existing edited or untracked files were hashed before integration and must retain identical contents afterward.
