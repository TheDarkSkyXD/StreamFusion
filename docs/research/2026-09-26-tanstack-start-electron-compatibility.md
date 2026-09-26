# TanStack Start compatibility with packaged Electron

Research date: 2026-09-26. Research ticket: [Establish TanStack Start compatibility with packaged Electron](https://github.com/TheDarkSkyXD/StreamFusion/issues/236). Parent map: [Migrate the desktop frontend to TanStack Start](https://github.com/TheDarkSkyXD/StreamFusion/issues/235).

Repository baseline: `ee4d5c0e1f1c698ad7551a7a7c011f40fedc5225`. This report records documentation and source inspection. No dependencies were installed, no compatibility prototype ran, and no production runtime was selected.

## Finding

Start's documented SPA mode is the smallest candidate to investigate for this desktop migration. It can supply static client output without runtime server features, but it still renders a shell at build time. Official documentation reviewed here does not establish that Start's generated shell works with Electron's current local-file loading and hash navigation. Packaged compatibility remains unproven. [Start SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)

Keep Electron responsible for credentials, platform access, persistence, downloads, playback services, and IPC. Keep React Icons and current user behavior. A browser product, a backend migration, and unrelated dependency upgrades are outside the user's chosen scope.

## Version evidence

The baseline values below are resolved versions from the committed [lockfile](../../package-lock.json), rather than the broader ranges in the desktop manifest. Published package metadata was queried on the research date.

| Package | Repository baseline | Research candidate or constraint |
| --- | --- | --- |
| `@tanstack/react-start` | Absent | Published `1.168.58`; Node `>=22.12.0`, Vite `>=7.0.0`, React and React DOM `>=18.0.0 || >=19.0.0` |
| `@tanstack/react-router` | `1.170.31` | Start `1.168.58` depends on exactly `1.170.39` |
| `vite` | `7.3.6` | Satisfies Start and existing electron-vite constraints |
| `electron-vite` | `5.0.0` | Vite peer `^5.0.0 || ^6.0.0 || ^7.0.0`; Node `^20.19.0 || >=22.12.0` |
| `@vitejs/plugin-react` | `5.2.0` | Retain for the first experiment |
| `react`, `react-dom` | `19.2.8` | Satisfy Start peers; retain |
| `electron` | `43.4.1` | Retain |
| `react-icons` | `5.7.0` | Retain |
| `better-sqlite3` | `13.0.3` | Retain Electron native rebuild and packaging handling |

Sources: [Start 1.168.58 metadata](https://registry.npmjs.org/@tanstack/react-start/1.168.58), [Router 1.170.39 metadata](https://registry.npmjs.org/@tanstack/react-router/1.170.39), [electron-vite 5.0.0 metadata](https://registry.npmjs.org/electron-vite/5.0.0), and the local lockfile. Latest Vite was `8.3.1`, but electron-vite `5.0.0` does not declare Vite 8 support. Upgrading to latest Vite is therefore not part of this candidate. [Vite 8.3.1 metadata](https://registry.npmjs.org/vite/8.3.1)

The [desktop manifest](../../apps/desktop/package.json) already requires Node `>=22.14.0`, which meets these minimums. The research shell reported Node `24.14.0`; this is an observation, not a new project requirement. The manifest and Vite config also contain Lucide references, but their presence does not override the explicit choice to preserve React Icons.

Required dependency changes for the experiment are adding Start `1.168.58`, aligning the direct Router dependency to `1.170.39`, and resolving their transitive dependencies in the lockfile. Registry compatibility is necessary but does not prove the combined build works. Recheck metadata when the experiment starts because latest documentation and package tags can change.

## What the existing desktop requires

| Existing behavior | Source evidence | Compatibility implication |
| --- | --- | --- |
| Development uses `ELECTRON_RENDERER_URL`; production loads `../renderer/index.html` | [window manager](../../apps/desktop/src/backend/window-manager.ts) | Output location and document URL are runtime contracts |
| Router uses `createHashHistory()` | [router](../../apps/desktop/src/frontend/routes/router.tsx) | Preserve nested hash routes, back/forward, and reload behavior |
| IPC trusts the development URL or the production file document | [trusted document URL](../../apps/desktop/src/backend/ipc/trusted-document-url.ts) | Any origin change needs a deliberate IPC trust migration |
| Main, two preload entries, app HTML, and a separate vanilla TypeScript slot HTML build together | [electron-vite config](../../apps/desktop/electron.vite.config.ts) | Start cannot silently replace or drop the isolated player build |
| Slot views load their own document and preload | [view factory](../../apps/desktop/src/backend/features/multistream/adapters/electron/webcontents-view-factory.ts) | Preserve slot process isolation and asset paths |
| Renderer entry reads `window` and `document` and installs hooks during evaluation | [renderer entry](../../apps/desktop/src/frontend/renderer.tsx) | Existing bootstrap cannot simply become a server-evaluated root module |
| App owns auth, query, language, recovery, and toast providers | [App](../../apps/desktop/src/frontend/App.tsx) | Preserve initialization and provider ownership |
| Dev-only browser entry proxies HTTP and WebSocket traffic with a per-run token | [relay config](../../apps/desktop/src/frontend/dev-relay/config.ts), [development launcher](../../apps/desktop/scripts/start-dev.js) | Preserve this development tool without expanding product scope |
| Builder packages `out/**/*`, keeps main at `out/main/index.js`, unpacks SQLite and FFmpeg, and disables automatic rebuild in favor of explicit scripts | [desktop manifest](../../apps/desktop/package.json) | Keep native artifacts and assembled output in the package |

## Documented support and remaining uncertainty

### Static output and build-time execution

Documented: `tanstackStart({ spa: { enabled: true } })` adds a prerender pass for the root route. The default shell is `/_shell.html`; its output path is configurable. Matched child routes use the pending fallback during shell generation. Root loaders and server-side code still participate. Static hosting is sufficient when runtime server functions and server routes are unused; the usual web deployment rewrites unmatched document requests to the shell. [SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)

Documented: Start code is isomorphic unless constrained. `ClientOnly` defers its children until hydration. `createClientOnlyFn` throws if called on the server, so wrapping a function does not make a server invocation safe. [Execution model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model)

Inference: the desktop root can keep its shell safe for build-time rendering while initiating preload-dependent providers on the client. Imported modules must also be safe to evaluate; hiding rendered content alone does not guard top-level imports. The exact boundary needs an experiment with existing bootstrap code. Keep platform workflows on the preload bridge rather than introducing Start server functions for them.

### Hash routing and asset URLs

Documented: TanStack Router supports hash history for environments that cannot rewrite document requests. This establishes Router behavior, not Start hydration under Electron. [History types](https://tanstack.com/router/latest/docs/guide/history-types)

Documented: Vite offers relative asset bases using `./` or an empty base. This is a Vite capability, not proof that Start's shell generation, manifest, and hydration support the same combination. [Vite build documentation](https://vite.dev/guide/build.html#relative-base)

Prototype required: load the emitted shell through the existing file document path, inspect generated script/CSS/dynamic-import URLs, and verify initial deep hash navigation plus reload. Do not infer success from a development HTTP server.

Documented alternative: Electron can serve bundled assets through a custom protocol. A standard scheme supports relative URL resolution and storage; registration occurs before app readiness, and handlers must use the appropriate session. Electron documents path containment checks for file serving. [Electron protocol API](https://www.electronjs.org/docs/latest/api/protocol)

Inference: a custom protocol could address URL assumptions if local-file loading fails. It also changes the origin and affects IPC trust, storage, CSP, and slot loading. That tradeoff belongs to the runtime decision, after evidence. A local HTTP server is another candidate, with lifecycle and endpoint responsibilities that have not been justified or selected here.

### Build ownership and packaging

Documented: the Start Vite plugin goes before the React plugin; Start expects router and root-route setup. [Build from scratch](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch)

Documented: electron-vite supports custom main, preload, and renderer entry points, including multiple renderer pages. Preload is the bridge for privileged functionality. [electron-vite development guide](https://electron-vite.org/guide/dev)

Inference: retain electron-vite for main/preload and the vanilla slot entry, and first test a separate Start renderer build with explicit output assembly. There is no verified evidence here that inserting Start into the existing renderer plugin array preserves both build orchestrators. Separate output directories avoid one build cleaning another's artifacts. This is an experiment design, not a production topology decision.

Documented: native modules may need rebuilding for Electron's ABI. [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

Prototype required: inspect the packaged output and run it without a dev server. SQLite, FFmpeg, preload paths, slot paths, CSP, and lazily loaded chunks must survive packaging. Build-time Start rendering must not initialize privileged Electron services or accidentally load native modules into the server build.

### Development relay

Inference from the relay source: Start development must retain the relay proxy path, WebSocket upgrade handling, token injection, browser entry bootstrap order, and Electron host connection. The dev-only browser page is existing tooling. Whether Start's request handling can coexist with that page and the slot page on one origin is unproven. Separate dev servers would require explicit URL routing and launcher lifecycle work.

## Smallest next experiment

Create a disposable compatibility experiment after the runtime decision ticket authorizes it. Use the pinned candidate versions above and preserve the current Electron backend.

1. Build a Start SPA shell with one ordinary route and one lazy route. Use hash navigation and a client boundary that invokes one existing allowlisted preload read. Verify that build-time shell generation never invokes Electron APIs.
2. Assemble the shell and assets into a candidate package beside existing main/preload and slot artifacts. Try current local-file loading first. Record emitted paths, CSP behavior, console errors, and any attempted server requests.
3. Launch the packaged app with the dev server stopped. Verify first launch, deep hash navigation, reload, back/forward, lazy chunks, React Icons, preload availability, and a real slot view. Verify a SQLite-backed read and FFmpeg discovery through existing backend paths.
4. Exercise the normal Electron development launcher, renderer HMR, and existing browser relay including an HTTP call and WebSocket event. Confirm that production artifacts contain no enabled dev relay.
5. Record pass/fail evidence. If file loading fails, identify the concrete failing assumption before testing custom protocol or loopback HTTP. Present the smallest proven option to the runtime decision ticket.

This experiment proves the integration boundary only. Full behavior preservation still needs route/provider migration and the desktop regression inventory in later map decisions.
