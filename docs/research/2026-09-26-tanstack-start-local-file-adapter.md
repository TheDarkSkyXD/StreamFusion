# TanStack Start local-file adapter experiment

Date: 2026-09-26. Ticket: [Validate the selected Start setup in a packaged Electron prototype](https://github.com/TheDarkSkyXD/StreamFusion/issues/238).

The user requested continued local-file investigation: fix hydration and test a compatibility adapter while preserving CSP. The packaged integration probe now passes with the existing compiled StreamFusion main process and its allowlisted preload bridge. This establishes a workable candidate for the pinned dependencies, not completion of the frontend migration. React Icons remains in use.

## What fixed startup

The [initial experiment](2026-09-26-tanstack-start-local-file-prototype.md) isolated asset-path, CSP and hydration failures. A development diagnostic build exposed two hydration differences: prerendered links used path URLs while the desktop client used hash URLs, and the prerendered route placeholder differed from the client route content. The [diagnostic output](prototypes/tanstack-start-local-file/evidence-fixed/hydration-diagnosis.json) preserves React's markup differences. React treats these mismatches as hydration failures followed by client regeneration. [React error 418](https://react.dev/errors/418)

The candidate makes three renderer changes:

- Set `router.basepath` explicitly to `/`, independently of the relative asset base.
- Put navigation and the route outlet inside Router's `ClientOnly`, with the same initial fallback in the prerendered shell and client. The document shell still hydrates; hash-dependent route content renders after mounting.
- Rewrite emitted `/./assets/` references to relative paths and move inline bootstrap bodies into adjacent script files. Copy the existing production CSP unchanged, retaining `script-src 'self'`.

The [root route](prototypes/tanstack-start-local-file/fixed/src/routes/__root.tsx) and [output assembly probe](prototypes/tanstack-start-local-file/source/assemble.mjs) make these changes reviewable. The latter is deliberately a small, version-specific transformation, not a production HTML parser. It needs an owned build integration and checks against future Start output changes before production use. No HTTP server or custom protocol was introduced.

## Observed packaged behavior

Run the [one-command integration probe](prototypes/tanstack-start-local-file/README.md) to reproduce. It uses an unpacked Windows Electron 43.4.1 package with `app.isPackaged === true`, loading `out/renderer/index.html` inside `app.asar`. The existing compiled main retains its real IPC trust checks and backend services. Only the copied renderer, the diagnostic launch wrapper and the copied slot preload build differ. The wrapper directs all persistence to an isolated synthetic profile and disables external networking.

The [summary](prototypes/tanstack-start-local-file/evidence-fixed/summary.json) records a passing exit, two launches with no console or preload errors, and the original compiled main's SHA-256. Detailed [initial observations](prototypes/tanstack-start-local-file/evidence-fixed/initial.json), [restart observations](prototypes/tanstack-start-local-file/evidence-fixed/restart.json), and [restart screenshot](prototypes/tanstack-start-local-file/evidence-fixed/restart.png) show:

| Check | Observed result |
| --- | --- |
| Startup with production CSP | Interactive renderer; no hydration, asset-load or CSP errors reported. React Icons renders. |
| Navigation and search | UI clicks enter Details with `tab=saved`; reload, back and forward retain the expected route/search behavior. |
| Real preload/IPC | UI controls read app version, preferences and local follows through the existing bridge. |
| Saved state | A synthetic theme preference and `localStorage` note survive reload and a process restart using the same packaged path/profile. |
| SQLite | Real follows read succeeds; a read-only integrity check returns `quick_check: ok`. |
| Native executable | Packaged FFmpeg resolves from `app.asar.unpacked` and exits 0 for `-version`. |
| Separate player | UI creates and destroys the existing slot renderer. Its document contains the video element and exposes `slotAPI`, without the full `electronAPI`. Sandbox and context isolation remain enabled; Node integration remains disabled. |
| External network unavailable | These local startup, navigation, persistence and player-document operations complete offline. |

The main window keeps its existing security settings. No CSP relaxation or additional privileged renderer API was needed. The player experiment enables the existing `STREAMFUSION_WEBCONTENTS_VIEW_SLOTS=1` opt-in only for the disposable launch.

## Player preload packaging finding

The first full-backend run loaded the separate player document but failed its preload: the current compiled `slot.js` requires `./chunks/ipc-channels-3vfJ_Fio.js`. The sandboxed renderer could not resolve that local module, so `slotAPI` was missing. The [original-slot evidence](prototypes/tanstack-start-local-file/evidence-fixed/restart-original-slot.json) records the exact preload error.

Bundling the existing slot preload source into a single CommonJS file, with `electron` external, fixed the disposable package. Both final launches expose only the narrow player bridge with sandboxing intact. This accords with Electron's documented restricted `require` in sandboxed preloads and recommendation to bundle preload dependencies. [Electron sandbox documentation](https://www.electronjs.org/docs/latest/tutorial/sandbox)

This is a packaging issue in the compiled baseline encountered during integration, not evidence that Start requires disabling the sandbox. Production source and build configuration are unchanged. The eventual build design must keep the isolated player entry and ensure its sandboxed preload is self-contained.

## Limits and next decision

This probe covers a small client-only route tree, not the existing app's full auth, Query, localization, recovery or notification providers. It does not prove live playback, authenticated services, chat, real-user upgrades, an NSIS installation, macOS/Linux packaging, development HMR or the development relay. Browser storage was checked at one stable packaged path across restart; storage continuity across a real upgrade remains an acceptance requirement.

The adapter preserves the existing local-file mechanism and relative renderer location. It does not establish a general guarantee about `file:` origins across packaging or install-path changes. No credentials or real user data were used. The reproduction removes its own synthetic profile; the original failed experiment's profile remains after its cleanup was rejected by automatic approval review.

Recommend retaining this local-file direction for the next route/provider and build-ownership decision. Carry forward the explicit client-only boundary, version-sensitive output adapter, unchanged CSP, and self-contained sandboxed preload as requirements. Keep the prototype ticket open until the user reviews these observations and explicitly accepts the direction or requests another experiment. Full desktop acceptance and rollback criteria remain later planning work.
