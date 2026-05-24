---
date: 2026-05-23
topic: backend-layer-architecture-refactor
---

# Backend Layer Architecture Refactor — Reduce Cross-File Churn

## Summary

Three co-shipped refactors that together cut the number of files a typical change has to touch and the blast radius of a per-platform change. Motivated by 2026-05-23's follow-push-sync investigation (`docs/solutions/integration-issues/follow-push-sync-infeasible-2026-05-23.md`), where a single feature probe touched 8 unrelated files because IPC plumbing is split across 3 locations and the platform clients mix HTTP/auth/endpoint logic in one file each.

The three units:

1. **Co-located per-feature IPC modules + type-only contract + generic typed invoker.** New IPC = one feature folder (2 files) + one line in the shared contract type. Renames break compile in every caller. Preload stops being touched per feature.
2. **Platform client thin-coordinator refactor.** Split `twitch-client.ts` (366 lines) and `kick-client.ts` (816 lines, flagged as "God Object" in `apps/desktop/src/backend/api/platforms/AGENTS.md`) into thin HTTP/auth coordinators with endpoint logic moved into `endpoints/*.ts`. Cut criterion: changing one endpoint should touch one file.
3. **e2e harness via debug-electron-mcp.** New test surface, separate from the 485 unit tests, that drives a running app to catch failures unit tests can't — env-var clobber, real BrowserWindow lifecycle, real IPC roundtrips, real `session.defaultSession` cookies.

The three are independent — none blocks another — but ship as one brainstorm because they share the same motivation and overlap on the touched surface (the IPC refactor and the e2e harness both have opinions about how features should be testable).

---

## Problem Frame

### What hurts today

**IPC plumbing is 3-file ceremony per channel.** Adding `FOLLOWS_ADD` means:

- Edit `apps/desktop/src/shared/ipc-channels.ts` (309 lines, growing) to add the channel constant
- Edit `apps/desktop/src/backend/ipc/handlers/<area>-handlers.ts` to register the `ipcMain.handle(...)` and write the handler body
- Edit `apps/desktop/src/preload/index.ts` (701 lines) to add the `contextBridge` binding

A rename = 3 places. A missed update = silent IPC failure at runtime. The renderer call site (`window.api.followsAdd(arg)`) is `arg: any` because nothing carries the request/response type across the boundary.

**Platform clients mix layers.** `kick-client.ts` is 816 lines combining HTTP (electron.net), auth (token refresh, dual-token strategy), retries, and per-endpoint logic. `twitch-client.ts` is smaller (366 lines) but still mixes Helix + GQL + auth. AGENTS.md already flags both as anti-patterns ("kick-client.ts: Mixes HTTP, auth, retries, and API proxying") but nothing has triggered the fix.

**No e2e safety net.** Unit tests (485 passing) cover pure functions and mocked-DB integration well, but cannot catch:

- `ELECTRON_RUN_AS_NODE=1` env-var clobber (today's `TypeError: Cannot read properties of undefined (reading 'isPackaged')`)
- Preload binding present in `preload/index.ts` but missing handler registration in main (silent IPC failure)
- BrowserWindow lifecycle bugs (acquire/release ordering, GPU subprocess contention)
- Real-cookie-jar behavior in `session.defaultSession` differing from mocks
- Renderer ↔ main type drift when one side updates a payload shape and the other doesn't

### Why this matters now

The 2026-05-23 push-sync investigation touched 8 files for a feature that was eventually reverted: `follow-store.ts`, `storage-handlers.ts`, `ipc-channels.ts`, `preload/index.ts`, `follow-button.tsx`, two new files in `platforms/twitch/`, one in `platforms/kick/`. Most of that churn was IPC plumbing for what is conceptually one operation ("push follow to platform"). The platform-specific logic itself was small; the wiring dwarfed it.

Going forward, the cost of every new feature carries this same tax. The refactor isn't speculative — it's amortizing pain we already paid yesterday.

---

## Requirements

### Unit 1 — Per-feature IPC modules + typed contract + generic invoker

**Feature module convention**

- R1. A new directory convention SHALL be introduced: `apps/desktop/src/backend/features/<name>/` for each IPC-bearing feature.
- R2. Each feature directory SHALL contain at minimum two files:
  - `<name>.contract.ts` — channel name constants + request/response TYPES only. No runtime code, no Node-only imports. Compiles in renderer, preload, and main contexts.
  - `<name>.handler.ts` — main-process implementation. Imports the contract for types. May import Node-only modules (`node:sqlite`, `electron`, services). Exports an array of `{ channel, fn }` registration entries.
- R3. A feature MAY contain additional files (helpers, types, sub-handlers) as the implementation grows. The two-file minimum is the contract surface.
- R4. Existing IPC code SHALL remain functional. Migration is incremental — new IPCs use the new convention; existing IPCs move to features when their owning code is touched. No big-bang migration PR.

**Type-only contract aggregation**

- R5. A new file `apps/desktop/src/shared/ipc-contract.ts` SHALL aggregate every feature's contract into a single `IpcContract` interface keyed by channel name. Each entry maps to `{ req: <RequestType>; res: <ResponseType> }`.
- R6. `ipc-contract.ts` SHALL contain only `import type` statements and the `IpcContract` interface. No runtime imports. This file is fully tree-shaken from compiled bundles.
- R7. Adding a feature SHALL require exactly one line added to `ipc-contract.ts` per channel. Forgetting to add the entry SHALL produce a TypeScript error at any renderer call site that uses the channel.

**Generic typed invoker in preload**

- R8. `apps/desktop/src/preload/index.ts` SHALL expose a single generic invoker via `contextBridge`:
  ```typescript
  contextBridge.exposeInMainWorld('ipc', {
    invoke: <K extends keyof IpcContract>(
      channel: K,
      payload: IpcContract[K]['req'],
    ): Promise<IpcContract[K]['res']> => ipcRenderer.invoke(channel, payload),
  });
  ```
- R9. The existing per-binding `window.api.<name>` surface SHALL remain functional during migration. New features SHALL use `window.ipc.invoke(channel, payload)`. Existing call sites migrate when their owning code is touched.
- R10. Subscription-shaped IPCs (event streams like `onFollowsSynced`, `onAuthStateChanged`) SHALL NOT be forced through `ipc.invoke`. A separate `window.ipc.on(channel, handler)` / `window.ipc.off(channel, handler)` surface SHALL be added for the ~5 subscription channels currently in use. The subscription channel list is small enough to keep statically reviewable in `preload/index.ts`.

**Main-process registration**

- R11. A new file `apps/desktop/src/backend/ipc/register-features.ts` SHALL collect every feature's exported handler array and call `ipcMain.handle(channel, fn)` for each entry at app initialization. New features SHALL be wired in by adding one import + one spread to this registry — no edits to `storage-handlers.ts` or other shared handler files required.

**Pilot migration**

- R12. The `follows` IPC channels (the surface that hurt most yesterday — `FOLLOWS_GET_ALL`, `FOLLOWS_ADD`, `FOLLOWS_REMOVE`, `FOLLOWS_CHECK_IS_FOLLOWED`) SHALL be migrated end-to-end as the pilot. This proves the pattern on a non-trivial surface (~4 channels, 2 platforms, includes both invoke-shaped and subscription-shaped IPCs) before any other surface migrates.
- R13. After the pilot, `apps/desktop/src/backend/api/platforms/AGENTS.md` and the renderer-side AGENTS.md SHALL be updated with the new convention so future contributors discover it before reinventing the old pattern.

**Security framing change — must be documented**

- R14. A `docs/solutions/architecture-patterns/` note SHALL record the explicit shift in the IPC security review surface: from "every line of `preload/index.ts` is a reviewable binding" to "every channel registered in `register-features.ts` + every type in `ipc-contract.ts` is the reviewable surface." This is not weaker — every existing preload binding already invokes a main handler — but it changes what a reviewer reads to audit the IPC attack surface. The note SHALL state this explicitly so the new convention isn't mistaken for a security relaxation.

### Unit 2 — Platform client thin-coordinator refactor

**Cut criterion**

- R15. After refactor, changing the behavior of one endpoint (e.g., "Twitch get-channel-by-login") SHALL require touching exactly one file. HTTP/auth/transformer concerns SHALL be importable utilities, not embedded in the endpoint logic.
- R16. The line-count outcome (each client file <200 lines) is a side effect, not the target. Do not split files purely to hit a number.

**Twitch refactor**

- R17. `apps/desktop/src/backend/api/platforms/twitch/twitch-client.ts` (366 lines) SHALL be reduced to a thin coordinator that exposes the `IPlatformClient` interface and delegates each method to a function in `endpoints/*.ts`. The Helix-vs-GQL routing decision stays in the client (because some unified methods fan out to both); the per-endpoint request/response/transform logic moves out.
- R18. `twitch-requestor.ts` and `twitch-gql-helpers.ts` SHALL remain as the HTTP/auth utility layer used by endpoints.

**Kick refactor**

- R19. `apps/desktop/src/backend/api/platforms/kick/kick-client.ts` (816 lines) SHALL be split using the same pattern. The dual-token strategy (App Access vs User OAuth) and the v1-vs-v2 endpoint routing decisions stay in the client; per-endpoint logic moves into `endpoints/*.ts`.
- R20. Existing files in `kick/endpoints/` (`stream-endpoints.ts`, `user-endpoints.ts`, `video-endpoints.ts`) SHALL be extended, not replaced. Their conventions (return shape, error handling, naming) are the template for new endpoint files.

**No interface changes**

- R21. The public surface (`IPlatformClient` interface in `apps/desktop/src/backend/api/unified/platform-client.ts`) SHALL NOT change. Callers of `twitchClient.getChannelByLogin(...)` and `kickClient.getChannelBySlug(...)` continue working identically. The refactor is purely internal to each platform folder.

**Tests follow the move**

- R22. Existing tests in `apps/desktop/tests/backend/api/platforms/` SHALL be updated to import from the new endpoint file locations. No new test scenarios are required — the refactor is structural; it preserves behavior.

### Unit 3 — e2e smoke harness via debug-electron-mcp

**Harness setup**

- R23. A new test directory `apps/desktop/tests/e2e/` SHALL be created with its own vitest config (or equivalent runner config) separate from the unit test suite. e2e tests SHALL NOT run as part of the default `npm test`; they run via a new script `npm run test:e2e`.
- R24. Each e2e test SHALL launch the app via `electron .` (or the existing `npm start` equivalent) under control of `mcp__debug-electron-mcp`, drive it through a defined flow, capture screenshots/logs on failure, and tear down the app cleanly.
- R25. Tests SHALL run against an isolated `userData` directory (set via `app.getPath('userData')` override or `--user-data-dir` flag) so e2e runs do not pollute the developer's real auth state or follows database.

**Required flows (initial coverage)**

- R26. **Boot smoke test:** launch app → assert main window opens → assert `window.ipc` (or `window.api` during migration) is exposed → assert at least one IPC roundtrip (e.g., `getAppVersion`) returns the expected shape. Targets the `ELECTRON_RUN_AS_NODE`, missing-preload-binding, and IPC-mismatch failure modes from yesterday.
- R27. **Auth state visibility:** launch app → drive to settings → assert the auth state UI renders without errors for the no-account-connected case. Does not require real Twitch/Kick login (deferred — see Open Questions).
- R28. **Follow flow (guest):** launch app → search for a channel → click Follow → assert it appears in the follows list → reload app → assert it persists. Exercises real SQLite, real renderer/main IPC, real BrowserWindow lifecycle.

**Test account strategy (deferred decision)**

- R29. Tests requiring authenticated platform calls (real Twitch/Kick OAuth, real Follow/Unfollow against a platform account) are OUT OF SCOPE for the initial harness. See Open Questions for the test-account strategy discussion.

**Flakiness mitigation**

- R30. e2e tests SHALL use `mcp__debug-electron-mcp`'s `wait_for_*` primitives, not raw `setTimeout`. The known eval pitfalls (per `feedback_electron_mcp_eval_pitfalls.md` — falsy returns reported as failure, empty querySelectorAll on hidden elements) SHALL be addressed by:
  - Using `document.images.length`-style truthy primitives or string-prefix returns
  - Wrapping eval probes in try/catch so DevTools console stays clean
  - Setting explicit timeouts on every wait, defaulting to 5s, never unbounded

**CI integration (deferred)**

- R31. CI integration is OUT OF SCOPE for this brainstorm. e2e tests run locally only initially; the CI hookup decision (which OS runner, headless display, secrets handling) is a follow-up if/when the harness proves valuable.

---

## Non-Goals

- **Per-platform IPC channels everywhere** (e.g., `FOLLOWS_KICK_ADD` / `FOLLOWS_TWITCH_ADD` replacing `FOLLOWS_ADD { platform }`). Doubles surface area for operations where the platform is just a tag. Unit 1's per-feature module already isolates per-platform logic inside one feature folder; the channel-level split adds no value.
- **Per-platform stores** (e.g., `useTwitchFollowStore`, `useKickFollowStore` replacing `useFollowStore`). Fragments the unified UI model — most components want the merged followed list, not two separate stores to combine in render.
- **Test deletion.** The 485 existing unit tests document real behavior. Only tests for deleted code should be removed, case-by-case. No sweep.
- **Android Client-Id "guest vs authed" separation.** Misframe. `kd1unb4b3q4t58fwlpcbzcbnm76a8fp` is a Twitch *client* identifier that bypasses Client-Integrity. It's used in both anonymous reads (`twitch-gql-client.ts`) AND authed-user mutations (`twitch-gql-prediction-mutations.ts`, `twitch-gql-pin-mutations.ts`). Splitting it by auth state would duplicate the constant without benefit.
- **Real-account e2e flows in the initial harness.** Logging into a real Twitch or Kick test account in automation is its own scope: credential storage, token refresh, 2FA handling, platform-side rate limits, breakage when platforms redesign their login UI. Deferred to a follow-up brainstorm if the smoke-test e2e harness proves its value first.
- **CI hookup for e2e.** See R31.
- **Codegen for the IPC convention.** The type-only contract uses TypeScript inference end-to-end; no build-step code generation is added. Codegen was considered and rejected as foreign to the rest of the codebase.

---

## Risks and Open Questions

### Risks

- **Unit 1 security framing is a real change in review discipline, not just a refactor.** Today, a security reviewer reads `preload/index.ts` line-by-line to audit the IPC attack surface. After Unit 1, they read `shared/ipc-contract.ts` + `backend/ipc/register-features.ts`. R14 documents this. The risk is the new artifacts grow as long as `preload/index.ts` did and become as un-reviewable. Mitigation: contract entries are one line each (auto-collected from feature modules), and the registry is just `import + spread`. The reviewable surface is a flat list, not a 700-line file.

- **Unit 1 migration creates a transitional period where both IPC patterns coexist.** Until every channel is migrated, the codebase has two ways to add IPC. New contributors may copy the wrong pattern. Mitigation: AGENTS.md updates in R13; PR-time review catches drift. Cost is acceptable because big-bang migration of all ~40 existing IPCs would be a massive review burden.

- **Unit 2 risks import churn.** Splitting `kick-client.ts` (816 lines) means every existing import of one of its methods stays valid (the public methods remain on the coordinator), but internal helper functions that get moved out may need updated imports inside other endpoint files. Mitigation: keep the public interface stable (R21); resolve internal imports as the split happens, one endpoint at a time.

- **Unit 3 is the riskiest unit — maintenance burden may exceed value.** e2e tests are notoriously flaky and slow. `debug-electron-mcp` has known eval pitfalls (documented in `feedback_electron_mcp_eval_pitfalls.md`). The platforms redesign their UIs and break tests. Mitigation: scope is intentionally narrow (smoke test + guest flow only — R26-R28); no real-account flows initially (R29); runs are opt-in (R23). If the harness proves to be more pain than value after 2-3 months, deleting it is a cheap reversal.

### Open Questions

- **Should Unit 3 start as boot-shape-only smoke testing instead of the broader smoke + guest follow flow proposed in R26-R28?** The smaller scope (just R26 — boot + IPC roundtrip) catches the three failure modes from yesterday (env clobber, missing preload binding, IPC mismatch) at ~10% of the maintenance cost. The broader scope adds real-DB and real-renderer coverage but introduces flakiness risk. Decision: kept the broader scope per earlier user input (add e2e as a real third unit), but called out here so the option to scope down before planning is visible.

- **Test account strategy for future authenticated e2e flows.** When/if R29 is re-opened: real test accounts (with 2FA-disabled flags and platform-team awareness), or test-mode OAuth flows that mock the platform side? Deferred to the follow-up brainstorm.

- **Should the `ipc.invoke` runtime accept channel strings the registry doesn't know about?** Today's per-binding preload silently fails when the renderer calls an unknown method (no method, no call, runtime TypeError on `undefined()`). The generic invoker forwards any string to `ipcRenderer.invoke`, which returns a rejected promise for unknown channels — different failure shape. Decision: same failure outcome (unhandled rejection), different stack trace. Document in the AGENTS.md update so contributors know how to read the new failure mode.

- **Should the IPC subscription surface (R10) use the same contract type, or a separate one?** Subscription channels have a different shape — `(payload) => void` event delivery, not request/response. Two options: (a) extend `IpcContract` with an `event` discriminator per entry, or (b) maintain a separate `IpcSubscriptionContract` interface. Decision deferred to planning — both work; (b) is simpler, (a) is more uniform.

- **Should Unit 2's split happen before or after Unit 1's IPC migration of the `follows` pilot?** No technical dependency, but the `follows` pilot will probably touch some platform-client code paths. If Unit 2 ships first, pilot's diff is smaller. If Unit 1 ships first, pilot proves the IPC pattern but adds Unit 2's work to its review surface. Suggested sequencing: Unit 2 first (mechanical, low-risk), then Unit 1 pilot, then Unit 3 harness. Confirm during planning.

---

## References

- `docs/solutions/integration-issues/follow-push-sync-infeasible-2026-05-23.md` — the investigation that motivated this refactor
- `apps/desktop/src/backend/api/platforms/AGENTS.md` — existing anti-pattern callouts for the platform clients
- `apps/desktop/src/shared/ipc-channels.ts` (309 lines) — current IPC channel constants
- `apps/desktop/src/preload/index.ts` (701 lines) — current `contextBridge` surface
- `apps/desktop/src/backend/api/platforms/twitch/twitch-client.ts` (366 lines) — Twitch coordinator
- `apps/desktop/src/backend/api/platforms/kick/kick-client.ts` (816 lines) — Kick coordinator
- `feedback_electron_mcp_eval_pitfalls.md` (memory) — known `debug-electron-mcp` eval gotchas
