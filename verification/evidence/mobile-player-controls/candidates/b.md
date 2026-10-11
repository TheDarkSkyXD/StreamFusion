# Candidate B: WatchScreen-owned stage tools

Model: `gpt-6.1-sol`

## Problem

The player currently has two control surfaces. `PlayerControls` already owns the on-video transport rail, including quality and fullscreen, while `WatchScreen` renders a second five-button row below the video. The secondary captions, media, and more tools must move onto the video without duplicating quality or fullscreen, breaking the three-second chrome lifecycle, losing sheets in fullscreen, showing controls in PiP, or remounting the keyed `PlayerSurface`. The ownership split matters: `WatchScreen` knows the secondary tool content, while `WatchRoute` owns the visibility timer and must know when any sheet holds chrome open.

## Usage (caller's view)

`WatchSessionRoute` owns the single sheet selection because it already owns the timer inputs:

```tsx
const [toolSheet, setToolSheet] = useState<WatchToolSheet>(null);

const pipSurface =
  peek.kind === "active" && isPictureInPictureSurface(peek.presentation);

useEffect(() => {
  if (pipSurface) setToolSheet(null);
}, [pipSurface]);

const controlsForcedVisible = !playing || qualityMenuOpen || toolSheet !== null;
const showControls = controlsForcedVisible || controlsVisible;

return (
  <WatchScreen
    {...existingProps}
    controlsVisible={showControls}
    toolSheet={{ active: toolSheet, onChange: setToolSheet }}
  />
);
```

`WatchScreen` places its secondary tools in the existing player stage, after `PlayerControls` so their presses win over the full-stage tap catcher:

```tsx
<View key="player-stage" style={stageStyle} testID="watch-player-stage">
  <PlayerSurface sessionId={view.sessionId} testID="watch-player" />
  <PlayerControls {...transportProps} visible={controlsVisible} />

  {showControls && controlsVisible && !pipSurface ? (
    <WatchStageTools
      captionsAvailable={captions !== undefined}
      fullscreen={fullscreen}
      mediaAvailable={download !== undefined || recording !== undefined}
      onSelect={toolSheet.onChange}
    />
  ) : null}

  {!pipSurface ? <WatchCaptionOverlay text={captionText} /> : null}
</View>
```

The sheet is a sibling of the stage and outside the portrait-only body branch. A native `Modal` therefore stays available above the fullscreen stage:

```tsx
{pipSurface ? null : (
  <WatchToolSheet
    active={toolSheet.active}
    captions={captions}
    captionSession={captionSession}
    download={download}
    onChange={toolSheet.onChange}
    onOpenEngagement={onOpenEngagement}
    playerTools={playerTools}
    recording={recording}
    sessionId={peek?.kind === "active" ? peek.state.session.sessionId : null}
    target={target}
  />
)}
```

The resulting stage has one top-right secondary row, captions, media, and more, plus the existing bottom transport rail, including its only quality and fullscreen buttons. The former below-video five-button row is removed.

## Shape

### Core types

```ts
export type WatchToolSheet =
  | "captions"
  | "media"
  | "more"
  | "speed"
  | "stats"
  | null;

export type WatchToolSheetControl = {
  /** The only source of truth for which secondary tool sheet is open. */
  readonly active: WatchToolSheet;
  /** Selects a sheet, or closes the active sheet with null. */
  readonly onChange: (next: WatchToolSheet) => void;
};

type WatchStageToolsProps = {
  readonly captionsAvailable: boolean;
  readonly fullscreen: boolean;
  readonly mediaAvailable: boolean;
  readonly onSelect: (sheet: "captions" | "media" | "more") => void;
};

type WatchToolSheetProps = {
  readonly active: WatchToolSheet;
  readonly captions?: WatchCaptionControls;
  readonly captionSession: CaptionSessionState | null;
  readonly download?: WatchMediaJobControls<WatchDownloadEligibility>;
  readonly onChange: (next: WatchToolSheet) => void;
  readonly onOpenEngagement?: () => void;
  readonly playerTools?: FocusedWatchSession;
  readonly recording?: WatchMediaJobControls<WatchRecordingEligibility>;
  readonly sessionId: string | null;
  readonly target: WatchTarget;
};
```

`WatchStageTools` and `WatchToolSheet` remain private functions in `watch-screen.tsx`. The only new public shape is the controlled `toolSheet` prop on `WatchScreen`. This keeps action availability and sheet content inside the component that already owns them. It also keeps `PlayerControls` focused on transport, so it gains no captions, download, recording, engagement, icon, callback, or action-registry props.

The controlled discriminated union is the data structure that serves both dominant access patterns. `WatchRoute` tests `active !== null` to hold chrome open, and `WatchScreen` switches on the exact active sheet to render content. There is no second `toolSheetOpen` boolean to synchronize, per single-source-of-truth and boundary-discipline.

The stage overlay uses three 48dp `MobileIconButton` hit targets in a horizontal, absolutely positioned row. At 411dp wide, the controls consume 144dp plus two small gaps and stage padding, comfortably below half the width of a 411 by 231dp 16:9 stage. Icons carry full accessibility labels; visible captions are omitted because three labels would compete with video and the transport rail. In fullscreen, top and trailing offsets use `Math.max(safeAreaInset, mobileSpacing.small)`. In embedded portrait, the normal small stage inset applies. The overlay gets an explicit `zIndex` above `PlayerControls`' tap catcher and rail, so tool presses invoke only their own callback and do not trigger the existing video-tap switch to Info.

The route closes `toolSheet` on entry to PiP. `WatchScreen` also renders neither the stage tools nor the sheet when `pipSurface` is true, preventing a stale modal from returning after PiP. Opening any secondary sheet forces `controlsVisible`; closing it restarts the existing three-second timer through the current `controlsForcedVisible` dependency. Paused playback and the quality sheet continue to hold visibility exactly as they do now.

The keyed stage and `PlayerSurface` stay in their current unconditional tree position. Fullscreen changes styles only. The sheet moves outside the portrait body conditional but remains a native modal, so it overlays both embedded and fullscreen stages without moving or recreating the player.

### Module map

```text
apps/mobile/src/features/watch/components/
├── watch-route.tsx
│   └── owns WatchToolSheet state; folds it into chrome hold; clears on PiP
├── watch-screen.tsx
│   ├── exports WatchToolSheet and WatchToolSheetControl
│   ├── renders private WatchStageTools inside the existing stage
│   ├── renders private WatchToolSheet outside portrait/fullscreen branching
│   └── removes the below-video five-button tools row
├── player-controls.tsx
│   └── unchanged transport rail and quality sheet
└── player-tools.tsx
    └── unchanged more/speed/stats sheet body
```

Tests stay in the existing watch feature. `watch-screen.test.ts` should assert that captions, media, and more are stage descendants, quality/fullscreen occur only in `PlayerControls`, disabled availability remains intact, and tool presses do not call `onPlayerTap`. A route-level fake-timer test should assert that an active secondary sheet holds chrome visible and that closing it resumes the three-second timeout. `watch-fullscreen-mount.test.ts` should open each sheet across watch/fullscreen transitions and retain its existing one-mount assertion. A PiP case should prove the sheet closes and does not reappear after exit.

### Interface depth and red-flag screen

The one controlled value hides five sheet bodies, capability checks, titles, safe-area placement, modal behavior, and nested more-to-speed/stats navigation. The caller sees only the state needed for its existing timer policy. The design avoids a shallow callback surface, leaks no domain actions into `PlayerControls`, groups rendering by ownership rather than execution order, and adds no pass-through module.

## Synthesis decision

Candidate B proposes `WatchScreen`-owned stage rendering with route-owned controlled sheet selection. Arena synthesis should compare this whole shape with the caller-owned `ReactNode` slot candidate, especially on whether transport should own any secondary-overlay layout contract.

## Tradeoffs accepted

- We accept one controlled presentation prop on `WatchScreen` in exchange for a single source of truth shared with the existing visibility timer.
- We accept private helper components in the large `watch-screen.tsx` file in exchange for avoiding a shallow new module and keeping the change within the two existing ownership boundaries.
- We accept icon-only secondary controls in exchange for preserving 48dp targets and usable video area at 411dp; accessibility labels retain the full names.
- We accept route awareness of sheet identity, rather than only an open boolean, in exchange for deterministic PiP cleanup and no mirrored state.

## Alternatives considered

- The simplest shape keeps the existing `toolSheet` state local to `WatchScreen`, adds a top-stage captions/media/more overlay, moves the existing `MobileBottomSheet` outside the portrait-only branch, and leaves `PlayerControls` unchanged. That shape handles placement, fullscreen, PiP rendering, 411dp width, and player mount stability with no new API. It loses on the shared visibility invariant: `WatchRoute` cannot hold its three-second timer while local sheet state is open. The timer can expire behind the modal, leaving the rail hidden when the sheet closes. A reveal callback could repair dismissal, but it would not give tool sheets the same hold behavior as the quality sheet. A mirrored open callback adds two sources of truth. Moving the discriminant is the smallest change that preserves the existing lifecycle exactly.
- A caller-owned `ReactNode` slot on `PlayerControls` gives a small public API, but the node must understand the transport overlay's z-order, visibility, safe-area, and tap-catcher contract. It hides rendering from `PlayerControls` while exposing its internal layout rules to the caller, so its interface is shallower than it first appears.
- Adding `onCaptionsPress`, `onMediaPress`, `onMorePress`, availability flags, icons, and labels to `PlayerControls` spreads Watch-specific policy across the transport boundary. It exposes many knobs while hiding little complexity.
- Folding all secondary tools into the quality sheet would reduce visible buttons, but it changes the requested direct tool access and makes the transport settings sheet depend on captions, media jobs, engagement, and diagnostics.

## Open questions and risks

- Should the top-right overlay use a subtle shared scrim behind the three icons, or are the existing pressed states and white icons sufficient over bright video?
- Should the more button remain enabled when both speed and stats are hidden and engagement is unavailable, preserving current behavior, or become disabled when its sheet would be empty?
- Does large-text accessibility require tooltips or another discoverability aid beyond accessibility labels for the icon-only controls?

## Next implementation step

Add the controlled `WatchToolSheet` state to `WatchSessionRoute`, then move the existing secondary triggers and sheet into the stage without touching `PlayerControls`.
