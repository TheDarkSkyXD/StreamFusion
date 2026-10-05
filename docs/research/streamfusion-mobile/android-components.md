# Desktop and Android component comparison

Reviewed against current source on October 5, 2026. This inventory describes wired UI and missing workflows. It does not establish native playback capacity or Android outcome qualification. The previous `coverage-matrix.md` contains stale Settings claims, including Multiview. Current route and category registries take precedence.

## Current UI and missing outcomes

Desktop routes are registered in `apps/desktop/src/frontend/routes/router.tsx`. Android routes are registered in `apps/mobile/src/features/shell/domain/shell-navigation.ts`. Android Settings categories are registered in `apps/mobile/src/features/settings/domain/settings-categories.ts`.

In the evidence column, `D` means `apps/desktop/src/frontend/features/` and `M` means `apps/mobile/src/features/`.

| Area | Android status | Android adaptation and catalog | Evidence |
| --- | --- | --- | --- |
| Shell | Current | Five bottom destinations, a rail above compact width, More for infrequent destinations | `D/shell/components/layout/AppLayout.tsx`, `M/shell/components/app-shell.tsx` |
| Home | Current inside empty Watch | Featured stream and live cards | `D/discovery/components/screens/Home/index.tsx`, `M/discovery/components/home-live-discovery-screen.tsx` |
| Search | Current | Search field, sibling result tabs, platform filters, filter sheet | `D/discovery/components/screens/SearchResults/index.tsx`, `M/discovery/components/unified-search-screen.tsx` |
| Categories and detail | Current | Portrait category cards, detail tabs, follow and filter controls | `D/discovery/components/screens/CategoryDetail/index.tsx`, `M/discovery/components/category-detail-screen.tsx` |
| Channel | Current | Channel header, Home/Videos/Clips tabs, follow and live alert controls | `M/discovery/components/channel-detail-screen.tsx` |
| Following | Partial | Guest Follow list, local add/remove and live alerts. Account-follow import remains unavailable | `D/discovery/components/screens/Following/index.tsx`, `M/follows/components/following-manage-screen.tsx` |
| Live/VOD/clip | Current with provider and host limits | Focused Watch, quality sheet, seek controls, fullscreen and floating player | `D/playback/components/screens/Stream/index.tsx`, `M/watch/components/watch-screen.tsx`, `player-controls.tsx` |
| Extra player tools | Missing | Proposed speed, stats, and focused viewing controls belong in player settings or an action sheet | `D/playback/components/player/`, `M/watch/components/player-controls.tsx` |
| Live chat | Read-only guest feed | Proposed composer, user action sheet, reply/mention actions and touch emote picker | `D/chat/components/chat/ChatInput.tsx`, `M/chat/capabilities/watch-chat.ts` |
| Chat replay | Missing | Proposed Comments pane synchronized to a recorded position. Current UI discloses unavailable comments | `D/chat/components/chat-replay/`, `M/chat/capabilities/watch-chat.ts` |
| Emotes and cosmetics | Preferences only | Proposed emote sheet with search and provider groups. Artwork placeholders are labeled | `D/chat/components/chat/EmotePickerPopover.tsx`, `M/settings/components/chat-settings-panel.tsx` |
| Predictions and polls | Preferences only | Proposed participation sheets with choices and explicit submit | `D/chat/components/chat/PredictionBanner.tsx`, `M/settings/domain/prediction-preferences.ts` |
| Moderation | Placeholder | Proposed channel workspace, one tool per screen, user history/action sheets and destructive dialogs | `D/moderation/components/screens/Mod/`, `M/shell/components/app-shell.tsx` |
| Multistream | Missing | Proposed adaptive stream slots, add-stream sheet, one audio owner, merged chat and constrained-device state | `D/multistream/components/screens/MultiStream/index.tsx`; no mobile feature or route |
| History | Current | Searchable resume rows and clear confirmation | `D/media-library/components/screens/History/index.tsx`, `M/media-library/components/history-screen.tsx` |
| Downloads and jobs | Current UI with outcome gaps | Download list, progress, pause/resume/cancel, job details. Duplicate confirmation is proposed | `D/media-library/components/screens/Downloads/index.tsx`, `M/media-jobs/components/downloads-screen.tsx` |
| Recording | Current controls and job model | Recording bar, stop confirmation, proposed recovery dialog. Device lifecycle proof remains separate | `D/media-library/components/recording/`, `M/watch/components/watch-recording-bar.tsx` |
| Captions | No current user control | Proposed active caption display and model install/progress management. Diagnostics fixtures do not prove live availability | `D/playback/components/player/caption-overlay.tsx`, `M/watch/components/watch-caption-bar.tsx` |
| Activity | Current | Persistent inbox, filters, alert/job details, dismissal and clear actions | `M/activity/components/activity-screen.tsx`, `M/notifications/components/in-app-notification-banner.tsx` |
| Accounts | Current account UI | Platform connection cards, pending authorization, expiry and disconnect confirmation | `D/auth/components/auth/`, `M/auth/components/twitch-accounts-panel.tsx`, `kick-account-card.tsx` |
| Settings | Current hub and 16 sections | Focused detail screens, select sheets, switches, labeled fields and confirmations | `D/settings/components/screens/Settings/index.tsx`, `M/settings/components/settings-workspace.tsx` |
| Ad blocking | Native client requirement | Distinguish native interception from Expo Go availability and playlist-proxy preferences | `M/ad-blocking/components/adblock-settings-workspace.tsx` |
| Connectivity | Current | Offline/checking banner, proxy form and probe feedback | `M/connectivity/components/proxy-settings-panel.tsx`, `apps/mobile/src/design/connectivity-banner.tsx` |
| Support | Current UI | Diagnostics, redacted log/report preview, release page and maintenance confirmations | `M/settings/components/support-settings-panels.tsx`, `M/diagnostics/components/diagnostics-workspace.tsx` |

The nested Search result and Following channel preview routes currently contain generic route-preview content. Their catalog mockups show a proposed substantive detail layout. All screen stories use local fixtures, including those that correspond to current routes.

## Translate desktop controls into Android controls

| Desktop pattern | Mobile pattern | Catalog implementation |
| --- | --- | --- |
| Sidebar and top navigation | Bottom bar and adaptive rail | `PreviewFrame`, AdaptiveNavigation story |
| Dropdown/select | Short modal selection sheet | Existing `MobileSelect`, selection and long-list stories |
| Popover with a task or options | Scrollable modal sheet with close action | New `MobileBottomSheet` |
| Hover tooltip/user popout | Labeled control or user detail/action sheet | UserActionsSheet and UserHistorySheet stories |
| Destructive dialog/inline confirmation | Explicit confirmation dialog | New `MobileDialog` |
| Context menu | Touch action sheet with 48 dp rows | New `MobileListRow` |
| Toast | Snackbar with explicit action | New `MobileSnackbar` |
| Compact switch row | Labeled switch with description | New `MobileSwitchRow` |
| Radio group | Full-row radio choices | New `MobileChoiceGroup` |
| Text input | Label, hint, validation and secure/multiline states | New `MobileTextField` |
| Progress/skeleton/spinner | Accessible progress, calm skeleton, named spinner | New `feedback.tsx` components |
| Scroll area | Native scroll view and pull-to-refresh | Existing `MobileRefreshableScroll` |
| Small icon target | At least 48 dp, with visible pressed/selected state | New `MobileIconButton` |
| Stream/media/avatar cards | Native presentation cards and fallbacks | Catalog card and player stories |
| Dense moderation dock | Focused tool screen with channel context | Proposed moderation stories |

Android's [navigation guidance](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns) recommends three to five peer destinations in a navigation bar, a rail on larger windows, and tabs for sibling content. The catalog preserves the app's five destinations and uses its existing compact-width token.

Android's [accessibility guidance](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility) specifies 48 dp targets, text contrast of at least 4.5:1, labels for meaningful icons, and alternatives to gesture-only actions. Sheets and dialogs have explicit close/cancel actions. Radio choices expose checked state. Existing inactive tab labels now use the secondary text token, and tabs have a 48 dp minimum width.

Android's [bottom-sheet guidance](https://developer.android.com/develop/ui/compose/components/bottom-sheets) informs the modal sheet behavior. The React Native implementation uses safe-area padding, a scrollable body, an optional fixed footer, keyboard avoidance, backdrop dismissal, and `onRequestClose` for Android Back. It uses immediate transitions to avoid imposing animation on reduced-motion users. Dragging and detent transitions are outside this catalog implementation.

Android's [dialog guidance](https://developer.android.com/develop/ui/compose/components/dialog) informs interruptive confirmations. The [edge-to-edge guidance](https://developer.android.com/design/ui/mobile/guides/layout-and-content/edge-to-edge) informs system inset handling. The [adaptive layout guidance](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts) informs wide Watch with video and supporting chat. Browser resizing does not simulate a hinge or Android lifecycle.

These sources describe Android behavior. The app remains React Native; Compose APIs are not added. StreamFusion's palette and neutral selection states remain governed by `DESIGN.md`.

## Catalog architecture and tradeoffs

The [official React Native Web Storybook framework](https://storybook.js.org/docs/get-started/frameworks/react-native-web-vite) renders the same React Native presentation components in the browser. It provides a reviewable static build and phone/tablet viewports.

The alternative is shared stories with an on-device Storybook entry. The [native setup documentation](https://storybookjs.github.io/react-native/docs/intro/getting-started/) requires Metro and entry integration. Registry metadata inspected for native Storybook 10.5.4 and 10.6.0 requires `react-native-safe-area-context` 5.8.0, while this app pins 5.7.0. Native 10.5.10 is unpublished. This run chooses the isolated browser catalog rather than combining a native dependency upgrade with mockup work.

`.storybook` owns browser wiring, safe-area fixtures, and the haptics adapter. `src/design` owns reusable presentation components. `src/features/design-preview/components` owns mockup fixtures and screen presentation. `domain/story-coverage.ts` maps source inventory to built story IDs. Production imports of stories, previews, and Storybook configuration are blocked by ESLint and exercised by the architecture verifier.

Model the Domain shaped the explicit route-to-story mapping. Prove It Works shaped the built-index coverage check and browser render/accessibility audit. The audit checks rendered stories, not source-file counts. Verification results and remaining native limits are in `component-verification.md`.

## Recommended implementation order

1. Use the shared sheets, dialogs, rows, fields, and feedback in production screens as those screens change.
2. Define authenticated chat send, eligibility, emote parsing, and replay capabilities before wiring the proposed chat UI.
3. Implement provider-specific moderation capabilities and verified-role checks before exposing the proposed tools.
4. Qualify native concurrent workloads before implementing multistream admission.
5. Connect caption controls to actual model availability and native sessions before promoting caption stories to product UI.

These are follow-up product implementations. The current deliverable is the comparison, reusable controls, and interactive mockups.
