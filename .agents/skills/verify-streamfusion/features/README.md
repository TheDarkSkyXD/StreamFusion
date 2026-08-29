# StreamFusion verification map

This directory is the maintained source for proving StreamFusion's desktop behavior. Read this index first, then run the feature recipe that matches the user's path.

## Baseline preconditions

- Run commands from the repository root with Node 22 or later and installed desktop dependencies.
- Launch a new disposable instance through `verify-streamfusion` and keep `$verifyRun` set to its `run.json` path.
- Run `doctor --run $verifyRun` and require `healthy: true`.
- Run `database --run $verifyRun --output database.json` and require `healthy: true`. The launch uses a WAL-consistent snapshot when a live development database exists.
- Never drive an existing developer instance or a run created by another agent.
- Start from the Home route unless a feature recipe says otherwise.
- Treat Twitch and Kick responses as external state. Record whether the app shows data, an empty state, or a provider error.

## Driving conventions

- Prefer links, buttons, and textboxes by role and accessible name.
- Capture before and after state with both `snapshot` and `screenshot`.
- Wait for visible text or the target hash. Do not use fixed sleeps.
- Use direct hash evaluation only for a documented deep-link entry or when a click target cannot exist without provider data.
- Do not call Zustand setters, preload methods, IPC handlers, or Platform clients as proof of a user path.
- Run cleanup after success and after every failed attempt.

## Proof and skip reporting

- Pair the user action in `actions.ndjson` with the resulting screenshot and semantic snapshot.
- Keep `launch.log` and record a final `logs --lines 120` check.
- Verify persistent mutations from another visible page or from the user-owned output file.
- State the exact provider, Channel, Video, or Clip used for live network checks.
- Report an unavailable provider or missing authentication as an unmet precondition. Do not claim a skipped path passed through another entry point.
- Cleanup must remove the run profile while leaving `.scratch/verify-streamfusion/evidence/<run-id>/` intact.

## Feature entry contract

Each feature file has one user-visible description and exactly four H2 sections. `Sub-features` names the behaviors. `How to get to it (user POV)` lists user entry points. `Driving it with streamfusion-control` gives literal commands and observable results. `Gotchas` records state and provider traps.

## Features

- [Browse and navigate](./browse-and-navigate.md) covers Home and the primary sidebar routes.
- [Search](./search.md) covers global search submission, results chrome, and the generic empty state.
- [Watch a stream](./watch-stream.md) covers opening a Twitch or Kick Channel and observing player, offline, and chat states.
- [MultiStream](./multistream.md) covers empty layout controls and the Add Stream dialog.
- [Settings](./settings.md) covers settings navigation, account controls, and version information.
