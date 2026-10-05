# Android catalog verification

Verified October 5, 2026, against the current source inventory.

| Check                              | Observed result                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Mobile TypeScript and lint         | Pass                                                                                                                 |
| Mobile tests                       | 71 Node tests and 770 Vitest tests pass                                                                              |
| Runtime import boundaries          | Architecture verifier passes, including production-to-preview rejection                                              |
| Storybook production build         | Pass; static fonts and audit utility included                                                                        |
| Built catalog coverage             | 20 mobile routes, 14 desktop routes, 16 settings sections, 19 shared modules and 25 exported components; 141 stories |
| Browser render and WCAG A/AA audit | All 141 stories render, with zero reported violations at 412 × 892                                                   |
| Compact and tablet samples         | Eight representative stories pass at 360 × 800 and 1024 × 768                                                        |
| Dependency checks                  | Dependency sources, lockfile lint and seven-day release-age policy pass                                              |
| Clean mobile installation          | Isolated `npm ci --workspace @streamfusion/mobile --ignore-scripts` passes                                           |

The complete browser result is in [component-browser-audit.json](component-browser-audit.json). The audit measures rendered content and axe rules; it is not an Android device qualification.

Observed local interactions include quality selection and sheet dismissal, chat draft submission and clearing, destructive-dialog cancel and confirm, and adding a stream slot from a labeled field. These actions update fixture state only. Screenshots retain the compact discovery layout and the tablet Watch layout in [component-evidence](component-evidence/).

The review identified and resolved tab contrast and collapsed tab sizing, missing accessible names, unchecked radio semantics, nested interactive controls, and keyboard access to a scrollable stats sheet. The mockups now keep proposed authenticated chat actions, polls, and predictions separate from source-current guest Watch stories. Browse filters and channel alerts have separate state. A form sheet no longer contains unrelated quality choices.

Storybook's TypeScript 5 parser dependencies are nested under its framework package. The mobile TypeScript 6 compiler and production React Native dependencies retain their existing versions. Full `npm ls --all` still reports the pre-existing Expo optional-peer mismatch: the locked `@expo/metro-runtime` 57.0.14 is below `@expo/router-server`'s requested ^57.0.15. This task does not change that production dependency.

The static build reports normal large-chunk warnings for Storybook and axe. Vite leaves the static Inter URL for runtime resolution; the font is included in the static directory and loaded successfully in the browser. Architecture tests briefly create an intentionally invalid story import, which can interrupt a concurrently running development catalog; the fixture is removed afterward and final render checks pass.

GPT-5.6 reviewed the catalog and research, and GPT-6.1 implemented the changes and checked rendered behavior. The configured GPT-6 worker was unavailable and a different-family reviewer was unavailable in this harness. No scoped comment removal or suppression was required.

Android Back, TalkBack, keyboard resizing, native sheet gestures, system PiP, concurrent playback capacity, and provider-backed outcomes remain unverified on a device. The new sheets support explicit close, backdrop dismissal and Android `onRequestClose`; drag detents are not implemented. Browser Storybook is isolated from the production Expo entry.
