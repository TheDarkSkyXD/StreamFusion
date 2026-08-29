# TESTS

## OVERVIEW
Per-test conventions for the StreamFusion desktop suite. This file is the quality bar new and audited tests live up to — read it before adding a test, deleting one, or auditing a batch.

The audit it grew out of: [`docs/plans/2026-05-19-001-refactor-test-suite-audit-plan.md`](../../../docs/plans/2026-05-19-001-refactor-test-suite-audit-plan.md). Per-batch progress: [`docs/test-audit/2026-05-19-audit-log.md`](../../../docs/test-audit/2026-05-19-audit-log.md).

## STRUCTURE

```
tests/
├── adblock/              # Twitch adblock unit + integration tests
├── backend/              # Main-process tests (services, API clients, auth)
│   ├── api/platforms/    # Twitch/Kick HTTP + GQL client tests
│   ├── auth/             # OAuth config, refresh flow
│   └── services/         # chat, emotes, database, mod-log, manifests
├── components/           # React component tests (vitest + RTL)
├── helpers/              # Test helpers (better-sqlite3-shim, etc.)
├── hooks/                # React hook tests
├── lib/                  # Pure-function tests (id-utils, formatters)
├── pages/                # Top-level page tests
├── services/             # Cross-area integration tests (cookie stripper, etc.)
├── shared/               # Shared-type/contract tests
├── store/                # Zustand store tests
├── e2e/                  # Playbook-driven E2E (see e2e/README.md)
├── test-utils.tsx        # renderWithProviders, installElectronAPIMock, fixtures
├── setup-node.ts         # logger boundary mocks shared by both projects
├── setup.ts              # jsdom polyfills (matchMedia, media methods, etc.)
└── AGENTS.md             # ← you are here
```

## RUNNING

```bash
# From apps/desktop/
npm test                  # Run the full vitest suite once
npm run test:node         # Run main-process tests in the Node environment
npm run test:dom          # Run renderer and DOM-dependent tests in jsdom
npm run test:system       # Run host-dependent system tests, such as real bundled FFmpeg contracts
npm run test:all          # Run deterministic tests, then system tests
npm run test:benchmark    # Measure deterministic suite wall time and worker-count stability
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
```

`npm test` is the deterministic suite. It includes Node, jsdom, mocked integrations, loopback-server tests, temporary-file tests, and other tests that do not require a host binary, a public service, or long wall-clock delays. Host-dependent contracts use the `.system.test.ts` or `.system.test.tsx` suffix and run through `npm run test:system`.

E2E is **not** part of `npm test`. It's interactive — see `tests/e2e/README.md`.

---

## THE QUALITY BAR

Every test exists to catch a regression class. If you can't name the regression a test would catch, the test isn't pulling its weight.

**Failure paths count as regression classes.** A component or page that observably renders distinct UI for any of {loading, error, empty} has three regression classes worth guarding: silent-blank-on-error, missing-skeleton-on-loading, indistinguishable-empty-vs-error. The bar matches at every layer — if the source has the state, the test asserts it. A pure `<Button>` with no async branch is exempt; a leaf card that receives `isLoading` via prop and renders a skeleton is in scope. Hooks that wrap async work assert the **consumer-visible side effect** of failure (toast queued, retry scheduled, state flipped) — not just "hook returned error". Backend services keep their existing strong bar (HTTP error / timeout / abort coverage already in place). Forward-enforce on every new PR; critical-path backfill lives in U18 — see the failure-coverage punch list in [`docs/test-audit/2026-05-19-audit-log.md`](../../../docs/test-audit/2026-05-19-audit-log.md).

### Verdicts: Keep / Rewrite / Delete

When auditing a test (or reviewing one in a PR), pick exactly one verdict per file:

| Verdict | Use when... | Examples |
|---------|-------------|----------|
| **Keep** | The test asserts app-specific behavior under a regression class the codebase has actually had or could realistically have. Library defaults aren't the target; app contracts are. | `tests/backend/services/chat/twitch-pin-poller.test.ts` (pins GQL shape verbatim — schema drift fails it). `tests/backend/services/emotes/emote-manager.test.ts` (cross-platform scoping — guards `cfb0033`). `tests/helpers/better-sqlite3-shim.test.ts` (parity contract, including `ON CONFLICT`). |
| **Rewrite** | The file exists for a valid reason but its assertions don't catch what they claim to — typically because it mocks the thing under test, asserts library defaults, or asserts the implementation instead of the behavior. Keep the file path, replace the assertions. | `tests/components/ui/platform-avatar.test.tsx` (mocks `ProxiedImage`, asserts a Tailwind bg class — the mock is the whole subject). |
| **Delete** | The test only asserts framework defaults: that a component renders, that a default class is present, that a prop is forwarded, that an `onClick` runs. The library already tests this. | `tests/components/ui/button.test.tsx`, `tests/components/ui/skeleton.test.tsx` (asserts `.animate-pulse`), `tests/components/stream/stream-card-skeleton.test.tsx`, `tests/components/ui/visually-hidden.test.tsx`. |

**The deciding question:** if this test fails tomorrow, will I have learned anything I couldn't have learned from a typecheck + a `git diff`?

### `// Guards:` comments — every Keep / Rewrite carries one

Place a `// Guards:` comment at the top of the outermost `describe` (or top of file if no `describe`). One line per regression class guarded.

```ts
// Guards: emote loader must scope global-load state per platform so Kick's no-op stops firing on Twitch (regression cfb0033)
// Guards: multistream mount of two different-platform streams must not race the global-load latch (regression 7b80b33)
describe('emote-manager', () => { ... });
```

For components or pages observing async state, write one Guards line per state:

```ts
// Guards: loading state renders skeletons (not blank) while useFollowedStreams resolves
// Guards: error state surfaces a toast and a retry button when the followed-streams Helix call returns 5xx
// Guards: empty state renders the "follow some channels" empty card, distinct from the error card
describe('Following page', () => { ... });
```

**Conventions:**
- One regression per line — easier to grep and easier to update when one guard goes away but the others stay.
- Cite the **fix commit SHA** when guarding a specific past regression (e.g., `(regression cfb0033)`). For *class*-level guards (no single SHA — e.g., "any new Twitch GQL persisted-op must keep its hash stable"), drop the SHA and write the contract instead.
- For Rewrites of test files that exist but didn't catch the bug they should have, cite the SHA of the *bug* (not the test's first-commit SHA). The point of the comment is: a future maintainer who's about to "simplify" this test can see the cost of doing so.
- Plain language. No type names or selector strings. A reviewer should understand the comment without opening the test.

### PR-touch rule for `// Guards:` comments

Any PR that touches a test file with a `// Guards:` comment must do one of:

1. **Update the comment** to match the new assertions. (The behavior class the test guards has changed.)
2. **Add a one-line note in the PR description** confirming the existing guard still holds. (The test changed but the behavior class is the same — refactor, rename, etc.)

There is no mechanical lint rule for this. Reviewer attention is the mitigation. The cost of letting a `// Guards:` comment rot is high — it stops being trustworthy as documentation. The cost of the rule is one extra sentence in a PR description.

The same rule covers failure-path `// Guards:` lines (loading / error / empty / HTTP-error injection): touch the test → update the failure-state guard lines or note their continued correctness in the PR description.

---

## SPEED BUDGET (R12)

The suite has to be fast enough to run constantly — both locally and in CI. The wall-clock budget is set per file, not per suite, because parallelism hides offenders inside an OK-looking total.

**Per-file budget: 2 seconds.** A test file that runs longer than 2s when invoked in isolation (`npm exec -- vitest run tests/path/to/file.test.ts`) is over budget. Component-heavy files (heavy RTL setup, large fixtures) get a soft ceiling of 1.5s; backend client files get the full 2s.

**Per-test budget: 200ms median, 500ms ceiling.** A single `it(...)` block taking >500ms is a red flag — almost always a real-timer or real-HTTP smell.

### Red flags

| Smell | Root cause | Fix |
|-------|-----------|-----|
| Single test >5s | Real timer waiting for a production timeout (e.g., warmup-timeout, retry backoff) | `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(ms)`. The production code's elapsed wall-clock is not the test's elapsed wall-clock. |
| File >2s with no obvious heavy fixture | `renderWithProviders` called dozens of times in one `describe` block | Hoist shared setup to a `beforeAll`, or split the `describe` into smaller files. |
| Real `setTimeout`/`setInterval` callbacks awaited via `await new Promise(r => setTimeout(r, X))` | Test code waiting on production-scale delays | Fake timers + advance; or refactor the SUT to accept an injected scheduler. |
| `fs.watchFile`, `net.Server`, real `BrowserWindow`, real `Pusher` instances | Integration-level setup in a unit-tier file | Move to an integration `describe` or stub the boundary. |

### What this catches

The audit's slowest file at audit time was `tests/backend/api/platforms/kick/kick-send-window.test.ts` at 20.3s — two `send-window-warmup-timeout` tests using real timers to let the production 10s timeout elapse. After fake-timer adoption: ~50ms total. The fix is mechanical; the rule exists so future copies of the pattern get caught at PR time.

### Enforcement

No mechanical lint. PR reviewers check the timing line of any changed test file. If a file you touched runs >2s in isolation, either justify it (large fixture, integration tier) or fix it before merge.

---

## DUPLICATE CONSOLIDATION (R13)

Two tests for the same regression class is one test too many. When a regression class is guarded in N files, pick one canonical home and consolidate.

### The cluster signal

If you see any of these, you have a cluster:

- **Same imports + same fixtures across N files.** E.g., seven adblock files all import `initAdBlockService`/`processMasterPlaylist`/`processMediaPlaylist` and mock `global.fetch` with near-identical playlist strings.
- **Sibling tests for related components that re-test the shared logic.** E.g., three grid components (`stream-grid`, `category-grid`, `virtualized-category-grid`) each asserting "renders N cards / empty / skeleton" against mocked card+skeleton deps.
- **Hook test re-validates what its underlying store test already validates.** E.g., `useTwitchAuth.test.tsx` testing a one-line `useAuthStore((s) => s.twitch)` selector when `auth-store.test.ts` already covers every `twitch` field transition.
- **A re-export probe file** (`foo.test.tsx` that mocks `./foo/index` and asserts the mock rendered). The probe only proves the re-export compiles.

### The consolidation rule

Pick the file that owns the **deepest** layer of the behavior (closest to the source-of-truth), keep it, and delete the satellites — UNLESS the satellite guards a regression class the deeper file can't observe (e.g., a wiring contract that only fires at the outer layer). When in doubt, keep the deepest test and migrate any unique satellite assertions into it.

### What counts as "unique"

A satellite assertion is unique only if removing it would lose a regression class — i.e., there's a SHA in `git log` where the satellite test would have failed and the canonical test would have passed. If you can't name that SHA or a realistic class, the assertion is redundant and the satellite can be deleted.

### The audit's first hit list

The audit's 2026-06-08 sweep flagged: the adblock 7-file pipeline cluster, the 3-file grid-clone triplet (`stream-grid`/`category-grid`/`virtualized-category-grid`), the 3-file platform-switch routing triplet (`Stream`/`performance-enhanced-player`/`ChatPanel`), and 5 hook-vs-store overlaps in `useAuth.test.tsx` / `useChatRoomState.test.tsx` / `dev-mod-override.test.tsx` / `useUpdater.test.tsx`. All consolidated under U20.

---

## REGRESSION-ON-BUG RULE (R7)

When a bug is fixed, a regression test lands in the same PR (or the immediately-following PR — the audit is the catch-up). The test must:

1. **Demonstrate the failure first.** The new test should FAIL when run against the parent commit of the fix. This is the "characterization-first" execution posture: prove the failure exists before you can claim to prevent it.
2. **Pass on the fix commit.** Same test, same SHA range — flipped result.
3. **Get recorded in the audit log** with both SHAs.

The audit log entry shape (see [`docs/test-audit/2026-05-19-audit-log.md`](../../../docs/test-audit/2026-05-19-audit-log.md)):

```
**Regression tests added:**
- tests/.../new-regression.test.ts — guards <bug class>. Parent commit <sha>: FAILS as expected. Fix commit <sha>: PASSES.
```

### Source-diff-revert fallback (when the parent commit doesn't build)

When the parent commit can't build under the current toolchain (dependency drift, removed code paths, vitest config divergence, post-fix refactor changed function signatures), use the **source-diff-revert** procedure instead of bisecting:

1. Stay on current HEAD (so lockfile + config are today's).
2. `git diff <fix-sha>^..<fix-sha> -- <source paths only, exclude tests>` → save the source diff of the fix.
3. `git apply -R <that diff>` to revert ONLY the source changes onto current HEAD. Tests + lockfile + config stay at today's.
4. Run the new regression test → confirm it **FAILS** against this synthetic buggy state. Record evidence.
5. `git apply <that diff>` to re-apply the fix. Run the test → confirm it **PASSES**. Record evidence.

The audit log records this with `Source-diff-revert verified on current HEAD; cite the diff range.` instead of two parent/fix SHAs.

**Why this works:** the regression is a property of the source code's behavior, not a property of which lockfile we happen to be on. We're testing the source contract, not the historical build environment.

**Pre-flagged commits where this applies** (per plan U7 + U8 Execution notes):

| Fix commit | Why parent won't build cleanly |
|-----------|-------------------------------|
| `6d3606d` (Kick fan-out cold-burst) | Surface refactor `640870a` changed function signatures after the fix landed. |
| `cb0b7b6` (Kick public-stream cache) | Same `640870a` refactor moved stagger inside fetch + added `staggerOffsetMs` / `signal` params. |
| `7b80b33` (multistream emote race) | Itself a "refactor+11-fixes" bundle; its parent has a different module shape. |

For these, write the regression against the **behavior contract** (e.g., "second poll within TTL window does not hit network", "AbortError is not logged as warning") rather than against the current API surface.

---

## CRITICAL-PATH ROUTING (R11)

Mid-audit, you'll discover behavior the existing tests don't cover. Route them:

- **Critical-path gap** — the missing coverage touches one of the five locked critical user flows from the audit's U3 triage (chat with emotes, multistream, login, watching followed streams, etc.). **Fix inline** in the current batch. Add the test, run it, record the addition in the audit log.
- **Non-critical-path gap** — touches a corner the audit could later get back to but doesn't block any locked flow. **Append to** [`docs/test-audit/2026-05-19-gaps-backlog.md`](../../../docs/test-audit/2026-05-19-gaps-backlog.md). It'll be converted to a GitHub issue at U19.

The five locked critical flows are pinned at the top of [`docs/test-audit/2026-05-19-audit-log.md`](../../../docs/test-audit/2026-05-19-audit-log.md) under `## Critical Flow Triage`.

---

## CHECK-BEFORE-DELETE RULE (mod tests)

The Kick channel-management console work was partially removed mid-build (per the `b15bdec` refactor): **AutoMod (both platforms), Streamlabs OAuth, and giveaways** are gone. Retained: timeout, ban, mod-log, VIP table, unban-request, polls, predictions.

This means `tests/components/chat/mod/`, `tests/pages/Mod/`, and the mod-related hook tests (`useIsKickMod`, `useRequireModScopes`, `dev-mod-override`) cover a **mix** of removed and retained features.

**Per-file procedure:**

1. Read the test.
2. Grep the *source* it imports (or asserts against) for AutoMod / Streamlabs OAuth / giveaway code paths.
3. If the test exercises a removed code path → **Delete** (code is gone, the test only fails on missing imports).
4. If the test exercises a retained code path → apply normal **Keep / Rewrite / Delete** verdicts per the bar above.

Record the check-evidence in the audit log entry for each file, even when the verdict is Keep — so the next maintainer doesn't repeat the check.

---

## ADDING A NEW TEST

### File location
- Mirror the source path: a test for `src/backend/services/foo/bar.ts` lives at `tests/backend/services/foo/bar.test.ts`.
- Hooks: `tests/hooks/<hook-name>.test.tsx`.
- Pure functions: `tests/lib/<file>.test.ts`.
- Cross-area integrations (e.g., a request going through the cookie-stripper): `tests/services/<feature>.integration.test.ts`.

### Imports + helpers
- Render React with `renderWithProviders` from `tests/test-utils.tsx` (it wires the router, react-query, and any context the components need).
- Mock the electron API with `installElectronAPIMock()` from the same file. It auto-stubs via Proxy — no need to enumerate channels.
- Need a stream/channel/category? Use the fixtures: `import { fixtures } from '../test-utils'`.
- For backend tests, stub `fetch` with `vi.stubGlobal('fetch', ...)` inside a `beforeEach`, and call `vi.unstubAllGlobals()` in `afterEach`. This is the codebase idiom.

### The header comment
For tests that guard a non-obvious behavior class — especially regressions or contract pins — add a top-of-file comment explaining *why* the test exists. This is the de-facto precedent set by `tests/backend/services/chat/twitch-pin-poller.test.ts`, `tests/helpers/better-sqlite3-shim.test.ts`, and `tests/services/third-party-cookie-stripper*.test.ts`. The `// Guards:` line on the `describe` is the formal version; the header comment is the long-form explanation when the WHY isn't a single line.

### Don't
- Don't assert library defaults. (Don't test that `<button onClick={fn}/>` calls `fn` on click — React tests that.)
- Don't mock the thing under test, then assert against the mock. (See `platform-avatar.test.tsx` shallow archetype.)
- Don't write tests that pass on every implementation that compiles. (e.g., asserting that `someFn` "is called" without asserting what it was called with.)
- Don't ship a Keep test for a component that observably renders loading/error/empty UI without asserting each branch. The "silently blank on Helix 5xx" class is exactly the gap the failure-coverage bar exists to close. If the component is exempt (no async branch in source), don't add an empty test — call out the exemption in the PR description so the reviewer can confirm.

---

## RUNNERS + CONFIG

The vitest config is at [`apps/desktop/vitest.config.ts`](../vitest.config.ts). Notable:

- **Deterministic projects.** `node` and `dom` are the default `npm test` projects. They exclude `*.system.test.*` files so local and required CI runs do not start host binaries by accident.
- **System project.** `system-windows` runs `*.system.test.*` files in Node with one worker and no file parallelism. Use this for real bundled executables or other host-boundary contracts.
- **`better-sqlite3` is aliased to `tests/helpers/better-sqlite3-shim.ts`** — a `node:sqlite`-backed shim with parity coverage in `tests/helpers/better-sqlite3-shim.test.ts`. The native `better-sqlite3` binary is built against Electron's NODE_MODULE_VERSION; vitest runs under system Node. Aliasing avoids the binary rebuild dance.
- **Globals are enabled** (`globals: true`) so `describe / it / expect` are available without imports.
- **Node project** — backend tests run without jsdom except for the explicit DOM-contract files listed in `vitest.config.ts`.
- **DOM project** — renderer tests and the backend DOM-contract exceptions run in jsdom.
- **Scoped setup files** — `tests/setup-node.ts` owns backend logger mocks; `tests/setup.ts` adds browser and media polyfills.

---

## SCOPE NOTE (audit-time R1 clarification)

The audit's R1 says "every test-support file is reviewed only when revealed as broken." That rule applies during *audit batches* — it does not block this `AGENTS.md`, the audit log, or the gaps backlog from existing. Those are explicit Phase 0 deliverables of the plan, not new support files revealed broken mid-audit.
