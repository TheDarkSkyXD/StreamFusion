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
├── setup.ts              # vitest polyfills (matchMedia, ResizeObserver, etc.)
└── AGENTS.md             # ← you are here
```

## RUNNING

```bash
# From apps/desktop/
npm test                  # Run the full vitest suite once
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
```

E2E is **not** part of `npm test`. It's interactive — see `tests/e2e/README.md`.

---

## THE QUALITY BAR

Every test exists to catch a regression class. If you can't name the regression a test would catch, the test isn't pulling its weight.

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

---

## RUNNERS + CONFIG

The vitest config is at [`apps/desktop/vitest.config.ts`](../vitest.config.ts). Notable:

- **`better-sqlite3` is aliased to `tests/helpers/better-sqlite3-shim.ts`** — a `node:sqlite`-backed shim with parity coverage in `tests/helpers/better-sqlite3-shim.test.ts`. The native `better-sqlite3` binary is built against Electron's NODE_MODULE_VERSION; vitest runs under system Node. Aliasing avoids the binary rebuild dance.
- **Globals are enabled** (`globals: true`) so `describe / it / expect` are available without imports.
- **jsdom environment** — DOM globals (`document`, `window`) are available.
- **Setup file** at `tests/setup.ts` polyfills `matchMedia`, `ResizeObserver`, `IntersectionObserver`, `scrollIntoView`, and pointer events.

---

## SCOPE NOTE (audit-time R1 clarification)

The audit's R1 says "every test-support file is reviewed only when revealed as broken." That rule applies during *audit batches* — it does not block this `AGENTS.md`, the audit log, or the gaps backlog from existing. Those are explicit Phase 0 deliverables of the plan, not new support files revealed broken mid-audit.
