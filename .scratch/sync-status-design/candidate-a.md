# Candidate A. Compact platform capsules

## Usage from the caller's view

`FollowingPage` keeps the store as the source of truth. It derives the two visible records and gives one local component the whole display job.

```tsx
const followSyncItems = getFollowSyncItems({
  twitchConnected,
  kickConnected,
  lastSyncedAt: followSyncLastSyncedAt,
});

<div className="border-t border-[var(--color-border)] pt-3">
  <FollowSyncStatus items={followSyncItems} />
  <nav
    aria-label="Following content"
    className="mt-3 flex min-w-0 items-center gap-6 overflow-x-auto no-scrollbar"
  >
    {FOLLOWING_TABS.map(renderFollowingTab)}
  </nav>
</div>
```

There is intentionally one production caller. The renderer test addresses the output through accessible platform names and timestamps instead of component internals.

```tsx
expect(screen.getByLabelText("Follow synchronization status")).toHaveTextContent("Twitch");
expect(screen.getByLabelText("Follow synchronization status")).toHaveTextContent("Kick");
expect(screen.getAllByText(/8:0[05] PM/)).toHaveLength(2);
```

At a 320px viewport, the status list wraps independently if locale output is wider than English. The tab row remains a separate horizontal scroller and always starts at `Live`.

## Problem

The existing timestamps are useful but look like loose debug metadata. They also sit inside the same horizontal row as five page tabs. At narrow widths, status copy consumes the leading scroll area and delays access to navigation. The redesign must keep both platform timestamps, local time formatting, connection gating, platform identity, and readable screen-reader output. It must not turn freshness into a new button or imply a success state that the timestamp does not prove.

## Shape

```tsx
type FollowSyncPlatform = Extract<Platform, "twitch" | "kick">;

type FollowSyncItem = Readonly<{
  platform: FollowSyncPlatform;
  syncedAt: string;
}>;

type FollowSyncStatusProps = Readonly<{
  items: readonly FollowSyncItem[];
}>;

const FOLLOW_SYNC_PLATFORM = {
  twitch: {
    label: "Twitch",
    Icon: TwitchIcon,
    accentClassName: "text-[#9146FF]",
  },
  kick: {
    label: "Kick",
    Icon: KickIcon,
    accentClassName: "text-[#53FC18]",
  },
} satisfies Record<
  FollowSyncPlatform,
  {
    label: string;
    Icon: typeof TwitchIcon;
    accentClassName: string;
  }
>;

function getFollowSyncItems(input: {
  twitchConnected: boolean;
  kickConnected: boolean;
  lastSyncedAt: Partial<Record<FollowSyncPlatform, string>>;
}): FollowSyncItem[] {
  // Push Twitch and Kick when each connected platform has a timestamp.
  throw new Error("not implemented");
}

function FollowSyncStatus({ items }: FollowSyncStatusProps) {
  if (items.length === 0) return null;

  return (
    <dl
      aria-label="Follow synchronization status"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      {items.map(({ platform, syncedAt }) => {
        const { label, Icon, accentClassName } = FOLLOW_SYNC_PLATFORM[platform];

        return (
          <div
            key={platform}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-background-tertiary)] px-2 text-[11px] font-medium"
          >
            <Icon className={accentClassName} size={12} aria-hidden="true" />
            <dt className="text-[var(--color-foreground-secondary)]">{label}</dt>
            <span aria-hidden="true" className="text-[var(--color-foreground-muted)]">·</span>
            <dd className="text-[var(--color-foreground-muted)]">
              <span className="sr-only">synced </span>
              <time dateTime={syncedAt}>{formatFollowSyncFreshness(syncedAt)}</time>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
```

The visible result reads `Twitch · 8:23 PM` and `Kick · 8:23 PM`. A screen reader reads `Twitch synced 8:23 PM`. The platform icon is decorative because the text already names the platform.

The capsule uses the page's tertiary surface and divider token. A 12px platform icon carries the only platform color. This follows the Design System's Platform Guest Rule. There is no glow, shadow, animated dot, or generic green success treatment. The 28px height stays compact while giving the metadata a deliberate shape.

The two-item record is the domain. `getFollowSyncItems` owns connection and timestamp gating once, per `principle-model-the-domain`. `FollowSyncStatus` owns layout, platform presentation, time semantics, and screen-reader copy behind one prop. The page does not coordinate those details. The interface is deep enough for this small feature without creating a reusable global abstraction.

The platform registry makes both variants exhaustive and keeps label, icon, and accent together, per `principle-type-system-discipline`. The component takes parsed store values and does not add runtime validation inside the renderer.

Moving status outside the tab scroller protects the central navigation task at narrow widths, per `principle-experience-first`. Keeping both helpers in `Following/index.tsx` is the smallest useful change, per `principle-laziness-protocol`. Extraction would add a file and import without removing duplication or serving a second caller.

## Module map

```text
apps/desktop/src/frontend/pages/Following/index.tsx
  FollowingPage
    reads auth-store connection and last-sync values
    calls getFollowSyncItems
    renders FollowSyncStatus above the independent tab scroller
  getFollowSyncItems
    converts store fields into zero, one, or two display records
  FollowSyncStatus
    owns capsules, semantic time markup, and narrow-width wrapping

apps/desktop/tests/pages/Following.test.tsx
  verifies connected platforms remain named
  verifies both formatted timestamps remain visible
  verifies the status group has an accessible name
```

No new module is recommended. If another page later needs the same presentation and semantics, that second real caller can justify extraction to a page-neutral component.

## Red-flag screen

- Shallow module. Pass. The local component hides platform selection, token styling, time semantics, accessibility copy, and wrapping behind one `items` prop.
- Information leakage. Pass. Platform presentation lives in one registry. The caller only supplies domain records.
- Temporal decomposition. Pass. The design groups knowledge by sync-status ownership, not render sequence.
- Pass-through method. Pass. `getFollowSyncItems` applies visibility policy. `FollowSyncStatus` completes rendering and does not forward the same arguments elsewhere.

## Synthesis decision

Pending arena synthesis. Candidate A should be selected when the priority is preserving all current information with the smallest production diff and reliable 320px behavior.

## Tradeoffs accepted

- We accept one extra 28px metadata row in exchange for tabs that never start behind status text.
- We accept local page helpers in exchange for avoiding a premature shared component.
- We accept capsule wrapping in long-time locales in exchange for readable, untruncated timestamps.
- We accept subdued time text in exchange for keeping stream content and tabs higher in the visual hierarchy.

## Alternatives considered

- Keep capsules inline before the tabs. This hides less layout policy and still makes navigation compete with metadata, so it loses on caller simplicity and narrow-width behavior.
- Put sync status beside the refresh button. This crowds the search and action row at 320px and makes read-only metadata look related to the refresh control.
- Show icons and times with platform names only in tooltips. This is smaller, but it exposes platform recognition to users and fails touch and screen-magnification use cases.
- Collapse both platforms into one `Synced 8:23 PM` capsule. This loses per-platform freshness whenever the timestamps differ.

## Open questions and risks

- Does the app support locales whose short time output commonly exceeds the English width enough to wrap at 320px?
- Should a later product change distinguish stale timestamps? This design deliberately avoids inventing a staleness threshold.
- Should the existing tab buttons gain full `tablist`, `tab`, and `aria-selected` semantics in a separate accessibility change? Mixing that larger behavior change into this visual fix would widen the review.

## Next implementation step

Add the local record derivation and capsule component in `Following/index.tsx`, then update the existing freshness test to assert both timestamps and the named status group.
