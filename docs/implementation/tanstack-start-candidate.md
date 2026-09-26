# TanStack Start desktop candidate

The candidate implements the frontend migration in [issue 234](https://github.com/TheDarkSkyXD/StreamFusion/issues/234). It remains opt-in. The [accepted adoption gates](https://github.com/TheDarkSkyXD/StreamFusion/issues/240#issuecomment-5845969433) require complete desktop, package, data and performance proof before switching the defaults.

## Run the candidate

Run these commands from the repository root with the installed workspace dependencies.

```powershell
npm run dev:start --workspace streamfusion
npm run dev:start:browser --workspace streamfusion
npm run build:start --workspace streamfusion
npm run preview:start --workspace streamfusion
npm run package:start --workspace streamfusion -- --win --x64 --dir
```

The browser command also starts Electron. Open the printed `browser.html` URL to use the existing development relay. The responsive browser view keeps Electron as its backend. A standalone website is outside the agreed scope. Desktop visual parity precedes the narrow-screen layout work.

Below 1024 pixels, navigation opens in a keyboard-accessible drawer and search moves to a second header row. Settings uses the existing category registry in a compact selector. Stream and MultiView stack video and chat without replacing their player trees. Home, Following, player controls and chat actions adapt to smaller widths. Desktop sidebar preferences and React Icons remain in use.

`build:start` writes `.cache/start/app` inside `apps/desktop`. `package:start` packages that output into `.cache/start/package`. Build before packaging. The default `dev`, `build`, `preview`, and release commands still use the existing renderer.

For isolated verification, use the [maintained desktop controller](../../.agents/skills/verify-streamfusion/SKILL.md) with `--mode dev:start` or `--mode preview:start`. Run `node apps/desktop/scripts/verify-start-runtime.mjs <run.json>` after the controller's doctor passes to retain local-file reload, CSP and hydration diagnostics.

## Architecture

Electron still owns IPC, authentication, SQLite, FFmpeg, updates and windows. Start owns the primary renderer build. Its server output exists only for build-time prerendering and development. The package receives client output, main and preload bundles, and the independent isolated-player renderer.

The local-file assembly step preserves the existing production CSP. It externalizes executable bootstrap scripts and rejects unresolved or root-absolute local assets. It does not start an HTTP server in the installed app. Hash routes keep the existing URL and storage model.

The virtual manifest registers 14 feature-owned routes and the existing app layout. Shared providers receive the active router's navigation function. The client-only runtime prevents browser-dependent modules from evaluating during prerendering. Existing React Icons, screens, search validation, recovery boundaries and nested lazy preloads remain in use.

Start automatic component splitting is disabled because it hides the existing component preload contract. Feature components still use their existing lazy imports. `routes:check`, included in typecheck, verifies reproducible generated output.

Start is pinned to 1.168.56 and Router to 1.170.38. These satisfy the repository's seven-day npm release delay. Start and its route generator are development dependencies. Both preloads build separately because the installed Electron Vite experimental isolated-entry builder fails with redirected output.

## Verification record

Baseline source is `781e53f32d5cc820b9a0114a6a6ee4e8636446e6`. Local artifacts are retained under `.scratch/start-migration` and `.scratch/verify-streamfusion/evidence`. The [decision trail](tanstack-start-decisions.tsv) records choices and evidence paths.

Observed checks include the full deterministic suite with 7,776 passing tests across 647 files, type checking, lint, candidate build and route generation, and compiled local-file rendering with the preload bridge and SQLite. Desktop navigation and live Twitch content rendered. Reload preserved the production script CSP with zero executable inline scripts and no hydration or CSP errors.

Development verification observed React hot reload without a new document, successful primary and isolated-player preload rebuild reloads, browser relay navigation and reload, and server/output cleanup after closing Electron. Review then found Vite's process-exit handlers could race launcher cleanup. The launcher now owns HTTP and uses Vite middleware mode. React HMR, both preloads and Electron configuration restart passed again with this launcher. A subsequent browser check exposed duplicate WebSocket proxy handlers after configuration restart. Retiring each Vite generation's handler fixed this failure. Browser reload passed before and after configuration restart, and closing Electron released both ports and its temporary output. The Chrome profile's Dark Reader extension also injected an HTML attribute that caused a browser-only hydration warning. No suppression was added.

The existing integration tests now exercise both real route trees. They verify notification navigation while language initialization is pending, navigation after initialization, listener disposal, and Stream preloading that waits for its nested chat module. Both chat component suites assert that viewing a resolved user channel uses the active router. These tests complement the runtime checks; compiled nested preloading and live authentication readiness still need adoption evidence.

The Windows x64 directory package built. The archive contains both renderers, both preloads and the native SQLite binary, with no Start server packages. Its FFmpeg executable ran successfully. The real packaged executable started with an isolated profile and created its database. Removing the forced renderer accessibility disable allowed native accessibility inspection and navigation from Home to Settings. Both screens rendered in retained screenshots. Packaged remote debugging remains disabled. This exploratory proof lacks a complete artifact identity and action record, so repeatable exact-package verification remains an adoption gate.

The manual `start-candidate.yml` workflow builds unsigned macOS x64 and arm64 candidates and checks the copied packages outside the checkout. Its verifier records native accessibility navigation, screenshots, SQLite integrity, FFmpeg execution, logs and artifact hashes. Its runtime result remains unverified until both matrix jobs complete.

The first repository CI run passed the desktop suite but failed pre-existing mobile lint checks. The follow-up repairs mobile architecture boundaries, persistent scrubber measurements and disabled connectivity state. Mobile lint, types, tests, architecture checks and the Android bundle passed locally. Repository CI must confirm the repair.

Subsequent CI passed the mobile checks and exposed two desktop test-environment failures. The native macOS verifier test now runs in Node, and each renderer's deferred chat preload test gets an isolated module gate. The responsive change passed 7,787 tests across 649 files locally, plus type checking, lint and the Start production build. The macOS package verifier now checks the architecture-specific SQLite prebuild path observed in the real arm64 archive. Both native macOS runs still need to pass with this correction.

Live browser checks covered 390, 768 and 1440 pixel widths. Home, Settings, navigation and the Add Stream dialog fit their containers. Twitch video and chat rendered in Stream and MultiView. Resizing preserved the video source and advancing playback time. A final isolated Electron run rendered Home and Settings with native window controls and passed database integrity checks. Evidence is in `.scratch/verify-streamfusion/evidence/responsive-layout-proof`; browser observations are retained in the task transcript. These checks establish observed layout parity, not a pixel-exact image comparison. React Doctor reported no errors and eight complexity warnings in existing large components; those same functions also triggered complexity warnings in the baseline source.

Clean baseline and candidate idle/navigation runs each lasted five minutes, sampled every 15 seconds, and cycled the same six routes every 30 seconds. Both passed the existing limits with 19 samples and no renderer exceptions. No builds overlapped these runs. These are compiled-app measurements, not installed-package or sustained playback measurements.

| Measurement            |  Baseline | Start candidate |
| ---------------------- | --------: | --------------: |
| Peak resident memory   | 763.0 MiB |       746.5 MiB |
| Resident memory growth |  40.9 MiB |         5.7 MiB |
| CPU p95                |     3.47% |           1.86% |
| Frame time p95         |   16.8 ms |         16.8 ms |
| Processes              |         5 |               5 |

One matched pair does not establish a performance improvement or repeatable variation. These measurements predate the accessibility change. The earlier contaminated baseline remains in the trail as smoke evidence.

## Remaining adoption gates

- Authenticated playback, chat, notifications, moderation, download, account recovery and provider-specific parity remain pending. The user requested continued work without accounts. These checks do not block signed-out implementation, but cannot be claimed as passed.
- Retain reproducible exact-artifact Windows UI, SQLite, FFmpeg and sandboxed isolated-player evidence independently of repository dependencies. Build and boot macOS x64 and arm64 packages. Preserve the Linux target.
- Exercise a synthetic profile through old app, candidate, restart and rollback. Include preferences, local follows, history and browser storage.
- Repeat matched measurements to establish baseline variation and exercise sustained playback load.
- Verify compiled Stream's nested chat preload completes before navigation. Source integration tests pass; inspecting preload functions on all 14 compiled route components does not establish that behavior.
- Prove live initialization and disposal under pending auth readiness and repeated runtime hot replacement without duplicate subscriptions. Deferred language initialization and notification cleanup pass in the integration tests.
- Run repository CI and reverify the exact final default-switch artifacts when these gates pass.

Keep issue 234 open until adoption is complete. Do not change default scripts or remove the existing renderer based on this candidate alone. Retain the baseline package and lockfile recorded locally. Roll back with a new commit and preserved user data. Do not uninstall as rollback because the Windows uninstaller deletes app data.
