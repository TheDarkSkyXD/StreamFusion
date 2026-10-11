# Candidate B: task-first layers

## Problem

StreamFusion already has a coherent dark design system, 23 covered shell routes, 16 settings categories, and shared rows, tabs, sheets, and controls. The remaining usability problem is hierarchy. Search is the initial destination even though the existing Watch root is the Home discovery feed. A 64 px shell header exposes Settings and Accounts on nearly every route. Search and category filters occupy several chip rows. Watch gives five player tools and engagement the same visual weight as chat. Settings presents common and technical controls at one level. The Twitch references show a useful interaction pattern without supplying StreamFusion's visual identity: stable primary navigation, compact context at the top, and secondary choices in overlays or deeper screens. This proposal keeps StreamFusion's palette and provider accents while applying that pattern.

This is a source design. The Twitch observations come from `twitch-home.png`, `twitch-settings.png`, `twitch-preferences.png`, `twitch-filters.png`, and `twitch-watch.png`. No StreamFusion runtime behavior is claimed here.

## Usage (caller's view)

The public interaction stays intent based. Feature sessions, navigation actions, filter models, and Watch runtime props remain unchanged.

```tsx
// AppShell: Home becomes the first tab and shell chrome follows route intent.
<MobileAppBar
  title={header.title}
  backAction={showsBack ? { label: "Back", onPress: goBack } : undefined}
  actions={routeActions(location)}
/>
<PrimaryNavigation state={navigation} dispatch={dispatch} />
```

`routeActions` returns no global actions for Home, Search, Following, or Activity. Settings and Connected Accounts become rows in More. A detail route may add one relevant action. Watch keeps owning its player chrome. `PrimaryNavigation` keeps its current `state` and `dispatch` props; only destination order and the initial destination change.

```tsx
// SearchFilters: existing caller signature is preserved.
<SearchFilters
  liveOnly={liveOnly}
  platform={platform}
  tab={tab}
  onSelectTab={setTab}
  onSelectPlatform={setPlatform}
  onToggleLiveOnly={() => setLiveOnly((value) => !value)}
/>
```

The component keeps result-type tabs inline. Platform and Live move behind one `MobileFilterTrigger`, which reports the active count and opens a `MobileFilterSheet`. `CategoryFilterBar` makes the same internal change while preserving `identity` and `onChange`.

```tsx
// WatchScreen: current runtime and action props are preserved.
<WatchActionBar
  primaryActions={[qualityAction, fullscreenAction]}
  overflowActions={[captionsAction, mediaAction, engagementAction, statsAction]}
/>
<WatchTabs {...existingWatchTabsProps} />
```

The two frequent playback actions remain beside the player. Available secondary actions use one overflow sheet. Chat remains the default under-player region and its composer uses the shared sticky composer layout.

```tsx
// Settings panels: keep SettingsSelect and SettingsSwitch call sites.
<SettingsSection title="PLAYBACK" testID="panel-playback">
  <SettingsSelect {...qualityProps} />
  <SettingsDisclosure title="Advanced playback">
    <SettingsSelect {...tokenPlayerProps} />
    <SettingsSwitch {...hevcProps} />
  </SettingsDisclosure>
</SettingsSection>
```

## Shape

### Interaction model

Each screen gets three levels of action:

1. The screen's main task stays visible. Home shows live content, Search shows the field and result tabs, Watch shows playback and chat, and Settings shows category rows.
2. Context changes stay one tap away. Platform, language, sort, and Live filters use a filter sheet. Common settings use normal rows.
3. Technical, destructive, or infrequent actions use disclosure sections or overflow sheets. They remain searchable and accessible.

The rule is encoded in small presentation types instead of copied layout decisions:

```ts
export type MobileAction = Readonly<{
  id: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  selected?: boolean;
  detail?: string;
  testID?: string;
}>;

export type MobileAppBarProps = Readonly<{
  title: string;
  summary?: string;
  backAction?: Pick<MobileAction, "label" | "onPress" | "testID">;
  actions?: readonly MobileAction[];
}>;

export type MobileFilterSection<T extends string> = Readonly<{
  id: string;
  label: string;
  value: T;
  options: readonly Readonly<{ label: string; value: T }>[];
  onChange: (value: T) => void;
}>;

export type MobileFilterSheetProps = Readonly<{
  title: string;
  sections: readonly MobileFilterSection<string>[];
  toggles?: readonly Readonly<{
    id: string;
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }>[];
  onReset?: () => void;
  testID?: string;
}>;

export type MobileDisclosureSectionProps = Readonly<{
  title: string;
  summary?: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  testID?: string;
}>;
```

`MobileFilterSheet` owns its open state only when composed by `MobileFilterTrigger`; feature state remains with Search or `CategoryRequestIdentity`. Dismissing and reopening cannot lose a selection because the sheet has no second filter model. This keeps one source of truth. It also keeps provider and transport types out of `src/design`.

`MobileAction` is the common presentation contract for app bars, Watch overflow, and row menus. It does not own navigation or business policy. Feature callers decide which actions exist and pass closures. The design layer decides touch targets, accessible state, layout, and sheet behavior. This is a deeper interface than another styled button because it hides action presentation across compact and wide layouts behind one data shape.

### Targeted behavior

- **Shell and navigation.** Order destinations as Home, Following, Search, Activity, More and initialize at Home. Keep destination ids, histories, restoration format, reducer actions, and the phone versus rail breakpoint. Remove Settings and Accounts from the default `ShellHeader`; expose them in More, where their routes already live. Standard and detail routes use `MobileAppBar`. Watch remains immersive.
- **Discovery.** Keep Search/Categories and content-type tabs inline because they change the body. Move platform and Live into a filter sheet. In category detail, keep the content tab inline and put platform, language, tag, sort, and clip time in one sheet. The trigger shows `Filters` plus a count; applied values appear as removable summary chips only when non-default.
- **Home and content lists.** Keep the existing featured stage and stream cards. Rename the supporting line from a system-status sentence such as "Live across Twitch and Kick" to useful section context or omit it when both providers are healthy. Provider failures stay visible near the affected list through the existing banner.
- **Watch and chat.** Preserve the player, compact channel identity, Follow, and stream title. Keep Quality and Fullscreen visible. Move captions, download or recording, polls and predictions, playback speed, stats, and other tools into one overflow sheet. Chat remains the default region. Replace the separate text input plus Emotes and Send button row with a `MobileComposer` that keeps input and two icon actions in one sticky dock. Message actions continue using the current bottom sheet and moderation callbacks.
- **Settings.** Keep the current category ids, session, search, extras map, and direct detail routes. Use the app bar for category back navigation so a settings detail has one header. Preserve section groups in the hub. Within panels, keep routine choices visible and collapse codec, buffer tuning, diagnostics, token details, and effective-state copy under labeled disclosures. Search indexes hidden rows and opens the correct panel with the matching disclosure expanded.
- **Remaining routes.** Activity, history, downloads, accounts, moderation, multistream, channel detail, and diagnostics adopt `MobileAppBar`, `MobileAction`, and `MobileDisclosureSection` where they already expose headers, row menus, or technical detail. Their controllers and capability contracts do not change.

### Module map

```text
apps/mobile/src/design/
  app-bar.tsx                 # title, back action, compact actions
  action-menu.tsx             # MobileAction rows in MobileBottomSheet
  filter-sheet.tsx            # controlled filter sections and reset action
  filter-trigger.tsx          # active count and optional applied summaries
  disclosure-section.tsx      # accessible expand/collapse for secondary content
  composer.tsx                # sticky multiline input with leading/trailing actions

apps/mobile/src/features/shell/
  domain/shell-navigation.ts  # reorder destinations; initial destination is watch/Home
  components/app-shell.tsx    # route-aware app bar; no global Settings/Accounts buttons

apps/mobile/src/features/discovery/components/
  search-filters.tsx          # inline result tabs plus controlled filter sheet
  category-filter-bar.tsx     # one trigger/sheet, same identity/onChange API
  unified-search-screen.tsx   # place filter trigger below the search field
  home-live-discovery-screen.tsx # remove redundant healthy-provider status copy

apps/mobile/src/features/watch/components/
  watch-action-bar.tsx        # visible primary actions plus MobileAction overflow
  watch-screen.tsx            # preserve props; compose action hierarchy
  watch-tabs.tsx              # preserve props and default chat behavior

apps/mobile/src/features/chat/components/
  chat-panel.tsx              # preserve props; adopt MobileComposer

apps/mobile/src/features/settings/components/
  settings-workspace.tsx      # one app bar and disclosure-aware search destination
  settings-controls.tsx       # SettingsDisclosure wrapper
  settings-panels.tsx         # common rows first, advanced rows disclosed
```

No domain, capability, adapter, persistence, or composition module needs a new dependency. `src/design` imports React Native and design tokens only. Features import the shared components. AppShell continues to translate route state into presentation.

## Observed and source-backed issues

- Twitch Home makes Home the first navigation item and gives the feed most of the viewport. StreamFusion defines destination order as Search, Following, Home, Activity, More and initializes to Search in `shell-navigation.ts` (`SHELL_DESTINATIONS`, line 116; `createInitialShellNavigationState`, line 330), although the existing Home discovery screen already lives at the Watch root.
- Twitch Settings puts global categories in one list and gives each detail screen one back header. StreamFusion's shell header includes Settings and Accounts actions on standard routes (`app-shell.tsx`, `ShellHeader`, line 713), while `SettingsCategoryDetail` adds another back/header row (`settings-workspace.tsx`, line 184).
- Twitch keeps content tabs visible but moves sort and tag controls into an overlay in `twitch-filters.png`. StreamFusion Search renders two horizontal chip rows (`search-filters.tsx`, line 19). Category detail can render four or five full chip groups (`category-filter-bar.tsx`, line 20).
- Twitch Watch keeps playback, channel actions, chat, and the composer in the primary flow in `twitch-watch.png`. StreamFusion renders five equal player-tool buttons, then an optional full-width engagement button, before `WatchTabs` (`watch-screen.tsx`, `WatchScreen`, line 110; `WatchTabs` call, line 554). This source order gives infrequent actions space before chat.
- StreamFusion Chat renders a multiline field followed by a separate wrapped action row (`chat-panel.tsx`, `TextInput`, line 535). The Twitch reference uses one bottom composer dock, which keeps the message action at the thumb edge without another vertical block.
- The settings panel API already has good controlled inputs, but panels mix ordinary preferences with token-player, codec, device id, buffer tuning, and effective-state text in a single card. The existing `SettingsSelect` contract at `settings-controls.tsx` line 92 can stay intact while disclosures change information order.

## Synthesis decision

This is Candidate B for later synthesis. Its distinguishing choice is progressive disclosure backed by a shared action model. It does not treat the task as a control restyle or a Twitch visual reskin.

## Tradeoffs accepted

- We accept one extra tap for platform, sort, language, and advanced settings in exchange for shorter first views and a clearer primary task.
- We accept a small shared `MobileAction` data contract in exchange for consistent app-bar, overflow-sheet, and composer action behavior.
- We accept changing the default destination to Home in exchange for making the existing discovery feed the app's entry point. Stored navigation restoration remains authoritative for returning users.
- We accept keeping feature-specific filter adapters in Discovery in exchange for preventing `src/design` from learning provider or category domain types.

## Alternatives considered

- **Restyle existing controls in place.** Larger type, spacing, and contrast would preserve every layout, but it would leave filters, player tools, and technical settings competing with primary tasks. The interface stays simple for implementers and exposes the full complexity to users.
- **One universal screen schema.** A schema describing headers, filters, sections, rows, sheets, and actions could generate most screens. It would expose many optional fields, hide little feature complexity, and make Watch, moderation, and multistream harder to trace.
- **Copy Twitch's navigation and light settings pages.** This would reduce visual comparison differences but conflict with StreamFusion's dark design system, platform-color rules, and feature set. Twitch's central Create action and Profile destination do not map to StreamFusion's main tasks.

## Open questions and risks

- Should Home become the default only for new or unrestored sessions, as proposed, or should an app update reset existing restored destinations too?
- Which Watch actions qualify for the two visible slots when a device lacks fullscreen or quality selection?
- Should settings search expand the matched advanced section automatically, or show a short in-panel match banner that the user opens?
- Do TalkBack and large-font checks support the active-filter count in the trigger label without duplicating every applied value?

## Next implementation step

Build and story-test `MobileAppBar`, `MobileActionMenu`, `MobileFilterTrigger`, `MobileFilterSheet`, `MobileDisclosureSection`, and `MobileComposer`, then migrate AppShell and Discovery before changing Watch or Settings.
