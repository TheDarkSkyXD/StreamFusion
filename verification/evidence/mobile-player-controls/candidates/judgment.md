# Player controls design judgment

## Verdict

Use **candidate B** as the implementation base. Move the three existing secondary actions into the keyed player stage in `WatchScreen`, remove the entire five-button row below the video, and leave `PlayerControls` responsible for its existing quality, fullscreen, and transport controls. Move the secondary sheet outside the portrait-only branch. The route should own the selected secondary sheet so an open sheet holds the existing three-second chrome timer.

## Why B wins

The current split already matches B. `PlayerControls` owns the stage tap catcher, bottom rail, and quality modal (`player-controls.tsx:114-130, 133-299`). `WatchScreen` owns the five external buttons and all secondary sheet content (`watch-screen.tsx:458-568`). B moves that content within its existing owner and adds one controlled presentation value to the route. A also meets the placement goal, but adds Watch-specific captions, media, and more props to the generic transport component and changes the quality state contract. A's conditional `hasMoreContent` would also change the currently always-enabled More button unless carefully constrained.

At 411dp, a top row of three 48dp targets plus gaps and stage padding fits the 411 by roughly 231dp portrait stage without taking width from the bottom transport rail. This is a layout estimate, not native proof. The top row must sit above `PlayerControls`' full-stage tap catcher, use the landscape safe-area insets, and leave the non-interactive caption cue readable. The existing caption overlay renders after the controls and has `pointerEvents="none"` (`watch-caption-overlay.tsx:13-27`).

The sheet must remain mounted as a sibling of the stage, outside `pipSurface || fullscreen` content guards (`watch-screen.tsx:434-568`). `MobileBottomSheet` uses a native `Modal` (`bottom-sheet.tsx:30-38`), so the intended fullscreen stacking is plausible, but needs a device check. Keep `key="player-stage"` and the `PlayerSurface` tree position (`watch-screen.tsx:242-251`). Hide the strip and sheet in PiP and clear the route's selected sheet on PiP entry and target or session change.

## Bounded implementation and gates

Keep the three slots stable and preserve the current disabled caption and media behavior. Keep More reachable as it is today. Use the route's selected sheet as the visibility hold (`watch-route.tsx:276-289`); opening and dismissal must reveal controls and start a fresh three-second interval. Prevent secondary presses from invoking the video tap callback, which switches to Info (`watch-route.tsx:327-329`). Avoid a new action registry, new native API, or changes to playback operations.

Update the existing watch tests for stage ancestry, unique quality and fullscreen controls, disabled targets, sheet dismissal and timer behavior, PiP cleanup, and one player mount across fullscreen (`watch-fullscreen-mount.test.ts`). Check the 411dp portrait and landscape native layout by tapping all three tools, opening sheets in fullscreen, and reading captions over both chrome states. The current source and tests establish ownership and mount structure; neither candidate supplies native tap or safe-area evidence.
