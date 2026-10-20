# Desktop and mobile UI audit

Audit baseline: `a34e99837e8d6d4a507249f84764558e419fa19d`. Scope covers the Electron desktop app and the native Android app. The desktop client supplies the outcome reference. Mobile changes preserve its existing Android navigation and dark design system.

## Evidence and limits

The audit combines independent desktop and mobile source reads with local app checks. Electron runs through the repository's checked development launcher with an isolated profile. Initial Android checks used the existing API 36 emulator. Final cold-launch checks used the existing API 30 AVD `SF_Mobile_UI_20261005` on `emulator-5582`, with development package `com.thedarkskyxd.streamfusion.dev`. Production services, signed-in provider writes, and release channels are outside this audit.

Local evidence lives under `.scratch/ui-ux-audit-20261019/` and `.scratch/verify-streamfusion/evidence/`. Desktop baseline checks use run `mobile-desktop-audit-ready-20261019`; the final checked launch uses `mobile-audit-final-20261019`. Screenshots are review artifacts, not application assets. `decisions.tsv` records the choices and their evidence. Provider content and counts are observations from the run and can change.

Verification moved to a separate existing AVD after the shared API 36 emulator opened an unrelated Google setup screen. Later captures from that shared device are excluded. The capture helper now rejects a foreground mismatch or failed hierarchy dump instead of reusing stale evidence. The API 30 run uses the existing native development APK with current Metro JavaScript. An optional native rebuild stopped because `JAVA_HOME` was unset. Native source and dependencies did not change; a fresh native build is not part of the passing checks.

Source inspection establishes wiring and limits. A unit test establishes only the behavior it exercises. Neither establishes live playback, TalkBack usability, resource consumption, or compatibility across Android versions. The verification table below distinguishes these checks.

## Findings and changes

| Priority | Finding | User impact | Disposition |
| --- | --- | --- | --- |
| P1 | Search category results are inert and their full-width artwork hides the title. | A category can be found but cannot be opened from its result. One cover occupies most of a phone screen. | Compact, labeled result buttons open category detail inside Search. |
| P1 | Category and download drilldowns change the primary destination. | Back reaches More or Activity instead of the page that opened the detail. | Search and Following own their category routes. Downloads owns a job detail route in More. Existing screen implementations are reused. |
| P2 | Following and Downloads discard presentation state when their detail screen closes. | Users must reselect the content tab, provider, filter, and query. | Typed presentation state survives the detail-screen round trip. Search retains its existing restoration mechanism. |
| P1 | Empty Watch does not reach the reducer's Back behavior. | Android leaves the task instead of returning to the prior destination. | Watch root is a navigable return destination, including without active playback. |
| P1 | Live discovery stops at its first page. | Users cannot reach streams beyond the initial read. | Independent provider pages, identity deduplication, loading feedback, and provider-specific continuation retries. Pull refresh starts at page one. |
| P2 | Channel Home's live card has no action. | The prominent stream card does nothing although the header Watch action works. | The card opens Watch with the same stream target. |
| P1 | Search placeholders use disabled-text contrast. | Empty Search, discovery, Following, and settings fields are difficult to read. | Shared text-field defaults supply the readable secondary-text color. Disabled-state colors retain their separate purpose. |
| P1 | Resume playback does not govern restored startup. | The switch does not establish the behavior it promises. Watch's ordinary entry effect can start a restored route regardless of the preference. | Enabled playback starts the saved stream or recording on reopen. Disabled playback waits for Watch now. Recorded playback uses saved History progress. Restore session must be enabled. |
| P1 | Generated display-language catalogs lack three player navigation labels. | The checked desktop launch fails typecheck before Electron opens. | Regenerated the missing entries in 48 catalogs. Corrected French player terminology during review. All 50 catalogs pass structural validation. Machine translations still need language review. |

P1 means a significant task or accessibility problem. P2 means a usable workaround exists. No production outage or data-loss finding was established.

The navigation fix follows the existing destination-owned channel-detail pattern. It adds typed route variants instead of adding a second global return stack. The list fix uses TanStack Query's infinite queries and keeps FlatList virtualization. It does not create a second cache or retain duplicated stream cards.

The SuperDev principles that changed the implementation were Model the Domain, which kept navigation ownership in the typed route registry, and Prove It Works, which required real Electron and emulator observations. Test Behavior, Not Implementation required button presses, restored presentation, unique next-page cards, and recorded seek outcomes in the focused tests.

The execution checkpoint used four constraints:

- Blocking first steps were app-entry inspection, pre-change reproduction, and failing tests.
- Independent workstreams owned separate source areas for localization, mobile navigation, live-feed paging, and placeholder contrast.
- Shared mutable state had one writer. The navigation owner also implemented startup restoration. Other workers did not edit AppShell.
- The smallest safe decomposition reused existing route, query, and field models. A separate architecture comparison was skipped because those existing interfaces determined placement and the change did not introduce a new persistence model.

## Journey comparison

| Journey | Desktop | Android | Assessment |
| --- | --- | --- | --- |
| Entry and navigation | Home, Following, Categories, MultiView, History, Downloads, and Settings. | Search, Following, Watch, Activity, and More; rail at expanded widths. | Different organization is intentional. Destination-local Back is required on both. |
| Search | Unified results and platform filters; channels, streams, categories, videos, and clips. | Unified results, provider and live filters, history, and paged result types. | Category-result opening was a missing interaction, now wired. |
| Category browsing | Combined provider directory and category detail with live and recorded tabs. | Popular and followed categories, filters, detail, and paged live streams. | Kick category recorded media remains unavailable on mobile. |
| Channel | Profile, live stream, videos, and clips. | Profile, live stream, videos, clips, follow and alert controls. | Live-card action fixed. Channel recorded lists still have no continuation. |
| Watch | Live and recorded players, chat, captions, mini player, download and recording tools. | Media3 player, chat, captions, full screen, mini player, Android PiP, media tools. | Startup now respects Resume playback and Restore session. Live cold launches passed with resume on and off. Recording position restoration passed focused tests. |
| Following | Local and account follows, live and recorded content. | Guest and account follows, content tabs and provider filters. | Drilldown ownership and filter restoration fixed. Account writes were not exercised. |
| Activity | Notifications and live-alert entry. | Virtualized Activity list, unread actions, detail, and native notification entry. | Source coverage is substantial. Notification scheduling and delivery were not retested. |
| History | Saved history and recorded progress. | Local history, filtering, recorded progress, resume and restart actions. | Existing outcome parity. Deletion and durable data mutations were not exercised. |
| Downloads | Job list, progress, controls, and artifact actions. | Downloads and recordings with job detail and native artifact actions. | Detail returns to Downloads and restores filters. A new real download was not started. |
| MultiView | Grid and focus layouts, audio ownership, per-channel and merged chat. | Responsive grid, audio ownership, per-stream actions, per-channel and merged chat. | Focus layout remains a mobile design decision. |
| Settings | Searchable groups and platform-specific options. | Searchable groups, display language, playback, chat, notifications, connectivity, and support. | Dark-only and native-player-only limits are explicit. Density has limited scope. |

## Remaining work

### P1: Kick category recordings and clip downloads

`apps/mobile/src/features/discovery/domain/category-detail.ts` explicitly reports `kick-clips-unsupported` and `kick-videos-unsupported`. The relay's `kick-official-category-media.ts` also reports unsupported operations. Desktop's Kick playback adapter has category media reads. Mobile's `watch-download.ts` separately rejects Kick clip downloads.

These are real outcome gaps. Enabling a tab or removing the unavailable message would not implement the provider read, playable source, or recoverable media job. They need a supported mobile provider path and full playback or download proof. This audit does not change or deploy the relay.

### P2: Channel video and clip continuation

`apps/mobile/src/features/discovery/components/use-channel-detail.ts` issues one read for each recorded lane. `channel-detail-media.tsx` renders those items without a next-page action. Provider contracts carry cursors, but those screens do not use them. This remains separate from Home live continuation.

### P2: MultiView focus layout

`apps/mobile/src/features/multistream/components/multistream-workspace.tsx` keeps players in a responsive grid. Its Listen action controls audio. Desktop exposes a separate focus layout. A mobile version needs a decision about the main player, secondary-player strip, orientation, and chat space. Audio focus must retain its current meaning.

### P2: Settings density scope

Mobile's density preference changes spacing in the settings workspace. It does not establish compact or comfortable layouts throughout discovery, Following, or Watch. The setting needs an honest scope or a product-wide implementation before it promises global density.

### P2: Reduced-motion coverage

The inspected mobile haptic helper reads the system preference, but the chat bottom sheet's spring and dismiss animation do not consult it. Motion behavior needs a focused native check with system animations disabled. No motion-sensitive user-flow pass was claimed.

## Accessibility, layout, and performance

The mobile primitives expose labels, roles, selected states, and 48 dp minimum controls. Section tabs scroll horizontally. The shell uses safe-area and keyboard insets and changes to a rail at 600 dp. Inspected Text and TextInput components retain Android font scaling.

The original placeholder pair `#666666` over `#252525` measures about 2.67:1 with axe-core's color calculation. The replacement uses `#a0a0a0`. This addresses active field hints without treating disabled controls as normal text. A full contrast audit of every provider-supplied badge, chat color, and image overlay remains outside this result.

Home, Search, and Activity use virtualized lists. The Home change retains virtualization and deduplicates by platform plus stream identity. No CPU, GPU, startup-time, memory, frame-rate, or bundle-size improvement is claimed. Long unvirtualized channel-media and Downloads screens deserve measurement before their content limits increase.

The dark palette and provider accents remain coherent across both apps. Dark-only mobile appearance is a declared product limit, not a broken theme switch. Desktop uses its own compact controls; Android uses touch-sized shared primitives. New mobile category rows use fixed-size cover art with flexible text, rather than a screen-sized cover.

Provisional source-and-flow rubric, scored 0 to 4 per dimension:

| App | Accessibility | Performance structure | Appearance | Navigation and platform behavior | Adaptivity |
| --- | --- | --- | --- | --- | --- |
| Desktop | 3 | 3 | 3 | 3 | 3 |
| Android before changes | 2 | 3 | 3 | 2 | 2 |
| Android after source changes | 3 | 3 | 3 | 3 | 3 |

These are heuristic review grades, not a WCAG certification or benchmark. TalkBack, large-font and expanded-window checks must be read from the verification record, not inferred from these grades.

## Verification record

| Check | Evidence | Result |
| --- | --- | --- |
| Desktop launch baseline | `launch.log` in the first `mobile-desktop-audit-20261019` run | Failed on missing generated labels before changes. |
| Catalog red and green | `i18n-catalogs-red.log`, `i18n-catalogs-green.log` | Missing entries reproduced; 50 complete catalogs after repair. |
| Desktop checked launch and database | `launch.log`, doctor output, `database.json` in `mobile-desktop-audit-ready-20261019` | Healthy real renderer, preload bridge, process identity, and isolated SQLite database. |
| Desktop journeys | `desktop-home-before`, `desktop-categories-loaded`, `desktop-detail-settled`, `desktop-search-results`, `desktop-following`, `desktop-multistream`, `desktop-history`, `desktop-downloads`, `desktop-settings` snapshots | Local screens opened. Signed-in writes, a new download, moderation, and full keyboard traversal were not exercised. |
| Mobile category baseline | `mobile-category-inert-before.png` | Tap leaves Search unchanged; artwork hides the title. |
| Mobile Home baseline | `mobile-home-end-before.txt`, `mobile-home-end-before.png` | Repeated end scrolling reaches the same final card with no continuation action. |
| Navigation and interactions | `mobile-interactions-red.log`, `mobile-presentation-red.log`, `mobile-following-presentation-red.log`, `mobile-interactions-green.log` | Failing behaviors observed before implementation; 79 focused checks green. |
| Discovery | Home and adapter behavior tests | 220 tests green, including unique continuation items, failed-page retention, repeated cursor termination, and first-page refresh. |
| Mobile category round trip | `mobile-category-after`, `mobile-category-open-verified`, `mobile-category-back-verified` | Compact category results open detail in Search; Back retains the query and category tab. |
| Mobile Home continuation | `mobile-home-more-after` XML and screenshot | Scrolling reaches additional unique live cards beyond the baseline's final card. |
| Mobile channel live card | `isolated-xqc-profile`, `isolated-card-watch` | Pressing the channel Home card opens Watch. |
| Resume enabled, cold launch | `isolated-resume-enabled`, `isolated-cold-resume-on-ready` | Force-stop and MAIN relaunch starts the saved xQc stream without a tap. Real video and Pause control observed. |
| Resume disabled, cold launch | `isolated-resume-disabled`, `isolated-off-target-selected`, `isolated-off-saved-target`, `isolated-manual-watch-start` | Force-stop and MAIN relaunch keeps TheBurntPeanut ready behind Watch now, with no native player. Pressing Watch now starts playback. |
| Resume from another destination | `isolated-final-more-before-cold`, `isolated-final-more-resumed-ready`, `isolated-fixed-mini-cold` | Final check found resumed playback without a visible mini player on More. Shell presentation now updates when a session becomes active or is replaced. The failing real-session test and fixed cold launch confirm the correction. |
| Startup race and recorded seek | `watch-startup-session.test.ts`, `shell-startup-playback.test.ts` | Saved recording position, disabled restoration, external-link precedence, and cancellation during pending History or session start pass. A real recorded-media cold launch remains unverified. |
| Placeholder contrast | `search-placeholder-contrast.test.ts` | Rendered active field hint changed from about 2.67:1 to 5.86:1. |
| Full mobile suite | `mobile-final-test.log` | 60 Node infrastructure checks and 1,369 tests in 222 Vitest files pass after the mini-player fix. Feature architecture import proof passes. |
| Workspace typecheck and mobile lint | `workspace-final-typecheck.log`, `mobile-final-lint.log`, `settings-final-copy.log` | All workspace typechecks and mobile lint pass. Final wording check passes 11 settings tests. |
| Final Electron launch | `desktop-final-launch.json`, final run doctor output | Checked startup passes, one owned Electron main process, real renderer and preload bridge healthy, no uncaught errors. |
| Final Android restart | `isolated-latest-ready-settled`, `resume-from-more.mp4` | Restarted the owned emulator after the final code change. The current app opens on More with the saved stream visible in the mini player. Restore session and Resume playback remain enabled. |

The More screen was inspected at Android font scale 1.3. Its rows wrap and remain scrollable; bottom-navigation labels become crowded. This is a limited screen check, not an app-wide large-font pass. The attempted system landscape rotation left the app in portrait, so landscape and expanded-window behavior remain unverified. The original font and rotation settings were restored. Evidence is `isolated-large-font-more` and `isolated-landscape-more`.

TalkBack, disabled-system-animation behavior, and all supported Android versions remain unverified in the final runtime pass. Following and Downloads presentation retention passed behavior tests; a new live download and signed-in account writes were not exercised.

One source finding was rejected after the live check. Desktop Categories keeps `aria-current="page"` on category detail. The audit does not report that as a defect. The current renderer and its route behavior take precedence over an isolated source interpretation.
