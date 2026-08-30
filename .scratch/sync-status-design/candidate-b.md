# Candidate B. One neutral sync capsule

## Usage from the caller

The Following page keeps its existing store reads. It derives only the visible stamps, then gives the rail one compact status element.

```tsx
const syncStamps = [
  ...(twitchConnected && followSyncLastSyncedAt.twitch
    ? [{ platform: "twitch", syncedAt: followSyncLastSyncedAt.twitch }]
    : []),
  ...(kickConnected && followSyncLastSyncedAt.kick
    ? [{ platform: "kick", syncedAt: followSyncLastSyncedAt.kick }]
    : []),
] satisfies readonly FollowSyncStamp[];

<div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3 sm:flex-row sm:items-end sm:gap-4">
  <div className="flex min-w-0 items-center gap-6 overflow-x-auto no-scrollbar">
    {FOLLOWING_TABS.map(renderFollowingTab)}
  </div>

  <FollowingSyncStatus stamps={syncStamps} />
</div>
```

At 320px, the tabs keep a full-width scrolling line and the capsule sits below them. At `sm` and above, the capsule moves to the trailing edge of the same rail. Navigation stays primary, and sync metadata never squeezes a tab down to a few characters.

The existing page test continues to query the accessible copy.

```tsx
expect(screen.getByText(/twitch synced/i)).toBeInTheDocument();
expect(screen.getByText(/kick synced/i)).toBeInTheDocument();
```

Add one narrow-viewport assertion around the rail and status class contract. Do not add a screenshot-only test for text that already has a semantic assertion.

## Minimal type and JSX sketch

```tsx
type FollowSyncStamp = Readonly<{
  platform: Platform;
  syncedAt: string;
}>;

const FOLLOW_SYNC_PRESENTATION = {
  twitch: {
    label: "Twitch",
    icon: TwitchIcon,
    iconClassName: "text-[#9146FF]",
  },
  kick: {
    label: "Kick",
    icon: KickIcon,
    iconClassName: "text-[#53FC18]",
  },
} satisfies Record<
  Platform,
  {
    label: string;
    icon: typeof TwitchIcon;
    iconClassName: string;
  }
>;

function FollowingSyncStatus({ stamps }: { stamps: readonly FollowSyncStamp[] }) {
  if (stamps.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex max-w-full shrink-0 items-center gap-0.5 self-start rounded-full border border-[var(--color-border)] bg-[var(--color-background-tertiary)] p-1 text-[11px] font-medium leading-none text-[var(--color-foreground-secondary)] sm:ml-auto"
    >
      <span className="hidden px-1 text-[var(--color-foreground-muted)] sm:inline">
        Updated
      </span>

      {stamps.map(({ platform, syncedAt }) => {
        const presentation = FOLLOW_SYNC_PRESENTATION[platform];
        const Icon = presentation.icon;

        return (
          <span key={platform} className="inline-flex h-6 items-center gap-1 rounded-full px-1.5">
            <span aria-hidden="true" className={presentation.iconClassName}>
              <Icon size={12} />
            </span>
            <span className="sr-only">{presentation.label} synced </span>
            <time dateTime={syncedAt} className="whitespace-nowrap tabular-nums">
              {formatFollowSyncFreshness(syncedAt)}
            </time>
          </span>
        );
      })}
    </div>
  );
}
```

The two-platform capsule is about 130px wide when the `Updated` label is hidden. It fits inside the Following card's roughly 272px content width at a 320px window. The platform marks carry the only purple and green. The border, fill, timestamp, and optional label stay neutral.

## Module map

```text
apps/desktop/src/frontend/pages/Following/index.tsx
  FollowingPage
    reads connection flags and followSyncLastSyncedAt from useAuthStore
    derives visible FollowSyncStamp values
    renders the tab rail, then FollowingSyncStatus
  FollowingSyncStatus
    owns platform presentation, compact layout, time semantics, and live-region copy

apps/desktop/tests/pages/Following.test.tsx
  keeps the current per-platform freshness coverage
  adds the narrow rail layout contract if implementation changes the wrapper classes
```

The route remains `/following`. The renderer page owns the change. `useAuthStore` remains the state owner. No preload, IPC, main-process, platform adapter, or persistence path changes.

## Rationale

### Problem

The current row repeats platform names in low-contrast prose before the tabs. It reads like debug metadata and consumes the scarce horizontal space before the page's primary navigation. The source data is already correct. The change should improve hierarchy without changing sync behavior or inventing a new success state.

### Shape

One local component owns the whole presentation rule. The page passes a list of visible platform timestamps. The component handles platform marks, neutral styling, responsive placement, machine-readable time values, and spoken labels. That is a small interface with useful depth. Callers do not coordinate icons, colors, breakpoints, or accessibility attributes.

`FollowSyncStamp` models exactly what the view can render. A missing timestamp does not become a partly filled status object. The page omits that platform instead. The platform presentation registry is the single source for label, mark, and identifying color, per `principle-model-the-domain`.

The design gives tabs the first row at 320px and moves metadata below them. At wider sizes both sit on one line. This preserves the core Following navigation instead of making the implementation's desire for a single line the user's problem, per `principle-experience-first`.

The capsule uses tonal elevation, a one-pixel divider border, and no shadow. Platform color identifies the two marks only. It follows the Dark Theater, Platform Guest, and Flat-By-Default rules in `DESIGN.md`.

The existing timestamp string remains the source of truth. `<time dateTime>` preserves the exact value. Visible copy keeps the current locale-aware time formatter. `role="status"` and visually hidden platform labels make a completed sync update understandable without relying on color or icons.

### Synthesis decision

Pending arena synthesis. Candidate B should win when the desired hierarchy is tabs first, sync second, with one visual object rather than two independent badges.

### Tradeoffs accepted

- We accept a second rail line below 640px in exchange for readable tabs and an unclipped status at 320px.
- We accept one shared capsule in exchange for less visual separation between platform results. The icon and spoken label retain identity.
- We accept local page ownership in exchange for avoiding a reusable status component with no second caller.
- We do not show a checkmark or green success dot. A timestamp proves recency, while a generic success symbol would imply health data the store does not provide.

### Alternatives considered

- Two separate platform pills expose the same icon, border, spacing, and accessibility policy twice. They also read as filters or buttons. The single capsule hides more policy behind one non-interactive status.
- A trailing fixed status beside a scrolling tab list stays on one line but leaves too little tab width at 320px. It favors compact implementation over navigation.
- A tooltip-only icon pair is smaller, but it hides the timestamp from pointer-free and glance-based use. It also weakens the existing freshness information.

### Red-flag screen

- No shallow module. The one `stamps` prop hides responsive layout, presentation mapping, and accessible output.
- No information leakage. Store ownership and raw sync mechanics remain outside the view. The component receives only the values it displays.
- No temporal decomposition. Formatting, icons, and semantics live together because they describe one status object, not separate render phases.
- No pass-through method. `FollowingSyncStatus` completes the rendering operation itself.

### Open questions and risks

- Should sync completion announce itself every time the store timestamp changes, or should `aria-live` remain off because the refresh button already communicates pending state?
- Does the product want elapsed freshness such as `4m ago` later? That would need a clock-driven rerender and should not be slipped into this visual-only change.

### Next implementation step

Build the local `FollowingSyncStatus` component in `Following/index.tsx`, replace the current prose block, and verify the Following page at 320px and desktop width.
