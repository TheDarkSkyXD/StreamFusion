# Mobile workflow verification

On October 5, 2026, production mobile routes gained authenticated chat and emotes, recorded chat replay, role-checked moderation, provider-supported polls and predictions, multistream playback and chat, and offline caption controls. Storybook renders the same production components with deterministic boundary responses.

## Checks

| Check                             | Reproduction                                                                                                                                   | Result                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile behavior and architecture  | `npm run --workspace @streamfusion/mobile test`                                                                                                | Passed Node tests, Vitest, and forbidden-import proof.                                                                                                    |
| Mobile TypeScript                 | `npm run --workspace @streamfusion/mobile typecheck`                                                                                           | Passed.                                                                                                                                                   |
| Mobile ESLint                     | `npm run --workspace @streamfusion/mobile lint`                                                                                                | Passed without warnings.                                                                                                                                  |
| Android JavaScript bundle         | `npm run --workspace @streamfusion/mobile bundle:android`                                                                                      | Passed.                                                                                                                                                   |
| Storybook build and coverage      | `npm run --workspace @streamfusion/mobile build-storybook`, then `npm run --workspace @streamfusion/mobile verify:storybook`                   | Passed. 21 mobile routes and 160 stories.                                                                                                                 |
| Kotlin native module              | From `apps/mobile/android`, run `./gradlew :streamfusion-native-contracts:compileDebugKotlin :streamfusion-native-contracts:testDebugUnitTest` | Passed. 45 native JVM tests.                                                                                                                              |
| Actual Android speech recognition | `verification/scripts/verify-mobile-captions-native.ps1`                                                                                       | Recognized literal spoken text on an Android API 30 emulator. See [recognition evidence](../../../verification/evidence/mobile-local-captions/README.md). |

Run the Android export before the Storybook build. Expo export replaces `dist`, which also contains the Storybook output. A worktree whose dependencies are junctions to another drive requires `NODE_OPTIONS=--preserve-symlinks --preserve-symlinks-main` for the Storybook build.

The linked checkout's first Android export resolved stale route content. A fresh export with the same symlink flags, `--clear`, and `--source-maps` included the current production routes. Six workflow sources matched their source-map contents exactly after newline normalization. [Bundle provenance](../../../verification/evidence/mobile-workflows/android-bundle-provenance.json) records the command and artifact hash. Its separate output directory preserves the Storybook build.

## Running UI checks

The collaborative browser exercised the actual components at 412 by 892 pixels. Checks covered sending chat, inserting emotes, retaining failed drafts, moderation confirmation and provider rejection, poll creation, multistream addition and ordering, single audio selection, merged and channel chat, removal confirmation, and caption model installation, start, stop, and removal controls.

The browser used deterministic transports. It did not post real chat, moderate a real user, or create a real provider poll. [Chat composer](../../../verification/evidence/mobile-workflows/chat-composer.png), [moderation confirmation](../../../verification/evidence/mobile-workflows/moderation-confirmed.png), [provider rejection](../../../verification/evidence/mobile-workflows/moderation-denied.png), and [multistream removal](../../../verification/evidence/mobile-workflows/multistream-removal.png) preserve observed screens.

## Limits

Playback contract 4 and caption contract 3 require a rebuilt Android native client. Expo Go does not supply the program-audio tap. Actual Vosk recognition is proven separately from the complete Media3-to-caption-overlay pipeline. Physical-device PiP behavior, sustained playback capacity, caption latency, and live authenticated provider writes remain unqualified.

Viewer voting and Channel Points wagers open the provider. Unsupported official API operations use explicit provider handoffs. The [coverage ledger](coverage-matrix.md) remains a source inventory, not a release qualification or a claim of complete desktop parity.

Model the Domain kept workflows in typed feature controllers. Separate Before Serializing Shared State kept implementations in isolated worktrees. Prove It Works required production-component browser checks and real Android speech recognition. Independent review led to session-specific caption teardown, native terminal cleanup, background PiP selection, conservative audio switching, and preserved mutation uncertainty.
