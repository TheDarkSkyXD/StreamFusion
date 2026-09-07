# Candidate A: split-tree dock workspace

## Problem

The authorized per-channel moderation page needs Twitch Mod View behavior rather than a fixed admin stack. Video and chat must remain live while a moderator docks panels at any edge, resizes them, hides and restores tools, locks the layout, resets it, and returns later. The existing page already owns canonical Twitch and Kick identity resolution, moderation authority, role gates, retention scope keys, and the single refresh counter. Existing player, chat, and moderation components own their runtime behavior. The difficult constraint is structural dragging without remounting stateful media or chat when a panel moves between nested regions.

## Usage (caller's view)

The authorized branch of `ModChannelPage` constructs one resolved context and hands it to one workspace. The workspace derives the available widget catalog from platform and role. Unauthorized states never mount it.

```tsx
const context: ModerationWorkspaceContext = {
  identity: {
    platform,
    channelId,
    channelSlug: channel,
    displayName,
  },
  authority: {
    role: moderationAuthority.role,
    isOwnBroadcaster,
  },
  retentionScope,
  refreshCounter,
  refresh: () => setRefreshCounter((value) => value + 1),
};

return <ModerationWorkspace context={context} />;
```

The page does not coordinate docking, persistence, resize events, player recovery, or widget visibility. A toolbar talks to the workspace controller through commands.

```tsx
const workspace = useDockWorkspace({ scope, catalog, defaultLayout });

<WorkspaceToolbar
  locked={workspace.locked}
  hiddenWidgets={workspace.hiddenWidgets}
  onCommand={workspace.dispatch}
/>
<DockStage model={workspace.model} catalog={catalog} onCommand={workspace.dispatch} />
```

Widget registration reuses existing owners and keeps authority predicates beside each widget definition.

```tsx
const catalog = createModerationWidgetCatalog(context, {
  video: () => <ModerationLiveVideo identity={context.identity} />,
  chat: () => <ChatPanel platform={platform} channelName={channelSlug} />,
  modLog: () => <ChannelModLogFeed {...modLogProps} />,
  retention: () => <RetentionCard scope={retentionScope} title={displayName} />,
});
```

## Shape

### Core data

```ts
type WidgetId =
  | "video"
  | "chat"
  | "mod-actions"
  | "mod-log"
  | "retention"
  | "banned-users"
  | "unban-requests"
  | "moderators"
  | "vips"
  | "engagement";

type SplitId = string & { readonly __brand: "SplitId" };
type DockAxis = "horizontal" | "vertical";
type DockEdge = "top" | "right" | "bottom" | "left";
type SplitRatio = number & { readonly __brand: "SplitRatio" };

type DockNode =
  | { kind: "leaf"; widgetId: WidgetId }
  | {
      kind: "split";
      id: SplitId;
      axis: DockAxis;
      ratio: SplitRatio;
      first: DockNode;
      second: DockNode;
    };

interface DockLayout {
  root: DockNode;
  hidden: WidgetId[];
  locked: boolean;
}

interface WorkspaceScope {
  version: 1;
  platform: "twitch" | "kick";
  channelKey: string;
  subjectKey: string;
}

interface PersistedDockLayoutV1 {
  version: 1;
  root: unknown;
  hidden: unknown;
  locked: unknown;
}

type WorkspaceCommand =
  | { kind: "dock"; dragged: WidgetId; target: WidgetId; edge: DockEdge }
  | { kind: "resize"; splitId: SplitId; ratio: SplitRatio }
  | { kind: "hide"; widgetId: WidgetId }
  | { kind: "restore"; widgetId: WidgetId; target: WidgetId; edge: DockEdge }
  | { kind: "set-lock"; locked: boolean }
  | { kind: "reset" };

interface WidgetDefinition {
  id: WidgetId;
  title: string;
  minimum: { width: number; height: number };
  render: () => React.ReactNode;
}

type WidgetCatalog = ReadonlyMap<WidgetId, WidgetDefinition>;
```

`DockNode` is the single source of truth for placement. Every visible widget appears exactly once as a leaf, every split has exactly two nonempty children, and hidden widgets appear only in `hidden`. Axis describes physical division. A horizontal split produces left and right children; a vertical split produces top and bottom children. Ratios are parsed and clamped to `0.15..0.85` at construction. These types encode node variants and commands rather than coordinating booleans, per `type-system-discipline` and `model-the-domain`.

The default Twitch-like tree is:

```text
horizontal
├─ vertical
│  ├─ video
│  └─ horizontal
│     ├─ mod-actions
│     └─ mod-log
└─ chat
```

Twitch-only tools are added to the hidden tray or a lower administration branch according to role. Kick receives only video, chat, mod log, retention, and the existing unsupported-bans information panel. No fake AutoMod leaf exists.

### Pure layout operations

```ts
function parsePersistedLayout(input: unknown, catalog: WidgetCatalog): DockLayout | null;
function reconcileLayout(saved: DockLayout | null, defaults: DockLayout, catalog: WidgetCatalog): DockLayout;
function reduceDockLayout(layout: DockLayout, command: WorkspaceCommand): DockLayout;
function dockAtEdge(root: DockNode, dragged: WidgetId, target: WidgetId, edge: DockEdge): DockNode;
function removeLeaf(root: DockNode, widgetId: WidgetId): DockNode | null;
function resizeSplit(root: DockNode, splitId: SplitId, ratio: SplitRatio): DockNode;
function validateDockLayout(layout: DockLayout, catalog: WidgetCatalog): boolean;

interface Rect { x: number; y: number; width: number; height: number }
interface StageGeometry {
  widgetRects: ReadonlyMap<WidgetId, Rect>;
  splitters: readonly { splitId: SplitId; axis: DockAxis; rect: Rect; ratio: SplitRatio }[];
}

function computeStageGeometry(root: DockNode, bounds: Rect, gap: number): StageGeometry;
function previewDockGeometry(
  layout: DockLayout,
  command: Extract<WorkspaceCommand, { kind: "dock" | "restore" }>,
  bounds: Rect
): StageGeometry;
```

Docking first removes the dragged leaf and collapses its former one-child split, then replaces the target leaf with a new split. `top` and `left` place the dragged leaf first; `bottom` and `right` place it second. Reapplying the same command converges on the same tree. Validation rejects duplicates, unknown IDs, invalid ratios, malformed depth, and visible/hidden overlap. Reconciliation drops widgets unavailable under the current authority, preserves valid user placement, and inserts newly available required widgets from the default tree. Storage data stays `unknown` until parsed, per `boundary-discipline`.

### Stable rendering

```tsx
interface DockStageProps {
  model: DockWorkspaceModel;
  catalog: WidgetCatalog;
  onCommand(command: WorkspaceCommand): void;
}

function DockStage({ model, catalog, onCommand }: DockStageProps): JSX.Element;
function DockWidgetFrame(props: {
  definition: WidgetDefinition;
  rect: Rect;
  locked: boolean;
  onCommand(command: WorkspaceCommand): void;
}): JSX.Element;
function DockDropOverlay(props: {
  preview: DockPreview | null;
  geometry: StageGeometry;
}): JSX.Element | null;
function DockSplitters(props: {
  geometry: StageGeometry;
  locked: boolean;
  onResize(splitId: SplitId, ratio: SplitRatio): void;
}): JSX.Element;
```

`DockStage` renders all `DockWidgetFrame` elements as direct children keyed only by `WidgetId`. The tree is never rendered as nested React parents. `computeStageGeometry` turns it into absolute rectangles, so docking changes style coordinates without changing a widget's React ancestry or key. `ModerationLiveVideo`, `ChatPanel`, Virtuoso state, HLS recovery state, and socket subscriptions therefore remain mounted during drag and drop. A drag overlay paints the purple half-panel preview from the candidate tree; the committed layout is dispatched only on drop.

`@dnd-kit/core` supplies pointer and keyboard sensors, drag announcements, collision detection, and the overlay. Four edge targets are derived from each target rectangle. Headers are drag handles. Locked layouts do not register drag or resize activators. Splitters use pointer capture and expose separator roles with arrow-key increments. Geometry writes are animation-frame throttled during resize and one persistence write follows the committed ratio.

### Workspace controller and persistence

```ts
interface DockWorkspaceModel {
  layout: DockLayout;
  geometry: StageGeometry;
  preview: DockPreview | null;
  hiddenWidgets: readonly WidgetDefinition[];
  locked: boolean;
}

function useDockWorkspace(input: {
  scope: WorkspaceScope;
  catalog: WidgetCatalog;
  defaultLayout: DockLayout;
}): {
  model: DockWorkspaceModel;
  dispatch(command: WorkspaceCommand): void;
};

function workspaceStorageKey(scope: WorkspaceScope): string;
function loadWorkspaceLayout(scope: WorkspaceScope, catalog: WidgetCatalog): DockLayout | null;
function saveWorkspaceLayout(scope: WorkspaceScope, layout: DockLayout): void;
```

The controller owns one reducer state and writes a versioned JSON document to local storage after committed commands. The key includes platform, canonical channel key, and authenticated subject, so moderators do not overwrite one another's layout and Twitch/Kick layouts cannot collide. Reset deletes that exact key and restores the current authority-derived default. Parsing, migration, reconciliation, and storage failures are hidden behind the hook; the page sees only a valid model and commands. This is a deep interface because a small command surface hides tree surgery, validation, geometry, persistence, previews, and recovery.

### Capability and live-channel adapter

```ts
interface ModerationWorkspaceIdentity {
  platform: "twitch" | "kick";
  channelId: string;
  channelSlug: string;
  displayName: string;
}

interface ModerationWorkspaceContext {
  identity: ModerationWorkspaceIdentity;
  authority: { role: "broadcaster" | "moderator"; isOwnBroadcaster: boolean };
  retentionScope: RetentionScope;
  refreshCounter: number;
  refresh(): void;
}

function createModerationWidgetCatalog(context: ModerationWorkspaceContext): WidgetCatalog;
function ModerationLiveVideo(props: { identity: ModerationWorkspaceIdentity }): JSX.Element;
function ModerationLiveChat(props: { identity: ModerationWorkspaceIdentity }): JSX.Element;
```

The catalog is created only after `useModerationAuthority` returns `authorized`. It includes Twitch-only and broadcaster-only definitions using the same predicates as the current page. Existing section components retain their props and refresh behavior. `ModerationLiveVideo` is a small channel adapter that composes `useStreamPlayback` with the existing `TwitchLivePlayer` or `KickLivePlayer`. `ModerationLiveChat` selects the existing public chat panel and provides the required popout context through the chat feature's public composition point. Neither imports `StreamPage`, clones player/chat internals, or introduces a second playback store.

### Module map

```text
pages/Mod/channel/ModChannelPage.tsx
  Resolves identity and authority, then mounts ModerationWorkspace.

features/moderation/components/workspace/
  moderation-workspace.tsx       Toolbar, dock stage, hidden-tool tray.
  moderation-widget-catalog.tsx  Authorized platform/role registry.
  moderation-live-channel.tsx    Thin playback and chat adapters.
  dock-stage.tsx                 Stable flat widget hosts, DnD, splitters.
  dock-layout.ts                 Tree types, reducer, geometry, validation.
  use-dock-workspace.ts          Persistence boundary and controller.

tests/features/moderation/workspace/
  dock-layout.test.ts            Tree invariants, edge docking, resize.
  use-dock-workspace.test.tsx    Persistence, invalid data, reset, scopes.
  moderation-workspace.test.tsx  Gates, keyboard DnD, stable mount keys.
```

The page-to-workspace-to-existing-widget call chain stays at three files. Tree knowledge remains in `dock-layout.ts`; storage representation remains in the hook. No transport contract changes are required.

## Synthesis decision

To be completed by the arena synthesizer.

## Tradeoffs accepted

- We accept absolute positioning inside one measured stage in exchange for stable player and chat component identity across arbitrary tree reparenting.
- We accept a custom binary-tree reducer and splitter implementation in exchange for exact four-edge Twitch docking without adding a layout dependency.
- We accept local storage as device-local preference state in exchange for immediate persistence with no IPC or account-sync contract.
- We accept minimum-size clamping that can override a saved ratio on small windows in exchange for usable controls and nonzero panels.
- We accept one small ChatPanel/player adapter inside the moderation feature in exchange for reusing live subsystems without importing a route page.

## Alternatives considered

- Nested recursive split panes lost because moving a leaf between React parents remounts the player or chat. It hides geometry but exposes lifecycle recovery to every stateful widget caller.
- A flat CSS grid with sortable indices lost because it cannot represent arbitrary edge splits and stacked-within-column arrangements without leaking template-area policy into widget definitions.
- A third-party dock-layout package lost because no such dependency exists, its persistence schema and remount behavior would become public constraints, and the required behavior is small enough to hide behind the proposed controller.

## Open questions and risks

- Should layout persistence follow the authenticated moderator across channels, or remain per moderator and per channel as proposed?
- Should video and chat be mandatory visible leaves, or may users hide either into the restore tray?
- What minimum video size preserves player controls in compact mode at the smallest supported application window?
- Does the public chat composition point already include `UserPopoutProvider`, or must `ModerationLiveChat` provide it explicitly?
- Should a reset preserve the locked state or restore the complete default document, including unlocked state?

## Next implementation step

Build `dock-layout.ts` first with table-driven edge-docking, collapse, ratio-clamping, validation, and geometry tests before mounting any live component.
