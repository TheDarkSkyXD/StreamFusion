# Candidate A: fixed secondary tools inside PlayerControls

Model: inherited Codex GPT-6 runtime; the exact serving model identifier is not exposed to this runner. No model override. Design sketch only.

## Problem

WatchScreen puts five tool buttons below the video, although PlayerControls already renders quality and fullscreen on the video. Its captions/media/more sheet is also inside the portrait branch, so relocating triggers alone would leave fullscreen triggers without visible content. Preserve the keyed player-stage, existing bottom controls, preference behavior, caption/media eligibility projections, and PiP suppression. Grounding: [grounding.md](../grounding.md), watch-screen.tsx, player-controls.tsx, and watch-route.tsx.

## Usage (caller's view)

WatchScreen provides three fixed actions. PlayerControls renders their icons, accessibility labels, disabled state, safe-area placement, and shared visibility. An absent callback disables its button; omitting the entire bundle omits the strip for other PlayerControls callers.

```tsx
// WatchScreen, live stream. Existing playback props are unchanged.
<PlayerControls
  {...existingPlaybackProps}
  secondaryTools={{
    mediaKind: "record",
    ...(captions ? { onCaptionsPress: () => onToolSheetChange("captions") } : {}),
    ...(recording || download ? { onMediaPress: () => onToolSheetChange("media") } : {}),
    ...(hasMoreContent ? { onMorePress: () => onToolSheetChange("more") } : {}),
  }}
/>

// WatchScreen, recorded content. Unsupported captions retain a disabled icon.
<PlayerControls
  {...recordedPlaybackProps}
  secondaryTools={{
    mediaKind: "download",
    ...(download || recording ? { onMediaPress: () => onToolSheetChange("media") } : {}),
    ...(hasMoreContent ? { onMorePress: () => onToolSheetChange("more") } : {}),
  }}
/>

// WatchRoute owns the one open-sheet selection and visibility timer.
<WatchScreen
  {...existingWatchProps}
  toolSheet={playerSheet === "quality" ? null : playerSheet}
  onToolSheetChange={changeSheet}
  qualityMenuOpen={playerSheet === "quality"}
  onQualityPress={() => changeSheet("quality")}
  onCloseQualityMenu={() => changeSheet(null)}
/>
```

`hasMoreContent` comes from existing bindings and preferences: usable playerTools with recorded speed or stats enabled, or live engagement. Keep an unsupported native operation's existing explanatory sheet reachable when its binding exists. Do not equate native unavailability with absence of the UI binding.

## Shape

```ts
// player-controls.tsx. Fixed presentation contract, no action registry.
type SecondaryPlayerTools = {
  readonly mediaKind: "download" | "record";
  readonly onCaptionsPress?: () => void;
  readonly onMediaPress?: () => void;
  readonly onMorePress?: () => void;
};

// Add to existing PlayerControls props.
// readonly secondaryTools?: SecondaryPlayerTools;

// watch-screen.tsx. Presentation state remains feature-private.
export type WatchToolSheet = "media" | "captions" | "more" | "speed" | "stats";

// Add to WatchScreen props, replace its local toolSheet useState.
// readonly toolSheet: WatchToolSheet | null;
// readonly onToolSheetChange: (sheet: WatchToolSheet | null) => void;

// watch-route.tsx. One union excludes simultaneous quality and tool modals.
type WatchPlayerSheet = "quality" | WatchToolSheet | null;

function changeSheet(sheet: WatchPlayerSheet): void {
  // TODO: set playerSheet to sheet; revealControls resets the idle token.
  throw new Error("not implemented");
}

function SecondaryToolStrip(props: SecondaryPlayerTools & {
  readonly fullscreen: boolean;
}): React.JSX.Element {
  // TODO: fixed Captions, Download/Record, Ellipsis controls.
  // TODO: callback absence sets disabled and accessibilityState.disabled.
  // TODO: use safe-area padding only when fullscreen occupies window bounds.
  throw new Error("not implemented");
}
```

| Existing module | Responsibility after change |
| --- | --- |
| PlayerControls | Render top tools and bottom playback controls under the same `visible` branch, above the sibling tap catcher. Own icons, localized labels, touch targets, pressed states and safe-area layout. |
| WatchScreen | Derive the fixed callback bundle from supplied caption/media/player bindings; render tool sheet outside the portrait-only content branch; map `PlayerTools.onSelectTool` directly to `onToolSheetChange`. |
| WatchRoute | Replace quality Boolean state with one sheet selection. Derive forced visibility from paused/not-playing or `playerSheet !== null`; reveal on open, navigation and dismiss; retain the existing three-second timer. |
| Existing caption/media/tools components | Keep their operations, eligibility explanations, settings gates, and native failure behavior. |

No new production file is needed. SecondaryToolStrip can remain a private function in player-controls.tsx. `WatchToolSheet` lives beside the WatchScreen prop contract, following the current feature presentation type pattern. No domain, composition or adapter changes are required.

The fixed bundle has one required presentation fact and three optional callbacks. It hides layout, localization, haptics and disabled semantics behind PlayerControls, per minimize-reader-load. WatchScreen retains knowledge of feature bindings and sheet content, per boundary-discipline. The sheet union encodes modal exclusion and avoids a mirrored open-state Boolean, per type-system-discipline. Existing quality callbacks remain the renderer interface; their Boolean value derives from the union rather than separate state.

### Visibility and layout invariants

- Keep `key="player-stage"`, PlayerSurface identity, and sessionId unchanged across fullscreen transitions. Sheet rendering becomes a sibling after the stage, outside `pipSurface || fullscreen` portrait guards.
- Guard tool-sheet visibility with `!pipSurface`; no secondary strip, quality modal, or tool modal appears in PiP. Clear the route's selected sheet when the active presentation enters PiP or the target/session changes, so leaving PiP cannot reopen stale tools.
- Opening, switching and closing a sheet call changeSheet. Closing starts a fresh three-second interval because the idle token changes. While a sheet is selected, forced visibility cancels the hide timer. Video taps retain their existing Info-tab behavior; tool press handlers do not call the tap catcher's callbacks.
- Top tools are right aligned within stage bounds, with three 48dp targets, small gaps and a dark token-backed contrast background. In fullscreen, account for top/left/right safe-area insets. In portrait, use stage-local padding because page layout already positions the stage below system chrome.
- At 411dp, the new strip requires 3 x 48dp plus two 8dp gaps and 16dp side padding, 176dp. It does not consume bottom-row width. Keep the existing bottom wrap behavior for replay and live shield/refresh cases; inspect its tallest replay form against the approximately 231dp portrait stage.
- Use existing mobile design tokens and 26dp icon sizing. Icon-only presentation keeps top chrome compact; localized accessibility labels distinguish download and recording. Unsupported tools keep their slot and disabled state. Job/session busy state does not disable opening its sheet, since progress and cancel controls remain useful.
- The existing caption overlay can cover bottom playback icons because it renders later. During implementation, keep playback controls above the non-interactive caption view and verify a readable cue remains visible; do not introduce a synchronized caption-offset state.

## Synthesis decision

Pending parent synthesis. Candidate A recommends PlayerControls own the complete on-video chrome, with WatchRoute owning the single open-sheet selection.

## Tradeoffs accepted

- We accept three named tool callbacks and one media-label discriminator in exchange for consistent controls that callers cannot accidentally position outside the video.
- We accept moving sheet selection into the route in exchange for one visibility lifecycle and a type that cannot open two sheets together.
- We accept two on-video rows in exchange for retaining 48dp targets without crowding a 411dp bottom transport rail.
- We accept disabled tool slots for absent bindings in exchange for stable positions and clear capability feedback. Existing sheet explanations remain the source of detailed unsupported reasons.

## Alternatives considered

Caller-owned `ReactNode` slot: `PlayerControls topTools={<WatchToolButtons ... />}` would reduce the controls' knowledge of captions/media and hide only positioning. It exposes icon/label/disabled/haptic policy to WatchScreen or a new component, and callers must preserve press handling and sizing. A slot is useful for independently evolving tool sets; this task has a fixed three-tool set and one caller, so the narrower named callback contract hides more required behavior.

WatchScreen-owned absolute toolbar: render the former external buttons as a sibling overlay within player-stage. It avoids new PlayerControls props, but duplicates visibility and safe-area chrome policy between two components. This is weaker interface depth because moving future controls requires repeating layout and lifecycle knowledge.

## Open questions and risks

- Does the native 411dp replay layout leave enough height between the top tool strip and the tallest wrapped bottom rail, including captions? Resolve with the parent's existing emulator verification; this candidate does not claim runtime proof.
- Does MobileBottomSheet stay above the fullscreen stage's zIndex 30 in the native host? Confirm after moving it outside the portrait branch, and preserve its current modal implementation.

## Next implementation step

Replace the route's quality Boolean with the sheet union, then wire WatchScreen's controlled tool selection and the fixed top strip without changing the player-stage mount.

## Red-flag screening

No generic action registry or wrapper layer. The private strip owns a full fixed presentation policy rather than forwarding callbacks through a new public component. Only WatchRoute owns modal selection; callers do not mirror timer state. Feature operations remain behind their current supplied controls, and no native/vendor types enter the new callback contract. Modules remain organized by chrome, screen composition and route state ownership, rather than open/render/close phases.
