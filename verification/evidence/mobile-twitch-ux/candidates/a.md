# Candidate A: improve the shared presentation layer

## Problem and evidence

StreamFusion already has reusable mobile controls, custom navigation, feature-owned state, and provider-neutral contracts. Improve the screens through those controls and a small set of feature edits. Preserve the dark neutral identity in `DESIGN.md`, the existing destination IDs, session contracts, and Android playback behavior.

I viewed `twitch-home.png`, `twitch-settings.png`, `twitch-preferences.png`, `twitch-filters.png`, and `twitch-watch.png`. These are screenshot observations, not evidence of Twitch behavior beyond the captured frames. I inspected StreamFusion source but did not observe its runtime.

| Evidence | Finding | Proposed response |
| --- | --- | --- |
| Twitch settings screenshot | Navigation rows have prominent labels, supporting summaries, and restrained separators. | Increase shared row descriptions from 12/16 to 14/20, keep 16px labels, and remove decorative icon wells from the settings hub. Preserve existing grouping. |
| Twitch preferences screenshot | A setting's explanation and current selection are easy to associate. | Make the whole settings select row open its picker. Current `SettingsSelect` renders the label outside the `MobileSelect` trigger, so only the trailing value is interactive. |
| Twitch filters screenshot | Sort and tag controls appear on demand above content. | Keep result-type tabs visible. Move category language and sort choices into existing selection sheets. `CategoryFilterBar` currently renders the full language registry as wrapping chips before results. |
| Twitch home screenshot | Channel identity, stream title, and category/tags occupy separate lines. | Separate tags from the channel identity in shared media cards. `LiveStreamCardContent` currently puts verified badges, language, tags, and maturity into `metadata`, which `MobileMediaCardContent` renders inside the channel-name row. |
| Twitch watch screenshot | Playback and the chat composer are strong anchors; secondary tools do not replace them. | Preserve StreamFusion's player/chat placement and sheet-based tools. Apply shared row readability to player-tools, quality settings, and moderation sheets. Verify that sheets and the keyboard do not cover the composer. |
| `app-shell.tsx` navigation styles | Navigation labels use 11/14 type while other labels use 12/16. The shell already measures wrapping and adapts to grid layouts. | Use the existing 12/16 label token and preserve that adaptive measurement. Keep neutral selected icons and the current five destinations. |
| `settings-workspace.tsx` detail header | A custom bordered back button is paired with the display-sized shared header below the shell header. | Use a compact shared header with a leading icon button for local panel navigation. Keep the shell's route navigation separate and avoid changing persisted navigation. |

Source anchors: `src/design/list-row.tsx`, `select.tsx`, `screen-header.tsx`, `media-card.tsx`; `src/features/settings/components/settings-controls.tsx` and `settings-workspace.tsx`; `src/features/discovery/components/category-filter-bar.tsx` and `live-stream-card-content.tsx`; `src/features/shell/components/app-shell.tsx`. Paths are relative to `apps/mobile`.

## Usage, caller's view

Existing row, switch, button, sheet, tab, and select callers retain their props. Three callers need small presentation changes.

`SettingsSelect` keeps its public generic contract and string-to-original-value mapping. The design control owns the label, value, explanation, and single interactive target.

```tsx
// settings-controls.tsx, existing current/options/onSelect values
<MobileSelect
  accessibilityLabel={label}
  appearance="row"
  {...(detail === undefined ? {} : { description: detail })}
  disabled={disabled}
  onChange={(next) => {
    const match = options.find((option) => String(option.value) === next);
    if (match) onSelect(match.value);
  }}
  options={stringOptions}
  testID={`${testID}-picker`}
  value={String(current)}
/>
```

`SettingsCategoryDetail` uses its existing local `onBack`, not a new router or navigation model.

```tsx
<MobileScreenHeader
  size="compact"
  title={title}
  leading={
    <MobileIconButton
      label="Back to settings"
      onPress={onBack}
      testID="settings-category-back"
    >
      <ArrowLeft color={mobileColors.textPrimary} size={24} />
    </MobileIconButton>
  }
/>
```

`LiveStreamCardContent` retains the existing `Stream` input. Verified badges remain beside the name; the current language/tag/maturity elements move to the new tags slot. The slot renders below title and category and wraps independently.

```tsx
<MobileMediaCardContent
  channel={stream.channelDisplayName}
  title={stream.title}
  platform={stream.platform}
  compact={compact}
  live={stream.isLive}
  avatarUri={stream.channelAvatar}
  thumbnailUri={stream.thumbnailUrl}
  metadata={stream.channelIsVerified
    ? <MobileVerifiedBadge platform={stream.platform} />
    : null}
  tags={<View style={styles.tags}>{/* Existing tag elements. */}</View>}
  // Keep existing category, viewer labels, accessibility labels, and test IDs.
/>
```

## Shape

No new feature state owner, domain model, screen registry, or general-purpose screen wrapper is required. Components continue to receive typed feature data and callbacks. Design code owns visual layout, touch targets, accessibility roles, and transient picker visibility. Feature components own filter identities, provider outcomes, setting updates, and navigation intent.

Small proposed signature additions, derived from the callers above:

```ts
type MobileScreenHeaderProps = {
  readonly title: string;
  readonly summary?: string;
  readonly action?: ReactNode;
  readonly leading?: ReactNode;              // New, optional.
  readonly size?: "display" | "compact";    // New, default display.
};

type SelectPresentation =
  | { readonly appearance?: "field" | "inline" }
  | { readonly appearance: "row"; readonly description?: string };

// Existing MobileSelect props remain. Intersect them with SelectPresentation.
// row uses accessibilityLabel as its visible label and owns one Pressable.
// Long labels and values wrap or stack rather than truncate essential values.
function MobileSelect<T extends string>(
  props: ExistingMobileSelectProps<T> & SelectPresentation,
): ReactNode {
  throw new Error("not implemented");
}

// Add this optional slot to the existing MobileMediaCardContent props.
type MediaCardAddition = { readonly tags?: ReactNode };
```

`ExistingMobileSelectProps` above denotes today's props excluding `appearance`, not a proposed exported alias. Keep generics and `MobileSelectOption<T>` unchanged. Do not expose feature session or provider types from design code. Row selection invokes `onChange` once and closes the sheet; reselecting the current value preserves today's behavior. Feature stores still validate and persist values.

The row select hides label/value layout and the full interactive region behind one component. The media slot isolates tag wrapping from the channel row. Both remove caller coordination rather than introducing forwarding wrappers. Header additions express existing content positions and typography. Changes to generic text, colors, and touch targets remain token/style edits.

## Module map and screen coverage

| Module | Change and reach |
| --- | --- |
| `src/design/list-row.tsx` | Description typography and shrink/wrap rules. Reaches settings, following management, media jobs, caption management, player tools, multistream, diagnostics, and moderation. Preserve descriptions in switch accessibility announcements. |
| `src/design/select.tsx` | Add whole-row appearance. Existing field and inline callers continue unchanged. Keep selected marker, 50% selection-sheet cap, scroll, safe insets, and dismiss handling. |
| `src/design/screen-header.tsx` | Add leading and compact presentation. Use for local settings details without introducing route state. |
| `src/design/media-card.tsx` | Add separate tags slot and ensure compact card copy can shrink. Existing following cards inherit the layout safety. |
| `src/features/settings/components/settings-controls.tsx` | Replace split select layout with row appearance; keep public signature and feature conversion logic. Remove obsolete select row styles. |
| `src/features/settings/components/settings-workspace.tsx` | Simplify hub icon presentation; raise section heading contrast from `textMuted` to `textSecondary`; use compact detail header. |
| `src/features/discovery/components/live-stream-card-content.tsx` | Move language, tag, and maturity elements to tags; preserve verified badge beside channel name. |
| `src/features/discovery/components/category-filter-bar.tsx` | Keep `CategoryRequestIdentity` and `onChange`. Replace the long language chip group with `MobileSelect<LanguageFilter>`; use typed per-tab sort selectors to remove the current `as LiveSort`/`VideoSort`/`ClipSort` casts. Keep platform chips and tab controls visible. |
| `src/features/discovery/components/search-filters.tsx` | Render result types through existing `MobileUnderlineTabs`; retain platform/live filter chips and all state callbacks. |
| `src/features/discovery/components/home-live-discovery-screen.tsx` | Omit redundant ready-state text above loaded streams. Keep loading, cached/offline, empty, and failed messages and provider recovery actions. |
| `src/features/shell/components/app-shell.tsx` | Use 12/16 navigation labels. Keep safe inset handling, keyboard hiding, adaptive wrapping, unread announcements, destination IDs, histories, and playback lifetime. |
| Activity, accounts, history, downloads, diagnostics, multistream, moderation, watch/chat | Audit each route after shared changes. Apply local edits only for visible failures. The supplied source inspection does not establish that these screens all need redesign. Retain feature contracts and task-specific workflows. |

Avoid moving feature-specific option lists or sort policy into `src/design`. The shared layer receives presentation values and selection callbacks. The route and composition roots keep their existing boundaries.

## Synthesis decision

Candidate A proposes shared component refinements as the base. The parent orchestrator will compare it with the other independent design before selecting or combining changes.

## Tradeoffs accepted

- Accept modestly taller list rows for readable supporting text. Do not globally enlarge media-card metadata or dense moderation chat.
- Accept a larger select component implementation for a smaller settings caller and one consistent accessible control.
- Accept route-by-route visual verification instead of claiming source inspection proves every screen's usability.

## Alternatives considered

- A new universal screen configuration and renderer could centralize layouts, but would expose many slot, scrolling, header, and state options while obscuring feature workflows. Existing controls already hide the relevant complexity with shorter call chains.
- A replacement navigation architecture could model local settings panels as shell routes, but would expand persistence and back-navigation scope for a presentation task. Preserve the current typed shell histories and local panel state.
- Independent per-screen styling would preserve small component implementations, but would duplicate description sizes, picker layouts, and metadata rules across existing consumers.
- Copying Twitch's white settings theme and purple selected controls conflicts with `DESIGN.md`. Copy information hierarchy and interaction placement, keeping StreamFusion's neutral selection treatment.

## Open questions and risks

- Do large font settings and long translations make the row select stack its value below the label without clipping? Verify at compact and tablet widths.
- Does the higher navigation label size activate the existing grid fallback more often, and is the resulting content area still usable with playback minimized?
- Do larger row descriptions crowd moderation sheets? Keep their touch size and distinguish dense message content from tool rows.
- Does the compact settings header preserve both hardware-back behavior and the visible return to the settings hub? Test the local detail and the shell route separately.

These are verification questions, not approval checkpoints.

## Next implementation step

Implement whole-row select presentation and row typography first, then verify one settings detail and one player-tools sheet before applying discovery and shell edits.

Verification must use real StreamFusion runtime screenshots and interaction outcomes for Search, Categories, Following, Home, Activity, More, Settings hub/detail, Accounts, History, Downloads, Watch/chat, Multistream, Moderation, and Diagnostics. Exercise picker selection/dismissal, filter changes, navigation/back, keyboard, mini-player, and large text. Existing test IDs and behavioral contracts remain; this candidate makes no runtime success claim.
