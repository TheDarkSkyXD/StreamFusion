# Candidate B: constrained region workspace

## Problem

The channel moderation page must become a compact Twitch Mod View-like
workstation with actual live media and chat, while retaining the existing
channel resolution, authority, platform capability, SQLite log, and retention
contracts. Dragging needs the observed four-edge docking behavior, but a
general recursive split tree would make valid persistence, small-window
reflow, and stable HLS/chat mounts harder than this product needs. This design
uses a flat, validated region record with a small vocabulary of layouts.

## Usage (caller's view)

`ModChannelPage` remains the only authority boundary. Once it has a resolved,
authorized channel, it renders one workspace.

```tsx
<ModChannelWorkspace
  channel={resolvedChannel}
  authority={moderationAuthority}
  refreshCounter={refreshCounter}
/>
```

The workspace has one public interaction surface. It owns drag, resize, lock,
hide, reset, and local persistence. Panel callers never manipulate geometry.

```tsx
const workspace = useModWorkspaceLayout(channel.workspaceKey);

<ModWorkspaceFrame
  layout={workspace.layout}
  locked={workspace.locked}
  onDock={workspace.dock}
  onResize={workspace.resize}
  onToggleLock={workspace.toggleLock}
  onReset={workspace.reset}
>
  <ModLiveStage channel={channel} />
  <ModLiveChat channel={channel} />
  <ChannelModLogFeed {...channel.modLogArgs} refreshCounter={refreshCounter} />
  <ModCapabilityPanel channel={channel} activeTool={workspace.activeTool} />
</ModWorkspaceFrame>
```

Three real outcomes follow from the same API:

```tsx
// Twitch moderator: Live + Chat stay visible. Dragging Mod actions above
// Queue selects the `stacked-bottom` template; no video/chat component moves.
<ModChannelWorkspace channel={twitchModeratorChannel} authority={authorizedModerator} />

// Kick broadcaster: the same regions render real Kick player/chat, log, and
// retention. Unsupported Twitch-only tools are absent from the dock.
<ModChannelWorkspace channel={kickBroadcasterChannel} authority={authorizedBroadcaster} />

// Guest, unresolved, reconnect-required, or unverifiable: existing page
// states render before this component, so no player, chat, or tool mounts.
<ModChannelPage platform="twitch" channel="example" />
```

## Shape

### Domain types

```ts
type WorkspacePanel = "stage" | "chat" | "mod-log" | "tools";
type ToolPanel = "queue" | "banned" | "unban-requests" | "people" | "engagement" | "retention";
type WorkspaceTemplate = "split-bottom" | "stacked-bottom" | "log-focus";
type DockEdge = "top" | "right" | "bottom" | "left";

type RegionSize = {
  mainPercent: number; // 50..80, controls stage/tools column versus chat
  lowerPercent: number; // 25..60, controls stage versus lower workspace
  bottomSplitPercent: number; // 35..65, used only by split-bottom
};

type ModWorkspaceLayout = {
  version: 1;
  template: WorkspaceTemplate;
  sizes: RegionSize;
  hiddenTools: ToolPanel[];
  activeTool: ToolPanel;
  locked: boolean;
};

type ModWorkspaceChannel = {
  workspaceKey: `mod-workspace:${"twitch" | "kick"}:${string}`;
  platform: "twitch" | "kick";
  channelName: string;
  channelId: string;
  displayName: string;
  retentionScope: RetentionScope;
  role: "broadcaster" | "moderator";
  live: LiveChannelContext;
};

type DockIntent = { dragged: ToolPanel | "mod-log"; target: WorkspacePanel; edge: DockEdge };

export function normalizeModWorkspaceLayout(value: unknown, available: readonly ToolPanel[]): ModWorkspaceLayout;
export function reduceDock(layout: ModWorkspaceLayout, intent: DockIntent): ModWorkspaceLayout;
export function reduceResize(layout: ModWorkspaceLayout, size: Partial<RegionSize>): ModWorkspaceLayout;
export function useModWorkspaceLayout(key: ModWorkspaceChannel["workspaceKey"]): {
  layout: ModWorkspaceLayout;
  dock(intent: DockIntent): void;
  resize(size: Partial<RegionSize>): void;
  selectTool(tool: ToolPanel): void;
  toggleTool(tool: ToolPanel): void;
  toggleLock(): void;
  reset(): void;
};
```

`normalizeModWorkspaceLayout` is the persistence boundary. It accepts only
version 1, clamps percentages, removes unsupported/duplicate tools, selects a
visible active tool, and falls back to the default. `reduceDock` is pure and
total. It maps the four edge intents to one of three templates or a tool
selection, rather than allowing an invalid geometry. Repeating the same intent
returns the same layout. This makes drop, reset, and post-crash hydration
idempotent.

### Rendering and data flow

`ModWorkspaceFrame` renders a 64px icon dock, a 52px channel header, and a
CSS-grid body with fixed semantic areas. `split-bottom` maps stage and chat to
their large fixed regions and gives Mod Log and the active tool half of the
lower row. `stacked-bottom` maps Mod Log and active tool to two vertically
stacked lower areas. `log-focus` makes the log occupy the left column below
the stage and keeps the tool in the dock until selected. The edge preview is a
temporary overlay calculated from `DockIntent`; it never changes persisted
layout until drop.

Resizers alter only the three percentage fields and use pointer capture. Drag
handles are on panel headers; interactive controls inside a panel never start
a drag. Keyboard users use a labelled move menu with target and edge options,
plus buttons for lock, reset, and hidden tools. Below the minimum viable width,
the same model becomes one vertical column with the chat first or second by
the user-selected template, preserving every panel without offscreen geometry.

`ModLiveStage` and `ModLiveChat` are rendered once in stable grid anchors,
outside the panel-order switch. Layout changes alter grid-area CSS only. The
adapter starts one `useStreamPlayback` lifecycle per `LiveChannelContext` and
passes the resulting URL to existing `TwitchLivePlayer`/`KickLivePlayer`; chat
uses existing `TwitchChat`/`KickChat`. Neither is keyed by template, drag
revision, size, or active tool. A channel change replaces both through the
existing channel identity lifecycle. This protects HLS and chat sessions from
DOM remounts during drag/resize.

`ModCapabilityPanel` is a presentational switch over existing data owners:
`ChannelUnbanRequests`, `ChannelBannedList`, `ChannelModeratorsTable`,
`ChannelVipsTable`, `ChannelEngagement`, and `RetentionCard`. Its available
tool list is derived from `platform` and `role`; it never calls privileged APIs
itself. `ChannelModLogFeed` remains the sole owner of log filters, pagination,
and IPC access. `refreshCounter` is forwarded unchanged.

The public workspace interface hides templates, bounds, localStorage schema,
drag hit-testing, preview geometry, and small-window reflow. Callers provide
only resolved, authorized channel capability. That is a deep interface: the
page does not learn a layout engine or persistence protocol (per
boundary-discipline and minimize-reader-load).

### Module map

```
pages/Mod/channel/ModChannelPage.tsx
  resolves identity + useModerationAuthority, derives ModWorkspaceChannel
  └─ ModChannelWorkspace.tsx
     ├─ ModWorkspaceFrame.tsx             CSS grid, dock, header, a11y actions
     ├─ mod-workspace-layout.ts            pure normalize/reduce/default/regions
     ├─ use-mod-workspace-layout.ts        Zustand persist adapter, one key/channel
     ├─ ModLiveStage.tsx                   LiveChannelContext -> existing player
     ├─ ModLiveChat.tsx                    LiveChannelContext -> existing chat
     └─ ModCapabilityPanel.tsx             role/platform tool selection only
```

`LiveChannelContext` should be introduced at the existing playback/stream
composition seam, or as a small moderation-local adapter if its props cannot
yet be made public without pulling page concerns into a feature. It is a
domain context, never a player/chat transport type.

The former Mod-tree prohibition on chat imports needs one narrow documented
exception for `ModLiveChat` importing public Twitch/Kick chat surfaces. It
continues to prohibit `UserPopoutProvider`, in-chat moderation tabs, and any
new direct IPC. Existing authority states remain outside the workspace.

## Synthesis decision

Pending arena synthesis. Candidate B recommends the constrained region model
when stable media/chat and easily validated persisted layouts matter more than
arbitrary nested splits.

## Tradeoffs accepted

- We accept three layout templates instead of arbitrary nesting in exchange
  for a small, validated persistence model and reliable small-window reflow.
- We accept that a drag changes a template or active tool, rather than storing
  pixel rectangles, in exchange for semantic layouts that survive DPI and
  window-size changes.
- We accept a local renderer preference per channel, in exchange for no new
  backend synchronization or multi-device layout promise.
- We accept the public chat exception in the Mod tree, in exchange for real
  chat rather than a fake moderation transcript; authority remains the route
  boundary.

## Alternatives considered

- A recursive split-tree stores arbitrary nesting and faithfully represents
  every future docking arrangement, but exposes tree surgery, pruning, and
  invariant repair to every persistence and rendering concern. It hides less
  complexity behind a larger interface and risks remounting panels while
  restructuring.
- An established dock-layout library could provide drag and resize quickly,
  but its serialized model, DOM lifecycle, and accessibility policy become
  part of the product contract. It is only preferable after a spike proves it
  can keep HLS/video and chat mounted while moving regions.
- A freeform absolute-position canvas supports arbitrary placement, but puts
  collision handling, bounds, and responsive repair into persistence. It does
  not match the observed edge-docking behavior as well as constrained regions.

## Open questions and risks

- Can the current stream composition expose a stable `LiveChannelContext`
  without importing route state into a feature, or should the first version
  keep the adapter beside `ModChannelPage`?
- Does the chosen public chat surface require `UserPopoutProvider` for a
  nonessential interaction? If so, should that interaction be omitted from
  the workspace rather than widening the exception?
- Is per-channel layout desired, or should one platform-wide layout be copied
  to new channels? Candidate B defaults per channel to avoid a Twitch tool set
  leaking into Kick.
- A library spike is needed before adoption because a library that reparents
  React children during drag would violate stable media/chat mounting.

## Next implementation step

Build and unit-test `mod-workspace-layout.ts` with the three templates,
four-edge reductions, normalization, lock, reset, hide/restore, and
small-window fallback before mounting any live component.
