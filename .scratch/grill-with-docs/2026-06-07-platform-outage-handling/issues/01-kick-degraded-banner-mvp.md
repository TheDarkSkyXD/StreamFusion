# Slice 01 — Kick degraded → banner appears (MVP loop)

Status: ready-for-human

## Parent
PRD: https://github.com/TheDarkSkyXD/StreamFusion/issues/50

## What to build

The smallest end-to-end loop that shows the user "Kick is having issues." A failure-rate detector for Kick records request outcomes, trips to `degraded` when the threshold is met, fires a main → renderer IPC event, and the renderer shows a banner at the top of the app.

This is the foundational slice — it establishes the new platform-health module, the IPC contract, and the renderer banner component. Every other slice extends this loop. No recovery logic, no traffic shedding, no log suppression, no Twitch in this slice — just the trip-and-show path.

Behavior:
- New per-`Platform` health module exposes `recordPlatformFailure(platform, errorClass)`, `recordPlatformSuccess(platform)`, `getPlatformHealth(platform)`, `isPlatformHealthy(platform)`, `onPlatformHealthChanged(listener)`. Module lives in the unified/cross-platform backend layer per the PRD.
- Failure classes counted: `TRANSIENT:timeout`, `TRANSIENT:5xx`, `TRANSIENT:net::ERR_*`. Other error shapes are ignored.
- State machine: `healthy → degraded` when failure rate ≥60% over ≥8 attempts in a 60s rolling window. Threshold constants exposed as named exports for later tuning.
- Kick public stream endpoint instrumented: every `_doFetchPublicStreamBySlug` outcome records success or the matching failure class. Other Kick endpoints can be instrumented in later slices.
- Main process emits a new IPC event `platform-health-changed` with payload `{ platform, status, startedAt }`. Renderer hydrates initial state via a new `electronAPI.platformHealth.get()` call on mount.
- New renderer hook `usePlatformHealth()` returns `{ kick, twitch, anyDegraded }` keyed off the IPC subscription. (Twitch always `healthy` in this slice.)
- New `PlatformHealthBanner` component renders below the top nav bar. Visible iff `anyDegraded` is true. Non-dismissible. Final design (iterated post-implementation): full-width banner, `py-4 text-lg font-bold text-center`, lucide `WifiOff` icon, brand colors per platform — Kick `bg-black text-[#53FC18]`, Twitch `bg-[#9146FF] text-white`, both degraded `bg-gray-700 text-white`. Copy uses periods, no em-dashes: "Kick is having issues right now. Showing last-known state." / "Twitch is having issues right now. Some channels may not load." / "Kick and Twitch are both having issues right now. Showing last-known state."
- Banner does not auto-clear in this slice — recovery is slice 02.

## Acceptance criteria

- [ ] New platform-health module exists at the path implied by the PRD with the five public functions named in "What to build."
- [ ] Failure-rate state machine trips to `degraded` for Kick after the threshold is met and stays there indefinitely (recovery is out of scope here).
- [ ] Kick public stream endpoint reports outcomes (success + matching failure class) into the module on every call.
- [ ] Excluded failure classes (401, 403, 404, 429, parse errors) do NOT affect state — assertable via state-machine unit tests.
- [ ] IPC event `platform-health-changed` fires on state transition with the documented payload; renderer hook receives it.
- [ ] `PlatformHealthBanner` renders when Kick is degraded and is absent when Kick is healthy; visible below the top nav bar; non-dismissible.
- [ ] Twitch state is unaffected by Kick failures (isolation assertable in unit tests even though Twitch instrumentation is slice 06).
- [ ] Test file under `tests/backend/api/unified/` covers state-machine behaviors (trip, exclusion, isolation). Uses fake timers, no real Electron.
- [ ] Test extension in `tests/backend/api/platforms/kick/stream-endpoints.test.ts` covers the recording calls.
- [ ] Renderer component + hook tests added per PRD's Testing Decisions.
- [ ] No regression in existing kick-network-health behavior (that module continues to function until slice 05 replaces it).

## Blocked by

None — can start immediately.

## Acceptance criteria — verified

- [x] New platform-health module exists at `apps/desktop/src/backend/api/unified/platform-health.ts` with the five public functions named in "What to build."
- [x] Failure-rate state machine trips to `degraded` for Kick after the threshold is met and stays there indefinitely.
- [x] Kick public stream endpoint reports outcomes on every code path (`stream-endpoints.ts` +132 lines).
- [x] Excluded failure classes (401/403/404/429/parse) do NOT affect state — covered in state-machine tests.
- [x] IPC event `platform-health-changed` fires on state transition with the documented payload; renderer hook receives it. New `platform-health-handlers.ts` + `ipc-channels.ts` constant + `ipc-handlers.ts` registration.
- [x] `PlatformHealthBanner` renders when Kick is degraded; absent when healthy; rendered inside `AppLayout.tsx`; non-dismissible.
- [x] Twitch state is unaffected by Kick failures — isolation covered in state-machine tests.
- [x] Test file `apps/desktop/tests/backend/api/unified/platform-health.test.ts` exists; uses fake timers; no real Electron.
- [x] Test extension in `tests/backend/api/platforms/kick/stream-endpoints.test.ts` covers the recording calls.
- [x] Renderer component + hook tests added at `tests/components/layout/PlatformHealthBanner.test.tsx` + `tests/hooks/usePlatformHealth.test.tsx`.
- [x] No regression in existing `kick-network-health.ts` behavior (file untouched by slice 01; slice 05 will delete it).

## Implementation Notes

**New files:**
- `apps/desktop/src/backend/api/unified/platform-health.ts` — state machine + public API
- `apps/desktop/src/backend/ipc/handlers/platform-health-handlers.ts` — IPC handler + main→renderer push
- `apps/desktop/src/hooks/usePlatformHealth.ts` — renderer hook (hydrate + subscribe)
- `apps/desktop/src/components/layout/PlatformHealthBanner.tsx` — banner component
- Four corresponding test files (38 new tests across all four)

**Modified files:**
- `apps/desktop/src/backend/api/platforms/kick/endpoints/stream-endpoints.ts` (+132 lines) — outcome recording at the per-attempt level
- `apps/desktop/src/shared/ipc-channels.ts` (+86 lines) — new `platform-health-changed` channel + payload types
- `apps/desktop/src/backend/ipc-handlers.ts` (+13 lines) — register the new handler
- `apps/desktop/src/components/layout/AppLayout.tsx` — banner mounted below TopNavBar

**Agent's report:** All 38 new tests pass; lint clean for the modified set. Docstrings trimmed to one-paragraph descriptions per repo convention; "PRD #50 slice 01" prefixes on inline comments replaced with concrete reasoning. IPC send-guard try/catch retained (matches `auth-handlers` pattern).

**Not done — left for the user:**
- Commit (per AGENTS.md: never commit without explicit user request)
- No PR opened
- No full app launch / manual smoke test (agent didn't run the desktop app; relied on test suite for confidence)

**Next slice unblocked:** 02, 03, 04, 05, 06, 09, 10 can now fan out in parallel.

## Design iteration (post-agent, before commit)

The agent shipped the banner using the PRD's default styling (`bg-amber-500/15` translucent amber + `text-amber-100` + `text-sm`) and the PRD's em-dash copy. User reviewed in the live Electron app via debug-electron-mcp mock injection and found it illegible (amber-on-amber low contrast on the dark theme) and the copy too AI-sounding (em-dashes everywhere).

Iterated through 4 contrast variants and 4 icon variants live in the app. Final design landed on:

- **Brand colors per platform.** Kick `bg-black text-[#53FC18]` (Kick's neon-green-on-black brand), Twitch `bg-[#9146FF] text-white` (Twitch purple), both degraded `bg-gray-700 text-white` (neutral fallback). Instantly recognizable platform at a glance, before reading the text.
- **Bigger and bolder.** `py-4 text-lg font-bold text-center` instead of `py-2 text-sm` flush-left. Banner is now load-bearing visual, not a passing notice.
- **WifiOff icon** from lucide-react (h-5 w-5, shrink-0). Reads as "can't reach the platform" — more semantically accurate than the earlier `Zap` candidate or the generic `⚠`.
- **Copy de-AI'd.** Periods instead of em-dashes throughout.

**Files changed in this iteration:**
- `apps/desktop/src/components/layout/PlatformHealthBanner.tsx` — full rewrite of the JSX (icon + flex layout + brand-color helper) and the message strings. Stale "PRD #50 slice 01" docstring removed.
- `apps/desktop/tests/components/layout/PlatformHealthBanner.test.tsx` — old single copy-assertion replaced with 3 per-state tests asserting BOTH the new copy AND the brand-color classes. Old "PRD #50 slice 01" comment header removed.

**Re-verified:** `npx vitest run PlatformHealthBanner` → 6/6 pass.

**Still not done:** Vite/Electron has not been reloaded since the change — running app still shows the agent's original banner code. A dev-server restart picks up the new design. Other slices' tests not re-run since the banner change; no contract changes here so unlikely to break, but `pnpm test` from `apps/desktop/` before committing is the safe move.
