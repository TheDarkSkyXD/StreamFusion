# TanStack Start local-file prototype

Date: 2026-09-26. Ticket: [Validate the selected Start setup in a packaged Electron prototype](https://github.com/TheDarkSkyXD/StreamFusion/issues/238).

The user selected [existing local-file loading with a separate Start renderer build](https://github.com/TheDarkSkyXD/StreamFusion/issues/237#issuecomment-5845574016). This experiment tested its first prerequisite. The unchanged Start output failed to start from a packaged Electron file document. Diagnostic output transformations restored rendering but still produced a hydration error. The full compatibility gate has not passed.

## Reproduce and inspect

Run the [disposable probe](prototypes/tanstack-start-local-file/README.md) with one command. Its committed source, lockfile, [runtime observations](prototypes/tanstack-start-local-file/evidence/results.json), screenshots and [build log](prototypes/tanstack-start-local-file/evidence/build.log) preserve the evidence.

The one-command reproduction independently produced the same four results and exited 1 for the failing candidate. That runner removed its disposable profile. The original scratch profile remains after automatic approval review rejected its cleanup command.

The probe ran in an unpacked Windows package with `app.isPackaged === true`, Electron 43.4.1, and Chromium 150.0.7871.224. It loaded HTML from `resources/app.asar` without a development server. This was a minimal Electron package, not the complete StreamFusion application or an installed NSIS build. It used an isolated profile and matched the relevant existing BrowserWindow settings: context isolation enabled, Node integration disabled, sandbox disabled, and web security disabled. These are observed baseline settings, not recommendations to change security policy.

Pinned versions were Start 1.168.58, Router 1.170.39, Start plugin core 1.171.47, Vite 7.3.6, React and React DOM 19.2.8, and React Icons 5.7.0.

## Observed results

| Variant | Result |
| --- | --- |
| Start SPA output with `base: './'` | Build and prerender succeeded. Emitted module paths still began `/./assets/`. Electron resolved them to `file:///F:/assets/...`, returned `ERR_FILE_NOT_FOUND`, and never hydrated the shell. |
| Diagnostic relative asset rewrite | The root and Home rendered, but React reported error 418. This run omitted production CSP solely to isolate the asset-path failure. |
| Relative rewrite plus the unchanged production CSP | Inline Start bootstrap scripts were blocked by `script-src 'self'`. The renderer became blank and reported an undefined-bootstrap TypeError. |
| Relative rewrite plus external bootstrap files and unchanged CSP | Home and React Icons rendered with no failed asset requests or CSP errors, but React still reported error 418. The startup gate therefore remained failed. |

An earlier run also inherited the router base from the relative asset base and did not render child routes. Setting `router.basepath: '/'` made Home render. The committed results use that explicit setting.

The installed Start plugin source explains the asset-path behavior: `normalizePublicBase` in `@tanstack/start-plugin-core/src/planning.ts` prefixes non-absolute bases with `/`, and the Vite manifest uses that normalized base. This is evidence about the pinned version, not a claim that every Start release behaves identically.

React defines error 418 as a mismatch between server-rendered and client-rendered output, followed by client regeneration. The exact mismatched markup in this probe has not been diagnosed. Possible fixes require evidence from a development diagnostic build; rendering after recovery does not meet the no-hydration-failure criterion. [React error 418](https://react.dev/errors/418)

## Scope of the evidence

The experiment established a real packaged loading failure and isolated independent asset-path and CSP requirements. It did not establish that local-file Start is impossible. The final diagnostic suggests an output adapter may preserve both local-file loading and the current CSP, but the adapter is not accepted or production-ready.

The following original acceptance checks remain untested because startup failed: full-app preload/IPC trust, isolated player operation, preference retention across upgrade/restart, SQLite reads, FFmpeg discovery, navigation/reload/back/forward/search-state behavior, network-unavailable app behavior, development HMR, and the browser relay. There was no production dependency change, custom protocol, HTTP server, security relaxation, or real-user data access.

## Decision needed

Recommend continuing the local-file experiment with an explicit compatibility adapter, first diagnosing the hydration mismatch and replacing the diagnostic string transformations with a supported build integration if one exists. Keep the existing CSP. Changing to a custom protocol could address URL resolution, but does not itself address inline script CSP or prove hydration correctness.

The prototype ticket stays open pending the user's verdict on that direction. No full desktop migration or runtime fallback is approved by this report.
