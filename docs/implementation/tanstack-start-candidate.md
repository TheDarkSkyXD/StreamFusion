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

The browser command also starts Electron. Open the printed `browser.html` URL to use the existing development relay. This is a desktop development tool, not a browser product build.

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

The Windows x64 directory package built. The archive contains both renderers, both preloads and the native SQLite binary, with no Start server packages. Its FFmpeg executable ran successfully. The real packaged executable started with an isolated profile and created its database. Its existing policy disables remote debugging, so the desktop controller could not inspect that packaged window. This is not a packaged UI pass. Native package UI verification requires an available native desktop driver or a manual run, without changing that policy.

Clean baseline and candidate idle/navigation runs each lasted five minutes, sampled every 15 seconds, and cycled the same six routes every 30 seconds. Both passed the existing limits with 19 samples and no renderer exceptions. No builds overlapped these runs. These are compiled-app measurements, not installed-package or sustained playback measurements.

| Measurement            |  Baseline | Start candidate |
| ---------------------- | --------: | --------------: |
| Peak resident memory   | 763.0 MiB |       746.5 MiB |
| Resident memory growth |  40.9 MiB |         5.7 MiB |
| CPU p95                |     3.47% |           1.86% |
| Frame time p95         |   16.8 ms |         16.8 ms |
| Processes              |         5 |               5 |

One matched pair does not establish a performance improvement or repeatable variation. The earlier contaminated baseline remains in the trail as smoke evidence.

## Remaining adoption gates

- Complete authenticated playback, chat, notifications, moderation, download, account recovery and provider-specific parity with dedicated test accounts.
- Prove packaged Windows UI, SQLite, FFmpeg and sandboxed isolated-player behavior independently of repository dependencies. Build and boot macOS x64 and arm64 packages. Preserve the Linux target.
- Exercise a synthetic profile through old app, candidate, restart and rollback. Include preferences, local follows, history and browser storage.
- Repeat matched measurements to establish baseline variation and exercise sustained playback load.
- Verify compiled Stream's nested chat preload completes before navigation. Source integration tests pass; inspecting preload functions on all 14 compiled route components does not establish that behavior.
- Prove live initialization and disposal under pending auth readiness and repeated runtime hot replacement without duplicate subscriptions. Deferred language initialization and notification cleanup pass in the integration tests.
- Run repository CI and reverify the exact final default-switch artifacts when these gates pass.

Keep issue 234 open until adoption is complete. Do not change default scripts or remove the existing renderer based on this candidate alone. Retain the baseline package and lockfile recorded locally. Roll back with a new commit and preserved user data. Do not uninstall as rollback because the Windows uninstaller deletes app data.
