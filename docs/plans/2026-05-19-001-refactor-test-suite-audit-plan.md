---
title: Audit and harden the desktop app test suite
type: refactor
status: active
date: 2026-05-19
origin: docs/brainstorms/2026-05-19-test-suite-audit-requirements.md
---

# Audit and harden the desktop app test suite

## Summary

A file-by-file audit of every test under `apps/desktop/tests/` with per-file verdicts (keep / rewrite / delete) and `// Guards:` comments, executed in by-area batches. Each batch backfills regression tests for that area's already-shipped bugs (verified to fail on the parent commit and pass on the fix commit) so the audit produces evidence of value as it goes. Close-out wires vitest into CI (which currently runs nothing test-related), refreshes a stale root `AGENTS.md`, and promotes two undocumented conventions to `docs/solutions/`. E2E-in-CI is explicitly deferred to a follow-up because Playwright's build-target path needs reconciliation first.

---

## Problem Frame

Bugs ship past green tests, the suite is large but shallow, and critical user paths (chat with emotes, multistream, login, watching followed streams) have visible coverage gaps — full context in the origin requirements doc. Plan-specific framing: research found that `.github/workflows/build.yml`, `pre-release.yml`, and `release.yml` do not invoke `npm test` or `npm run test:e2e`, so the suite is not gating anything today — even a well-audited suite would catch nothing in CI without the close-out wire-up.

**Note on test count.** The origin requirements doc estimated "~80 unit/integration tests plus 14 E2E specs" based on a partial enumeration. The actual count at plan time is ~180 test files across `apps/desktop/tests/`. Per-unit counts in Implementation Units have been corrected against verified Glob results; remaining count references in close-out (U19) are computed at write time rather than hard-coded so they stay accurate as the audit adds regressions and deletes shallow tests.

---

## Requirements

- R1. Every vitest/playwright test file under `apps/desktop/tests/` reviewed exactly once. Origin R1's "test-support files reviewed only when revealed as broken" applies during *audit batches* (U4 onward) — it does not block the audit-infrastructure setup in U1/U2 from creating new support files (`tests/AGENTS.md`, audit log, gaps backlog), which are explicit Phase 0 deliverables. (Origin R1, scope-clarified.)
- R2. By-area batches; each batch is one reviewable commit/PR. The plan groups components by complexity tier (primitives first in U12, then functional areas U13–U17b) rather than the strict in-paren component sub-order from origin R2 — the brainstorm's binding constraint was "by-area batches with reviewable commits," not strict sub-sequencing within `components/`. The non-component areas (`adblock`, `chat`, `twitch API`, `kick API`, `services`, `auth`, `store`, `hooks/shared/lib`) follow origin R2's sequence. (Origin R2, grouping-clarified.)
- R3. Pre-audit baseline confirmed before audit batches begin — the in-flight changes the brainstorm anticipated had already landed by plan-write time, so U1 is a verification step rather than a commit. (Origin R3, satisfied-by-history.)
- R4. Per-file verdict applied: Keep / Rewrite / Delete per origin R4 criteria.
- R5. `// Guards:` comment on every Keep/Rewrite test, referencing fix commit SHAs when guarding a specific regression. (Origin R5)
- R6. Per-batch summary appended to a single tracking file. (Origin R6)
- R7. Regression tests backfilled inline per batch for every shipped bug in the area's recent history; minimum target list per origin R7.
- R8. Each backfilled regression test verified to fail on the parent commit of the fix and pass on the fix commit; verification recorded in the audit log. When the parent commit cannot build under the current toolchain (dependency drift, removed code paths, vitest config divergence), the source-diff-revert fallback applies (see U2's `tests/AGENTS.md` content and the Risks table). (Origin R8, fallback-augmented.)
- R9. The five critical user flows reviewed and locked in U3 before the E2E batch starts. U3 produces a confirmation-or-revision recommendation against existing specs + recent bug history; the user approves before lock-in. (Origin R9, review-gated.)
- R10. Existing E2E specs audited against the critical-flow list; mock-only specs flagged Rewrite. (Origin R10)
- R11. Critical-path gaps fixed inline; non-critical gaps go to backlog. (Origin R11)
- R12. No new testing layers, framework changes, or coverage-% thresholds. (Origin R12)
- R13. **Plan-added.** Close-out wires `npm test` into the CI pipeline so the audited suite gates merges. E2E-in-CI is explicitly deferred to a follow-up task because the build-target path needs resolution (see U0) and the CI matrix shape needs separate decisions. (Resolves call-out 1; user-confirmed in plan synthesis; revised after F10.)
- R14. **Plan-added.** Close-out refreshes root `AGENTS.md` (which still says "no tests yet" and references retired tooling like `forge.config.ts`) and creates `apps/desktop/tests/AGENTS.md` documenting the audit's quality bar and the `// Guards:` convention. (Resolves call-out 2; user-confirmed.)
- R15. **Plan-added.** Promote two undocumented conventions to `docs/solutions/`: the `better-sqlite3` → `node:sqlite` vitest shim and a Twitch/Kick client mocking catalog. (Resolves call-out 3; user-confirmed.)

**Origin acceptance examples:** AE1 (Delete archetype — `button.test.tsx` shallow assertions), AE2 (Keep + `// Guards:` — `emote-manager.test.ts` cross-platform scoping), AE3 (regression backfill — multistream emote race, parent-fails / fix-passes verification), AE4 (critical-path vs backlog routing — pinned-message id-vs-pin-id inline; hypothetical `lib/languages.ts` backlogged as illustration).

---

## Scope Boundaries

- No new testing layers (visual regression, screenshot diff, performance benchmarks, accessibility automation, mutation testing).
- No testing framework changes (vitest → jest, playwright → cypress).
- No coverage-% thresholds added to CI.
- No proactive test-support / fixture refactoring; only when an audited test requires it.
- Areas outside `apps/desktop/tests/` not audited (other workspace packages, root-level scripts, `node_modules/`).
- Tests for the Kick channel-management console work removed mid-build (per `project_channel_mgmt_scope_change_2026_05_18` memory) — specifically tests covering **AutoMod (both platforms), Streamlabs OAuth, and giveaways** — are Delete-class under R4 rather than audited for keeping. **Check-before-delete rule:** the `tests/components/chat/mod/`, `tests/pages/Mod/`, and mod-related `tests/hooks/{useIsKickMod, useRequireModScopes, dev-mod-override}` files cover a *mix* of removed features (AutoMod / Streamlabs / giveaways) and retained features (timeout, ban, mod-log, VIP table, unban-request). Per-file: read the test, check whether it references AutoMod / Streamlabs / giveaway code paths in source. Only those tests are Delete-class; tests for retained mod features get normal R4 verdicts. U11, U13b, and U17b all apply this rule.

### Deferred to Follow-Up Work

- Non-critical-path coverage gaps discovered mid-audit: filed in `docs/test-audit/2026-05-19-gaps-backlog.md` during the audit, converted to GitHub issues + the markdown deleted at U19.
- Coverage-% threshold in CI: explicitly out of this plan; can be a follow-up once the suite is audited and stable enough that a threshold is meaningful.
- E2E-in-CI wire-up: deferred past U19a because Playwright's build-target path (resolved in U0) and CI matrix shape are independent decisions worth their own follow-up unit. U19a ships vitest-only CI gating.
- Playwright-Electron flake postmortem (no learnings exist today per the learnings researcher): may emerge from U18 work but not in scope as its own deliverable.

---

## Context & Research

### Relevant Code and Patterns

**"Good test" anchors — mirror these for Keep / Rewrite:**
- `apps/desktop/tests/backend/services/chat/twitch-pin-poller.test.ts` — pins the GQL shape verbatim from `gql.twitch.tv`; would catch any schema drift or the pinned-message id-vs-pin-id class.
- `apps/desktop/tests/backend/services/emotes/emote-manager.test.ts` — asserts cross-platform scoping (Kick's no-op loader is not invoked on Twitch); exact `cfb0033` regression class.
- `apps/desktop/tests/backend/api/platforms/kick/kick-pin-mutations.test.ts` — stubs `fetch`, asserts URL/method/body envelope; a wire-layer schema change fails this.
- `apps/desktop/tests/helpers/better-sqlite3-shim.test.ts` — parity coverage including `ON CONFLICT … DO UPDATE` and `@`-prefixed named params.
- `apps/desktop/tests/services/third-party-cookie-stripper.integration.test.ts` — header-level comment names the failure mode the unit suite can't catch.

**Shallow archetypes — Delete or Rewrite candidates:**
- `apps/desktop/tests/components/ui/button.test.tsx` (renders, variant class, disabled prop, onClick — all library defaults).
- `apps/desktop/tests/components/ui/skeleton.test.tsx` (asserts `animate-pulse` class).
- `apps/desktop/tests/components/ui/loading-spinner.test.tsx` (inline-style px values, brand RGB).
- `apps/desktop/tests/components/ui/visually-hidden.test.tsx` (one assertion that children render).
- `apps/desktop/tests/components/stream/stream-card-skeleton.test.tsx` (asserts `.animate-pulse`).
- `apps/desktop/tests/components/ui/card.test.tsx` (asserts `<h3>` element, children forward).
- `apps/desktop/tests/components/ui/platform-avatar.test.tsx` (mocks the thing it claims to test; asserts Tailwind bg class).

**Existing helpers and conventions:**
- `apps/desktop/tests/test-utils.tsx` — `renderWithProviders`, `installElectronAPIMock` (Proxy auto-stubs), `fixtures.{stream,channel,category}`, `routerMock`. Re-export of `@testing-library/react` + `userEvent`.
- `apps/desktop/tests/setup.ts` — polyfills (`matchMedia`, `ResizeObserver`, `IntersectionObserver`, `scrollIntoView`, pointer events).
- `apps/desktop/tests/e2e/fixtures/electron-app.ts` — Playwright `electronApp` + `mainWindow` fixtures. **Build-target path issue (resolved in U0):** the fixture launches `apps/desktop/out/StreamFusion-<platform>-x64/streamfusion.exe` but `npm run dist` produces `apps/desktop/release/`. U0 reconciles before U18.
- `apps/desktop/tests/e2e/fixtures/test-utils.ts` — `waitForElement`, `retry`, `debugScreenshot`.
- `apps/desktop/tests/e2e/page-objects/` — `MainWindow`, `AppNavigation`.
- `apps/desktop/tests/e2e/playbooks/` — 13 markdown playbooks (12 numbered + `99-full-app-sweep`) parallel to the 14 specs (relevant context for U18).
- Backend tests stub `fetch` via `vi.stubGlobal('fetch', …)` with `beforeEach` / `afterEach` — `vi.unstubAllGlobals()`.
- Newer test files include header comments explaining WHY a test exists (e.g., `twitch-pin-poller.test.ts`, `better-sqlite3-shim.test.ts`, `third-party-cookie-stripper*.test.ts`) — this is the de-facto precedent for R5's `// Guards:` rule.

### Institutional Learnings

- `docs/solutions/architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md` — covers Kick fan-out cold-burst (`6d3606d`) + public-stream cache (`cb0b7b6`). Names the four-part contract (TTL > poll interval; stagger after cache check; AbortController scoped per dispatch; transient-failure suppression). Each part becomes a regression-test shape. Note: `640870a refactor(kick): tighten poll-cache + stagger after multi-agent review` landed AFTER these fixes and refactored their surface — see U7 Execution note for the behavior-contract workaround.
- `docs/solutions/architecture-patterns/singleton-bus-multiview-channel-filter-2026-05-19.md` — structural sibling of the emote scoping leak (`cfb0033`) and multistream emote race (`7b80b33`). Same recipe: mount 2+ panels, fire event for channel A, assert channel B handler is a no-op. Mocks for `twitchChatService` / `kickChatService` should expose `.emit()` directly.
- `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md` — explicit test contract for the dual-numeric-ID / slug-mismatch class. Names `apps/desktop/tests/store/follow-store.test.ts` and `apps/desktop/tests/lib/id-utils.test.ts` as the truth-table pattern.
- `docs/solutions/integration-issues/twitch-gql-search-pagination-skeleton-flicker-loop-2026-05-17.md` — names the existing 26-test regression suite for the search pagination cursor bug; per-`endReason` assertions are the codebase idiom for upstream-flake guards.
- `docs/solutions/integration-issues/twitch-viewer-prediction-read-discovery-2026-05-18.md` — documents the Hermes WebSocket envelope (`notification` / `subscribe` / `welcome` / `keepalive` / `reconnect`) that chat-service mocks should mirror. Auth optional for `predictions-channel-v1.*`.
- `docs/solutions/integration-issues/twitch-irc-missing-chat-scopes-2026-05-19.md` — recent example of the "lock a load-bearing config with per-item `toContain` assertions" pattern; mirror for any flat-list config the audit deems load-bearing.

### External References

No external research conducted — local patterns and learnings cover the audit's needs.

---

## Key Technical Decisions

- **Pre-audit cleanup is verification-only**: the shim + parity test + third-party-cookie-stripper + vitest.config + database-service.test.ts changes already landed on `main` (commits `c91ce25`, `2f25211`, `1b1e30b`, and earlier) before this plan was written. U1 confirms baseline rather than committing. The session-start git status snapshot the plan was authored against was stale; the audit starts on the already-clean tree.
- **Build-target path reconciliation lands as its own unit (U0) before audit batches start.** Playwright config + fixture point at `out/StreamFusion-<platform>-x64/`; `npm run dist` outputs to `release/`. U0 chooses one resolution (repoint Playwright to read from `release/win-unpacked/` etc., or add a `package` script that produces `out/`-shaped output) and unblocks U18 + U19a's CI shape.
- **Audit log and gaps backlog as single growing markdown files** (`docs/test-audit/2026-05-19-audit-log.md`, `docs/test-audit/2026-05-19-gaps-backlog.md`): matches existing `docs/brainstorms/`, `docs/plans/`, and `docs/solutions/` conventions. Per-batch updates appended chronologically. **Lifecycle:** audit log gets a `point-in-time snapshot, not maintained` header at U19; gaps backlog converts to GitHub issues at U19 and the markdown file is deleted.
- **`// Guards:` comments at top of the `describe` block, one line per regression guarded**: in-place rather than external registry per origin Key Decisions. When a test guards multiple regressions, list each on its own `// Guards:` line so a future renamer / restructurer can see them all.
- **Regression test placement is alongside existing tests in the same directory**, not in a separate `regressions/` tree. Co-location keeps the WHY adjacent to the WHAT and matches the codebase's existing convention.
- **Characterization-first execution posture for all R7 / R8 backfills**: the test must demonstrate the failure before the fix can be claimed to prevent it. The audit log records both the parent-fails commit SHA and the fix-passes commit SHA. When the parent commit doesn't build under the current toolchain, the **source-diff-revert fallback** applies: revert only the source diff of the fix commit onto current HEAD (preserving today's lockfile/config), run the new test against that synthetic buggy state, then re-apply the fix and run again. Documented in `tests/AGENTS.md`.
- **CI vitest gating ships at U19a (after Phase 3), not at U19**: front-loads the strategic value (CI gating exists) to a point that's reachable even if the audit stalls in Phases 4–7. U19a depends on Phase 3 completion (named regression backfills landed), not on full audit completion. U19's remaining deliverables (AGENTS.md refresh, conventions promotion, post-audit summary, gaps-backlog conversion) land whenever the audit truly finishes. E2E-in-CI is a separate follow-up.
- **By-area batches are commits, not necessarily PRs**: per-batch PRs add review overhead the audit doesn't need at this stage. The user can split into PRs at any point; default is one commit per batch on a single branch.
- **Each backfilled regression test stays as a discoverable test even if the original bug class is later re-fixed differently**: the `// Guards:` comment cites the SHA so the test's reason for existing survives future refactors of the area.
- **The five critical flows from origin R9 are reviewed in U3, not just transcribed:** Origin R9 was authored before the auditor reviewed the 14 existing specs + 13 playbooks. U3 produces a confirmation-or-revision recommendation against the existing specs and the recent 6-month bug history (the R7 backfill list), then surfaces it for user approval before the list is locked. Revising after U18 hardens specs invalidates spec work — cheapest revision moment is at U3.
- **`// Guards:` comment content rot is an accepted residual risk:** the convention is checked for presence at audit time, but no mechanical enforcement (lint rule, CI check) verifies the comment still describes what the test asserts after future refactors. `tests/AGENTS.md` carries a soft rule that any PR touching a guarded test should update the comment or note in PR description that the guard still holds. Reviewer attention is the mitigation, not automation.

---

## Open Questions

### Resolved During Planning

- **Audit log format**: Resolved as single growing markdown file (`docs/test-audit/2026-05-19-audit-log.md`); converted to point-in-time snapshot at U19.
- **In-flight changes commit shape**: Resolved as already-landed (no commit needed — see U1 verification step).
- **Regression backfill window**: Resolved as last 6 months (origin default). Specific commits in scope: `cfb0033`, `7b80b33`, `6d3606d`, `cb0b7b6`, plus the bug classes referenced in the docs/solutions/ entries.
- **CI integration**: Resolved as vitest-only at U19a; E2E-in-CI deferred to follow-up per F10 finding.
- **`AGENTS.md` refresh + new `tests/AGENTS.md`**: Resolved as IN scope per call-out 2; refresh expanded to full structural pass at U19 (not just testing/tooling claims).
- **Promotion of two conventions to `docs/solutions/`**: Resolved as IN scope per call-out 3.

### Deferred to Implementation

- **Per-batch PR vs single-branch commits**: defer to the auditor — depends on how active main is and whether reviewers want batch-sized review windows.
- **Exact verdict counts per batch**: knowable only during execution. Plan does not pre-classify any file beyond the explicit AE1 / shallow archetypes shown in Context & Research.
- **U0's specific resolution (repoint Playwright vs. add `package` script)**: implementer chooses at U0 based on tooling constraints; both are valid.
- **Test scenarios for currently-unknown gaps**: by definition emerge during the audit. R11 routing rule (critical-path inline / non-critical backlog) is the decision policy; specific scenarios are per-discovery.
- **Mocking-catalog doc shape** (R15): defer to U19; depends on what mocking patterns the audit actually consolidates across batches.

---

## Output Structure

    docs/
    ├── plans/
    │   └── 2026-05-19-001-refactor-test-suite-audit-plan.md  (this file)
    ├── test-audit/                                            (new, dissolves at U19)
    │   ├── 2026-05-19-audit-log.md                            (created in U2; marked point-in-time snapshot at U19)
    │   └── 2026-05-19-gaps-backlog.md                         (created in U2; converted to GitHub issues + deleted at U19)
    └── solutions/
        └── conventions/                                       (existing dir)
            ├── vitest-better-sqlite3-shim-2026-05-19.md       (created in U19)
            └── twitch-kick-client-mocking-2026-05-19.md       (created in U19)

    apps/desktop/
    ├── tests/
    │   ├── AGENTS.md                                          (created in U2)
    │   ├── e2e/playwright.config.ts                           (modified in U0 to fix build path)
    │   ├── e2e/fixtures/electron-app.ts                       (modified in U0 to fix build path)
    │   └── [existing structure, audited file-by-file in U4–U18]
    ├── package.json                                           (possibly modified in U0 to add `package` script)
    └── [no source code changes from the audit itself]

    .github/workflows/
    └── build.yml                                              (modified in U19a to add vitest job; E2E deferred)

This is a scope declaration showing the expected output shape. The implementer may adjust if execution reveals a better layout — per-unit `**Files:**` sections remain authoritative.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**`// Guards:` comment shape** — placed at the top of a test file's outermost `describe` block (or top of file if no `describe`):

    // Guards: <one-line behavior or regression class in plain language>
    // Guards: <additional line per additional regression guarded>
    describe('emote-manager', () => { ... })

Example:

    // Guards: emote loader must scope global-load state per platform so Kick's no-op stops firing on Twitch (regression cfb0033)
    // Guards: multistream mount of two different-platform streams must not race the global-load latch (regression 7b80b33)

**Audit log entry shape** (`docs/test-audit/2026-05-19-audit-log.md`) — chronological per-batch sections:

    ## Batch: <area> — YYYY-MM-DD

    **Files reviewed:** N

    | File | Verdict | Rationale (one line) |
    |------|---------|----------------------|
    | tests/.../foo.test.ts | Keep | Asserts X; would fail on Y regression |
    | tests/.../bar.test.tsx | Delete | Asserts library defaults; no app behavior covered |
    | tests/.../baz.test.ts | Rewrite | Existed for Z but assertions were render-only — rewritten to assert Z directly |

    **Regression tests added:**
    - tests/.../new-regression.test.ts — guards <bug class>. Parent commit <sha>: FAILS as expected. Fix commit <sha>: PASSES. (Or: source-diff-revert verified on current HEAD; cite the diff range.)

    **Non-critical-path gaps moved to backlog:** N (see gaps-backlog.md)

**Gaps backlog entry shape** (`docs/test-audit/2026-05-19-gaps-backlog.md`):

    ### <file path or area> — <date discovered, batch>

    **Behavior to cover:** <one-line description>
    **Suggested test shape:** <unit / integration / E2E; mocking notes>
    **Priority:** <low / medium / high based on user-facing impact>

---

## Implementation Units

### U0. Reconcile Playwright build-target path

**Goal:** Resolve the mismatch between Playwright's expected binary path (`apps/desktop/out/StreamFusion-<platform>-x64/streamfusion.exe`) and `electron-builder`'s actual output path (`apps/desktop/release/`) so U18 and U19a can execute.

**Requirements:** R13 (CI E2E dependency).

**Dependencies:** None.

**Files (implementer picks one resolution):**
- **Option A — repoint Playwright:** Modify `apps/desktop/tests/e2e/playwright.config.ts` and `apps/desktop/tests/e2e/fixtures/electron-app.ts` to launch from `apps/desktop/release/win-unpacked/streamfusion.exe` (and equivalents under `release/mac/` and `release/linux-unpacked/`).
- **Option B — add `package` script:** Modify `apps/desktop/package.json` to add a `package` script that either invokes `electron-packager` or copies `release/<platform-unpacked>/` into `out/StreamFusion-<platform>-x64/` after `dist`.

**Approach:**
- Pick whichever option has the lower coordination cost given current tooling. Repoint Playwright (A) is preferred unless Mac/Linux release paths are inconsistent enough that a script wrapper (B) is cleaner.
- Update the `playwright.config.ts` header comment that references the no-longer-existing `npm run package` script.
- Run `npm run dist:<platform>` followed by `npm run test:e2e` locally to verify the binary launches.

**Test scenarios:**
- Happy path: after `npm run dist:win`, `npm run test:e2e` launches the packaged app and `app-launch.spec.ts` passes.
- Edge case: if Option B is chosen, a clean checkout produces both `release/` AND `out/StreamFusion-win32-x64/` after `npm run dist:win && npm run package`.

**Verification:**
- `npm run test:e2e` runs against the produced binary on at least one platform.
- The playwright.config.ts header comment matches the actual script that's required.

---

### U1. Verify pre-audit baseline (cleanup already landed)

**Goal:** Confirm the in-flight test-infrastructure changes the brainstorm anticipated have already landed on `main`, and record the SHAs that constitute the audit's starting baseline.

**Requirements:** R3 (satisfied-by-history).

**Dependencies:** None.

**Files:**
- Modify: `docs/test-audit/2026-05-19-audit-log.md` (add `## Baseline` section — only after U2 creates the file). If U2 hasn't run yet, draft the baseline content here for U2 to ingest.

**Approach:**
- Run `git status` and confirm the working tree is clean (no in-flight changes carried forward from before plan-write).
- Run `git log --oneline -20` and locate the commits that landed the in-flight work: `c91ce25` (cookie-stripper feat), `2f25211` (vitest shim alias), `1b1e30b` (shim parity tests), plus the cookie-stripper test files. Record SHAs and short descriptions.
- Per R1 scope clarification: U1 (and U2) creating new audit-infrastructure files is explicitly allowed under R1 — origin R1's "review-on-demand" rule applies to *existing* support files during audit batches, not to setup work.

**Patterns to follow:**
- N/A — verification-only step.

**Test scenarios:**
- Test expectation: none — verification step, no behavioral change. `npm test` should pass before and after (which is the implicit baseline check).

**Verification:**
- `git status` reports clean tree.
- Audit log baseline section lists the cleanup-commit SHAs.
- `npm test` (from repo root) passes on the recorded baseline SHA.

---

### U2. Audit infrastructure setup

**Goal:** Create the audit log, gaps backlog, and a `tests/AGENTS.md` that codifies the quality bar, the `// Guards:` convention, the R7 + R8 regression procedure (including the source-diff-revert fallback), and the per-batch update procedure so subsequent batches can be executed without re-reading this plan.

**Requirements:** R6, R8 (procedure documentation), R11, R14 (partial — the `tests/AGENTS.md` half).

**Dependencies:** U1.

**Files:**
- Create: `docs/test-audit/2026-05-19-audit-log.md`
- Create: `docs/test-audit/2026-05-19-gaps-backlog.md`
- Create: `apps/desktop/tests/AGENTS.md`

**Approach:**
- **Audit log**: empty template with `## Audit Overview` section (scope, batch order, link back to brainstorm and this plan), then ready to accept per-batch sections per the High-Level Technical Design shape.
- **Gaps backlog**: empty template with `## Backlog Overview` section and ready to accept per-entry sections.
- **`tests/AGENTS.md`**: documents (a) Keep/Rewrite/Delete criteria from origin R4 in plain prose; (b) the `// Guards:` comment format with examples; (c) the R7 regression-on-bug rule + R8 parent-fails / fix-passes verification; (d) the **source-diff-revert fallback** for when the parent commit doesn't build under current toolchain — revert only the source diff of the fix commit onto current HEAD, run the new test against that synthetic buggy state, then re-apply the fix and run again; (e) the **PR-touch rule for `// Guards:` comments** — any PR touching a guarded test must update the `// Guards:` content to match new assertions OR include a one-line note in the PR description that the guard still holds (reviewer attention is the mitigation, not automation); (f) the critical-path-inline / non-critical-backlog routing rule from R11; (g) the check-before-delete rule for mod/* files (AutoMod / Streamlabs / giveaways are removed; retained mod features get normal verdicts); (h) how to add a new test (file location, fixtures, run scripts); (i) the scope clarification: U1/U2/U19's new support files are explicit Phase 0 deliverables and don't violate origin R1's "review-on-demand" rule.
- Cite this plan and the origin brainstorm by path so a future maintainer can find the source decisions.

**Patterns to follow:**
- `docs/solutions/` markdown style for the audit log and gaps backlog.
- Existing nested `AGENTS.md` files (`apps/desktop/src/backend/AGENTS.md`, `apps/desktop/src/backend/api/platforms/AGENTS.md`, `apps/desktop/src/components/player/AGENTS.md`) for prose tone and structure.

**Test scenarios:**
- Test expectation: none — pure documentation. Quality is verified by U3+ being executable from the docs alone.

**Verification:**
- All three files exist and are committed.
- `apps/desktop/tests/AGENTS.md` describes the audit process well enough that a new agent session can execute a batch unit without reading this plan.

---

### U3. Critical-flow review + E2E spec triage

**Goal:** Review the five critical user flows from origin R9 against the existing 14 specs + 13 playbooks + the recent 6-month bug history (R7 backfill list). Produce a confirmation-or-revision recommendation, surface it for user approval, then lock the final list and categorize the 14 specs against it.

**Requirements:** R9 (review-gated), R10.

**Dependencies:** U2.

**Files:**
- Modify: `docs/test-audit/2026-05-19-audit-log.md` (add `## Critical Flow Triage` section)
- Modify: `docs/test-audit/2026-05-19-gaps-backlog.md` (add any critical-flow-without-spec entries)

**Approach:**
- **Review pass first.** Read each spec in `apps/desktop/tests/e2e/specs/` (14 files) and each playbook in `apps/desktop/tests/e2e/playbooks/` (13 files). Cross-reference the R7 backfill list: do the named five flows cover the user-facing surface those regressions touched? Specifically: emote scoping leak surfaces in chat-with-emotes (flow c); multistream emote race in multistream add (flow d); Kick fan-out cold-burst in followed-stream render (flow b); Kick public-stream cache in stream click (flow e); pinned-message id-vs-pin-id in chat rendering (flow c); search pagination in search→category (flow e). If the named five miss a high-impact user surface, draft a revision.
- **Surface recommendation for user approval.** Append a "Recommended critical flows" subsection to the audit log: either confirm the origin five verbatim or propose specific revisions (add/swap a flow) with rationale. **Halt the audit and request user confirmation before continuing to U4+.** This is the cheapest moment to revise.
- **Lock the list.** After user approval, write the final five into the audit log's `## Critical Flow Triage` header section. Subsequent units reference this section, not origin R9.
- **Categorize the 14 specs.** For each: classify against the locked five flows AND classify mock-vs-real (does it launch the real built app via `electronApp` fixture against real or mocked backends, or does it pass through pure mocks).
- For any critical flow without an existing spec, file a high-priority backlog entry (these become inline fixes in U18).
- This unit does NOT yet modify any spec file — that's U18.

**Patterns to follow:**
- The shape established in U2's High-Level Technical Design for the audit log.

**Test scenarios:**
- Test expectation: none — analysis output is documentation gated by user approval.

**Verification:**
- Audit log contains a `## Recommended critical flows` subsection with the agent's confirm-or-revise recommendation and rationale.
- User approval recorded in the audit log (timestamp + decision).
- Audit log contains a `## Critical Flow Triage` section with the locked five flows and a table mapping all 14 specs to {flow(s) covered, real/mock classification, planned U18 verdict}.
- Gaps backlog contains entries for any locked critical flow that has no current spec covering it.

---

### U4. Audit `tests/adblock/` (14 files)

**Goal:** Apply verdicts and `// Guards:` comments to all adblock tests and backfill any regressions found in adblock history.

**Requirements:** R1, R2, R4, R5, R6.

**Dependencies:** U2.

**Files:**
- Modify or delete every file in `apps/desktop/tests/adblock/`.
- Append: `docs/test-audit/2026-05-19-audit-log.md` (add `## Batch: adblock/` section).
- Append: `docs/test-audit/2026-05-19-gaps-backlog.md` (any gaps).

**Approach:**
- Apply the Keep / Rewrite / Delete bar per `tests/AGENTS.md`.
- Check `git log apps/desktop/src/backend/services/*adblock* apps/desktop/src/components/player/twitch/*adblock*` over the last 6 months for fix commits; backfill regressions for each.
- Adblock has multiple integration-style tests already (`integration.test.ts`, `backup-stream-flow.test.ts`, `hevc-handling.test.ts`) — likely Keep, but verify each asserts behavior under regression.

**Execution note:** Characterization-first for any regression backfill — write the test, run on the parent commit of the fix, confirm fail, then check out the fix commit and confirm pass. If the parent doesn't build, fall back to source-diff-revert per `tests/AGENTS.md`.

**Patterns to follow:**
- `tests/backend/services/chat/twitch-pin-poller.test.ts` (good behavioral assertion).
- AE1 (`button.test.tsx`) shallow archetype if any adblock tests fit that pattern.

**Test scenarios:**
- Per-file: verdict + one-line rationale logged.
- Per regression backfilled: scenario stating the bug class + parent-fails + fix-passes verification (or source-diff-revert evidence).
- Edge case: any test mocking the network adblock service entirely (a la `platform-avatar.test.tsx`) — flag Rewrite to assert behavior the mock can't.

**Verification:**
- All 14 files reviewed; audit log section complete.
- `npm test` passes.
- If any test was deleted, the file is gone from the tree.

---

### U5. Audit `tests/backend/services/chat/` (~7 files)

**Goal:** Audit chat-stack tests; backfill regressions for the Twitch pinned-message id-vs-pin-id class and the singleton-bus multiview channel-filter class (structural sibling of emote scoping).

**Requirements:** R1, R2, R4, R5, R6, R7.

**Dependencies:** U2.

**Files:**
- Modify or delete every file in `apps/desktop/tests/backend/services/chat/`.
- Append: audit log + gaps backlog.

**Approach:**
- Cover existing files: `badge-resolver`, `twitch-pin-poller`, `twitch-roomstate`, `kick-roomstate`, `twitch-hermes-client`, `kick-chat-pin`.
- Backfill regression test for the Twitch pinned-message id-vs-pin-id distinction (per `project_twitch_gql_pinned_message_schema` memory). Use the GQL shape pinning approach from `twitch-pin-poller.test.ts`.
- Backfill regression test for the singleton-bus channel-filter class (per `docs/solutions/architecture-patterns/singleton-bus-multiview-channel-filter-2026-05-19.md`) — mount two chat panels, emit for channel A, assert channel B is a no-op.
- Hermes client mocks must mirror the WebSocket envelope documented in `docs/solutions/integration-issues/twitch-viewer-prediction-read-discovery-2026-05-18.md`.

**Execution note:** Characterization-first for both backfilled regressions.

**Patterns to follow:**
- `tests/backend/services/chat/twitch-pin-poller.test.ts` (good behavioral assertion).
- `docs/solutions/architecture-patterns/singleton-bus-multiview-channel-filter-2026-05-19.md` (recipe for the channel-filter test).

**Test scenarios:**
- Covers AE3 (regression backfill style). Per-file verdict + rationale.
- Regression: pinned message with `pin.id ≠ chat msg id` — chat renderer must use the chat msg id (parent commit FAILS; fix commit PASSES).
- Regression: two channels mounted, emit event for channel A → channel B handler is not invoked (mount-and-assert).
- Edge case: Hermes reconnect frame should not double-fire any handler.

**Verification:**
- All chat-service test files reviewed; audit log section complete.
- Both regressions show parent-fails / fix-passes verification in the audit log.
- `npm test` passes.

---

### U6. Audit `tests/backend/api/platforms/twitch/` (~10 files)

**Goal:** Audit all Twitch API client tests; backfill regressions for the IRC chat-scopes class and confirm the existing search-pagination regression suite is intact and properly annotated.

**Requirements:** R1, R2, R4, R5, R6, R7.

**Dependencies:** U2.

**Files:**
- Modify or delete every file in `apps/desktop/tests/backend/api/platforms/twitch/`.
- Modify: `apps/desktop/tests/backend/twitch-gql-search.test.ts` (separate location, same area).
- Append: audit log + gaps backlog.

**Approach:**
- Cover: `eventsub-client`, `gql-pin-mutations`, `helix-retry`, `helix-chat-settings`, `helix-moderation-mutations`, `helix-moderators-vips`, `helix-polls`, `helix-predictions`, `helix-unban-requests`, plus the `twitch-gql-search.test.ts` outside the subfolder.
- Note: `twitch-gql-search.test.ts` lives directly under `tests/backend/`, not inside the Twitch API subfolder — a glob scoped to `tests/backend/api/platforms/twitch/` will miss it. Use the full per-file Files list above.
- The IRC chat-scopes regression already has a test at `apps/desktop/tests/backend/auth/oauth-config.test.ts` (per `docs/solutions/integration-issues/twitch-irc-missing-chat-scopes-2026-05-19.md`) — verify still in place during U9 audit; here, confirm any related Twitch-side scope coupling is covered.
- The Twitch search pagination regression has an existing 26-test suite per `docs/solutions/integration-issues/twitch-gql-search-pagination-skeleton-flicker-loop-2026-05-17.md` — Keep, ensure `// Guards:` comment cites the doc.
- For mocking patterns, document a draft of the catalog (used by R15 in U19): how `fetch` is stubbed for Helix, how GQL is stubbed, the `vi.stubGlobal` + `vi.unstubAllGlobals` pattern.

**Execution note:** Characterization-first for any new regression backfill.

**Patterns to follow:**
- `tests/backend/services/chat/twitch-pin-poller.test.ts` and `tests/backend/api/platforms/kick/kick-pin-mutations.test.ts` (URL/method/body envelope assertions).
- Per-`endReason` discriminated assertions for any new pagination-class backfill.

**Test scenarios:**
- Per-file verdict + rationale.
- Confirm search-pagination 26-test suite still passes and is annotated with `// Guards:` referencing the docs/solutions/ doc.
- Backfill (if not already covered): any GraphQL persisted-operation hash drift would fail a shape-pinning test (similar to `twitch-pin-poller.test.ts`).

**Verification:**
- All Twitch API test files reviewed; audit log section complete.
- Mocking-catalog notes drafted (used by U19).
- `npm test` passes.

---

### U7. Audit `tests/backend/api/platforms/kick/` (3 files)

**Goal:** Audit Kick API client tests and backfill regressions for the Kick fan-out cold-burst, public-stream cache invalidation, and dual-numeric-ID classes.

**Requirements:** R1, R2, R4, R5, R6, R7.

**Dependencies:** U2.

**Files:**
- Modify or delete: `chatroom-settings-mapper.test.ts`, `pin-mutations.test.ts`, `mod-mutations.test.ts`.
- Append: audit log + gaps backlog.

**Approach:**
- The fan-out + public-stream-cache regressions correspond to `kick-client.ts` and the followed-streams polling code, NOT to these three test files. So this batch primarily lands the regression tests as new files (or new `describe` blocks in existing files where appropriate) plus audits the three existing files.
- Add a new test for the four-part fan-out contract from `docs/solutions/architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md`: (a) TTL > poll interval, (b) stagger AFTER cache check, (c) AbortController scoped per dispatch (AbortError filtered from warn path), (d) transient timeout does not preempt fresh positive-cache entry.
- The dual-numeric-ID / slug-mismatch class is handled in U10 (`store/follow-store`) and U11 (`lib/id-utils`) per the explicit prevention items in `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md` — note the cross-reference here.

**Execution note:** Characterization-first for the fan-out (`6d3606d`) and cache (`cb0b7b6`) regressions. **Surface-refactor warning:** `640870a refactor(kick): tighten poll-cache + stagger after multi-agent review` landed after both fixes and changed the function signatures (renamed constants, moved stagger inside fetch, added `staggerOffsetMs` / `signal` params). Write regression tests against the *behavior contract* (e.g., "second poll within TTL window does not hit network", "AbortError is not logged as warning"), not the current API surface. Use the source-diff-revert fallback from `tests/AGENTS.md` if checking out `6d3606d` / `cb0b7b6` parents fails to build — revert only the source diff of the fix commit onto current HEAD, test against that synthetic buggy state, then re-apply.

**Patterns to follow:**
- `tests/backend/api/platforms/kick/kick-pin-mutations.test.ts` for URL/method/body envelope assertions.
- `docs/solutions/architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md` for the four-part regression shape.

**Test scenarios:**
- Per-file verdict + rationale for the three existing tests.
- New: fan-out cold-burst regression (mount N followed streams, assert dispatches are staggered, not simultaneous).
- New: public-stream cache regression (back-to-back polls within TTL window resolve from cache, not network).
- New: AbortError handling (canceled dispatch does not log a warning).
- New: transient timeout does not poison subsequent positive-cache hits.

**Verification:**
- Three existing files have verdicts; new regression tests added.
- Parent-commit verification (or source-diff-revert evidence) recorded for `6d3606d` and `cb0b7b6` regressions.
- `npm test` passes.

---

### U8. Audit `tests/backend/services/` remaining (emotes + database-service + mod-log-writer, ~4 files)

**Goal:** Audit emote, database, and mod-log-writer tests; backfill regressions for the emote scoping leak and the multistream emote race (covers AE3).

**Requirements:** R1, R2, R4, R5, R6, R7.

**Dependencies:** U2.

**Files:**
- Modify: `apps/desktop/tests/backend/services/emotes/emote-manager.test.ts`, `apps/desktop/tests/backend/services/emotes/kick-emotes.test.ts`, `apps/desktop/tests/backend/services/database-service.test.ts`, `apps/desktop/tests/backend/services/mod-log-writer.test.ts`.
- Append: audit log + gaps backlog.

**Approach:**
- `emote-manager.test.ts` already covers cross-platform scoping (per Context & Research) — verify it explicitly catches `cfb0033`. If gaps exist, extend it. Add the `// Guards:` comment referencing `cfb0033`.
- Backfill the multistream emote race regression (`7b80b33`): mount two streams of different platforms simultaneously, assert each renders its own platform's emotes without cross-contamination. Use the singleton-bus channel-filter pattern from `docs/solutions/architecture-patterns/singleton-bus-multiview-channel-filter-2026-05-19.md` as the structural template.
- `database-service.test.ts` baseline already landed pre-audit (per U1).

**Execution note:** Characterization-first for both `cfb0033` and `7b80b33` regressions. **Surface-refactor warning:** `7b80b33` is itself a refactor+11-fixes bundle (`refactor(emotes): collapse global-load state, fix multistream race, broaden tests`), so its parent commit has a different module shape. Test against the behavior contract (cross-platform scoping holds; concurrent mount doesn't race the latch) rather than the current internal API. Source-diff-revert fallback applies if the parent doesn't build.

**Patterns to follow:**
- Existing `emote-manager.test.ts` provider-double-count assertion pattern.
- `docs/solutions/architecture-patterns/singleton-bus-multiview-channel-filter-2026-05-19.md` for the multistream race recipe.

**Test scenarios:**
- Covers AE2, AE3. Per-file verdict + rationale.
- Regression: Kick's no-op global loader is not invoked on Twitch (`cfb0033`) — Keep, ensure `// Guards:` cites the SHA.
- Regression: mounting two cross-platform streams simultaneously does not race the global-load latch (`7b80b33`) — new test, parent-fails / fix-passes (or source-diff-revert evidence).
- Integration: database-service tests pass against the `node:sqlite` shim (already covered by parity test landed pre-audit, but verify).

**Verification:**
- All four files reviewed.
- Both AE3 regressions documented in audit log with verification evidence.
- `npm test` passes.

---

### U9. Audit `tests/backend/auth/` (2 files)

**Goal:** Audit auth tests and confirm the IRC chat-scopes regression test is intact and properly annotated.

**Requirements:** R1, R2, R4, R5, R6.

**Dependencies:** U2.

**Files:**
- Modify: `apps/desktop/tests/backend/auth/oauth-config.test.ts`, `apps/desktop/tests/backend/auth/twitch-auth-refresh.test.ts`.
- Append: audit log.

**Approach:**
- `oauth-config.test.ts` already locks IRC chat scopes per `docs/solutions/integration-issues/twitch-irc-missing-chat-scopes-2026-05-19.md` using per-scope `toContain` assertions. Keep; add `// Guards:` referencing the doc.
- `twitch-auth-refresh.test.ts` — verify it covers the refresh flow's failure modes (expired token, network failure, refresh-token rotation).

**Patterns to follow:**
- `oauth-config.test.ts` per-`toContain` pattern is itself a pattern to document in `tests/AGENTS.md` for load-bearing flat-list configs.

**Test scenarios:**
- Per-file verdict + rationale.
- Confirm `oauth-config.test.ts` covers all required IRC scopes (per the docs/solutions/ doc) and would fail if any are removed.

**Verification:**
- Both files reviewed.
- `npm test` passes.

---

### U10. Audit `tests/store/` (5 files)

**Goal:** Audit Zustand store tests and backfill the Kick dual-numeric-ID / slug-mismatch regression in `follow-store.test.ts`.

**Requirements:** R1, R2, R4, R5, R6, R7.

**Dependencies:** U2.

**Files:**
- Modify: `apps/desktop/tests/store/follow-store.test.ts`, `apps/desktop/tests/store/chat-store.test.ts`, `apps/desktop/tests/store/moderated-channels-store.test.ts`, `apps/desktop/tests/store/auth-store.test.ts`, `apps/desktop/tests/store/emote-store.test.ts`.
- Append: audit log.

**Approach:**
- `follow-store.test.ts` is the explicit prevention target per `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md`. If the truth-table coverage (legacy `user_id` row + canonical `channel.id` lookup, both directions match) is not present, add it. `// Guards:` should cite the solutions doc.
- Audit the other four for shallow patterns (state shape assertions, action-called-with-args without behavior).

**Execution note:** Characterization-first for the dual-ID regression.

**Patterns to follow:**
- The truth-table format from `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md`.

**Test scenarios:**
- Per-file verdict + rationale.
- Regression: Kick channel followed under legacy `user_id` row, looked up by canonical `channel.id` → match returns true regardless of which numeric ID is stored vs queried.
- Regression: same row, looked up by slug → match returns true.

**Verification:**
- All 5 files reviewed.
- Dual-ID truth-table regression documented in audit log.
- `npm test` passes.

---

### U11. Audit `tests/hooks/`, `tests/shared/`, `tests/lib/` (~11 files combined)

**Goal:** Audit the small hooks/shared/lib clusters together; ensure `id-utils.test.ts` retains the truth-table coverage cited in the dual-ID solutions doc. Apply the check-before-delete rule to mod-related hooks.

**Requirements:** R1, R2, R4, R5, R6, R7.

**Dependencies:** U2.

**Files:**
- Modify: `apps/desktop/tests/hooks/useStickyDismissedPrediction.test.ts`, `apps/desktop/tests/hooks/dev-mod-override.test.tsx`, `apps/desktop/tests/hooks/useIsKickMod.test.tsx`, `apps/desktop/tests/hooks/useRequireModScopes.test.tsx`, `apps/desktop/tests/hooks/useHelixPoll.test.tsx`, `apps/desktop/tests/hooks/useResolveTwitchChannel.test.tsx`, `apps/desktop/tests/hooks/useChatRoomState.test.tsx`, `apps/desktop/tests/hooks/useChatSettingsSync.test.tsx`, `apps/desktop/tests/shared/auth-types.test.ts`, `apps/desktop/tests/shared/chat-types.test.ts`, `apps/desktop/tests/lib/id-utils.test.ts`.
- Append: audit log.

**Approach:**
- `id-utils.test.ts` is the second-named file in the dual-ID solutions doc. Confirm the truth-table coverage is comprehensive.
- The `*-types.test.ts` files likely assert TypeScript type-level behavior (or runtime parsers) — verify they aren't trivial.
- **Check-before-delete for mod hooks:** `useIsKickMod`, `useRequireModScopes`, and `dev-mod-override` cover mod-feature hooks. Per Scope Boundaries: read each test, check whether it references AutoMod / Streamlabs OAuth / giveaway code paths in source. Only those are Delete-class; tests for retained mod features (timeout, ban, mod-log, VIP table, unban-request) get normal R4 verdicts.

**Patterns to follow:**
- Same truth-table format as U10.

**Test scenarios:**
- Per-file verdict + rationale.
- Confirm id-utils truth-table covers all canonical-id-vs-legacy-id permutations.

**Verification:**
- All 11 files reviewed.
- Mod hook tests classified per check-before-delete rule.
- `npm test` passes.

---

### U12. Audit `tests/components/ui/`, `layout/`, `auth/`, `TopNavBar/`, `search/`, `icons/` + root primitives (~20-25 files)

**Goal:** Audit the component primitive layer where the shallow-archetype pattern is densest (per AE1 and Context & Research). Expect a high Delete / Rewrite ratio.

**Requirements:** R1, R2, R4, R5, R6.

**Dependencies:** U2.

**Files:**
- Audit all files in `apps/desktop/tests/components/ui/`, `apps/desktop/tests/components/layout/`, `apps/desktop/tests/components/auth/`, `apps/desktop/tests/components/TopNavBar/`, `apps/desktop/tests/components/search/`, `apps/desktop/tests/components/icons/`, and `apps/desktop/tests/components/ToastRoot.test.tsx`.
- Append: audit log + gaps backlog.

**Approach:**
- Apply AE1 archetype aggressively to `ui/` primitives — most are wrappers around library defaults.
- `layout/`, `auth/`, `TopNavBar/` may have more app-specific behavior (auth flows, navigation logic). Audit individually.
- Document a representative deletion count in the audit log so the rest of the components phase can apply lessons.

**Patterns to follow:**
- AE1 (`button.test.tsx`) shallow archetype.
- For Rewrites of auth/navigation tests, prefer integration-style assertions that exercise the route or redux interaction.

**Test scenarios:**
- Per-file verdict + rationale.
- Any Rewrite: state the new behavior it should assert (one line, plain language).

**Verification:**
- All files in the six subdirectories + root primitive reviewed.
- `npm test` passes.

---

### U13. Audit `tests/components/chat/` base components (~18 files)

**Goal:** Audit chat-component tests excluding the `chat/mod/` subtree (which is U13b). High-value area given recent emote bugs and singleton-bus risk class.

**Requirements:** R1, R2, R4, R5, R6.

**Dependencies:** U2.

**Files:**
- Modify or delete every file directly in `apps/desktop/tests/components/chat/` (excluding the `mod/` subdirectory).
- Cover: `ChatBadge`, `ChatEmote`, `Username`, `EmoteImage`, `ChatMessageList`, `BadgeTooltip`, `EmoteTooltip`, `ChatPanel`, `ChatMessage`, `KickChat`, `TwitchChat`, `PinnedMessageBanner`, `PredictionBanner`, `InfoBanner`, `EmoteDialog`, `EmoteAutocomplete`, `MentionAutocomplete`, `ChatInput`, `TwitchPinMessageDialog`.
- Append: audit log + gaps backlog.

**Approach:**
- For tests that rely heavily on mocks (e.g., `EmoteImage` mocking `ProxiedImage`), check whether the test asserts behavior the mock can't (per the `platform-avatar.test.tsx` shallow archetype).
- `ChatMessageList`, `ChatPanel`, `KickChat`, `TwitchChat` are high-value — verify they assert behavior under multiview (per the singleton-bus learning). If not, file a gap or backfill inline (chat rendering is a critical flow).
- `PinnedMessageBanner` should guard the pinned-message id-vs-pin-id distinction.

**Patterns to follow:**
- `tests/backend/services/chat/twitch-pin-poller.test.ts` for behavior assertion against real GQL shapes.
- `docs/solutions/architecture-patterns/singleton-bus-multiview-channel-filter-2026-05-19.md` for the multiview filter recipe.

**Test scenarios:**
- Per-file verdict + rationale.
- Gap (likely): chat rendering for channel A is unaffected by event emitted for channel B — critical-path so backfill inline if missing.

**Verification:**
- All ~19 base chat files reviewed; audit log section complete.
- `npm test` passes.

---

### U13b. Audit `tests/components/chat/mod/` subtree (~12 files)

**Goal:** Audit the chat/mod subtree as a separate batch since most of it is likely Delete-class per the channel-mgmt scope removal.

**Requirements:** R1, R2, R4, R5, R6.

**Dependencies:** U2.

**Files:**
- Modify or delete every file in `apps/desktop/tests/components/chat/mod/` including the `UserPopout/` and `tabs/` subdirectories.
- Cover: `TimeoutDurationPicker`, `InlineModStrip`, `RaidTargetPicker`, `ModActionConfirmDialog`, `UserPopout/UserPopout`, `UserPopout/UserModHistory`, `UserPopout/UserPopoutFooter`, `UserPopout/UserPopoutProvider`, `tabs/ModLogTab`, `tabs/EngagementPolls`, `tabs/EngagementPredictions`.
- Append: audit log + gaps backlog.

**Approach:**
- Apply the **check-before-delete rule** from Scope Boundaries: per-file, read the test and check whether it references AutoMod / Streamlabs OAuth / giveaway code paths in source. Those are Delete-class. Tests for retained mod features (timeout, ban, mod-log, VIP table, unban-request, polls, predictions UI hooks) get normal R4 verdicts.
- `tabs/EngagementPolls.test.tsx` and `tabs/EngagementPredictions.test.tsx` are retained-feature tests — audit under normal R4 criteria.
- `TimeoutDurationPicker`, `ModActionConfirmDialog`, `InlineModStrip`, `UserPopout/*` cover retained mod features — audit under normal R4.

**Patterns to follow:**
- Same as U13 for retained tests.
- AE1 shallow archetype for likely Delete candidates.

**Test scenarios:**
- Per-file verdict + rationale, with explicit check-before-delete evidence noted (whether the file references removed-feature code paths).

**Verification:**
- All ~12 mod files reviewed; audit log section complete.
- Delete-class files are gone from the tree; retained files have `// Guards:` comments.
- `npm test` passes.

---

### U14. Audit `tests/components/stream/` + `tests/components/discovery/` (~7 files)

**Goal:** Audit stream-card and discovery-grid tests; identify shallow vs behavior-asserting tests.

**Requirements:** R1, R2, R4, R5, R6.

**Dependencies:** U2.

**Files:**
- Modify or delete every file in `apps/desktop/tests/components/stream/` and `apps/desktop/tests/components/discovery/`.
- Append: audit log + gaps backlog.

**Approach:**
- Cover: stream-grid, stream-info, featured-stream, stream-card-skeleton, related-content (ClipCard, ClipDialog, ClipPlayer, ContentTabs, index, VideoCard), category-grid, virtualized-category-grid, category-card-skeleton.
- Skeleton tests (already flagged shallow in Context & Research) likely Delete.
- Virtualized grid tests may have real behavior (scroll virtualization, key stability) worth keeping.

**Patterns to follow:**
- AE1 archetype for skeletons.

**Test scenarios:**
- Per-file verdict + rationale.

**Verification:**
- All files reviewed.
- `npm test` passes.

---

### U15. Audit `tests/components/player/` (~10 files including hooks subfolder)

**Goal:** Audit video-player and player-hooks tests; backfill any player-specific regressions found.

**Requirements:** R1, R2, R4, R5, R6, R7.

**Dependencies:** U2.

**Files:**
- Modify or delete every file in `apps/desktop/tests/components/player/`.
- Append: audit log + gaps backlog.

**Approach:**
- Cover: settings-menu, video-player, player-controls, progress-bar, seek-preview, hls-player, performance-enhanced-player, mini-player, controls, hooks/use-volume.
- Check `git log apps/desktop/src/components/player/` for any recent fix commits in the last 6 months; backfill regressions if found.
- Player code interacts with the adblock layer (U4) — verify cross-area coverage is not duplicated.

**Patterns to follow:**
- Player-related behavior assertions should cover real DOM event flow (play/pause/seek), not just prop forwarding.

**Test scenarios:**
- Per-file verdict + rationale.

**Verification:**
- All files reviewed.
- `npm test` passes.

---

### U16. Audit `tests/components/multistream/` (3 files)

**Goal:** Audit multistream component tests — high-priority area given the `7b80b33` race history. Verify multistream-specific bugs are covered.

**Requirements:** R1, R2, R4, R5, R6, R7.

**Dependencies:** U2, U8 (so the cross-platform emote race regression added in U8 is visible).

**Files:**
- Modify: `apps/desktop/tests/components/multistream/add-stream-dialog.test.ts`, `grid-layout.test.ts`, `sortable-stream-slot.test.ts`.
- Append: audit log + gaps backlog.

**Approach:**
- These component-level tests complement the service-level emote race regression added in U8. Ensure they cover user-facing multistream interactions (add, remove, drag-and-sort) under behavior assertion, not just rendering.
- If the cross-platform emote rendering test belongs at the component level (vs U8's service-level test), add or reference it here.

**Patterns to follow:**
- AE3 multistream race recipe (extended to component level if appropriate).

**Test scenarios:**
- Per-file verdict + rationale.
- Edge case: adding a second stream while the first is mid-load — order of operations holds.

**Verification:**
- All 3 files reviewed.
- `npm test` passes.

---

### U17. Audit `tests/pages/` top-level (~12 files)

**Goal:** Audit top-level page tests excluding the `pages/Mod/` subtree (which is U17b).

**Requirements:** R1, R2, R4, R5, R6.

**Dependencies:** U2.

**Files:**
- Modify or delete every file directly in `apps/desktop/tests/pages/` (excluding the `Mod/` subdirectory).
- Cover: Categories, CategoryDetail, History, Downloads, Clip, MultiStream, Following, Home, SearchResults, Settings, Stream, Video.
- Append: audit log + gaps backlog.

**Approach:**
- Page tests overlap with E2E specs (U18). Verify they cover behavior the E2E specs don't (e.g., specific data-loading paths, error states) rather than duplicating navigation tests.
- Where overlap exists, prefer deleting the page-level test in favor of the E2E spec (and ensure the spec is kept in U18).

**Patterns to follow:**
- `apps/desktop/tests/test-utils.tsx` `renderWithProviders` for page rendering setup.

**Test scenarios:**
- Per-file verdict + rationale.

**Verification:**
- All ~12 top-level page files reviewed.
- `npm test` passes.

---

### U17b. Audit `tests/pages/Mod/` subtree (7 files)

**Goal:** Audit the pages/Mod subtree as a separate batch since most of it is likely Delete-class per the channel-mgmt scope removal.

**Requirements:** R1, R2, R4, R5, R6.

**Dependencies:** U2.

**Files:**
- Modify or delete every file in `apps/desktop/tests/pages/Mod/` including the `channel/` subdirectory.
- Cover: `index`, `channel/ModChannelPage`, `channel/ChannelModLogFeed`, `channel/ChannelModeratorsTable`, `channel/ChannelVipsTable`, `channel/ChannelUnbanRequests`, `channel/ChannelBannedList`.
- Append: audit log + gaps backlog.

**Approach:**
- Apply the **check-before-delete rule** from Scope Boundaries: per-file, check whether the page references AutoMod / Streamlabs / giveaway code paths in source. Those are Delete-class. Tests for retained mod features (moderator table, VIP table, banned list, unban requests, mod log feed) get normal R4 verdicts.
- The above retained-feature names match the retained Kick moderation feature set. If any of those page tests are shallow (renders the page, queries data), apply AE1 archetype.

**Patterns to follow:**
- Same as U17 for retained tests.
- AE1 shallow archetype for likely Delete candidates.

**Test scenarios:**
- Per-file verdict + rationale, with explicit check-before-delete evidence.

**Verification:**
- All 7 Mod page files reviewed.
- Delete-class files are gone; retained files have `// Guards:` comments.
- `npm test` passes.

---

### U18. Audit + harden `tests/e2e/` (14 specs)

**Goal:** Apply U3's triage outcomes — keep and harden specs covering the locked critical flows, delete or rewrite specs that mock the path they claim to test, and fix any critical-flow gap inline.

**Requirements:** R9, R10, R11.

**Dependencies:** U0 (build-target path reconciliation), U2, U3 (which produced the triage and the user-approved critical-flow list).

**Files:**
- Modify or delete every spec in `apps/desktop/tests/e2e/specs/`.
- Possibly modify: `apps/desktop/tests/e2e/fixtures/electron-app.ts`, `tests/e2e/fixtures/test-utils.ts`, `tests/e2e/page-objects/MainWindow.ts`, `tests/e2e/page-objects/AppNavigation.ts` (only when an audited spec requires it).
- Append: audit log + gaps backlog.

**Approach:**
- For specs covering a critical flow: keep, add `// Guards:` referencing the flow, ensure waits are deterministic (not arbitrary timeouts), prefer real Twitch/Kick API responses (or recorded fixtures via Playwright's request interception) over pure mocks.
- For specs covering non-critical flows: Keep if they pass the bar, else Delete.
- For specs that mock the path they're supposedly testing (per origin R10's Rewrite criterion): rewrite to exercise the real stack, or Delete if rewriting is impractical and no critical flow is at stake.
- For any critical flow without an existing spec (per U3 backlog entries): add a new spec inline as part of this unit.
- Confirm `apps/desktop/tests/e2e/playbooks/` markdown files are still accurate for the resulting spec set; update or delete stale playbooks.

**Execution note:** Specs require a built app at the path resolved in U0. Build with `npm run dist:<platform>` (Option A) or `npm run package` (Option B) per U0's resolution.

**Patterns to follow:**
- `apps/desktop/tests/e2e/fixtures/electron-app.ts` for the `electronApp` + `mainWindow` fixture pattern.
- `apps/desktop/tests/e2e/page-objects/MainWindow.ts` / `AppNavigation.ts` for selector locality.

**Test scenarios:**
- Per-spec verdict + rationale.
- Each locked critical flow has at least one spec that exercises the real stack and passes.
- Covers AE4 in part (critical-flow inline fix for any flow without coverage).

**Verification:**
- All 14 specs reviewed.
- All locked critical flows have green E2E coverage on a freshly-built app.
- `npm run test:e2e` passes (after the U0-resolved build step).
- Audit log section complete; playbooks updated.

---

### U19a. CI vitest gate (early close-out)

**Goal:** Wire `npm test` into CI immediately after Phase 3 so the named regression backfills (emote scoping, multistream race, Kick fan-out, public-stream cache, dual-ID, pinned-message, search pagination) become load-bearing gates as soon as they land — even if Phases 4–7 stall.

**Requirements:** R13 (vitest portion).

**Dependencies:** Phase 3 complete (U4 through U9, including all named regression backfills landed and green).

**Files:**
- Modify: `.github/workflows/build.yml` (add a `test` job that runs `npm test --workspace=streamfusion`, depends on `npm ci` like the existing build job, runs in parallel with build).

**Approach:**
- Add a new job to `build.yml` (or extend the existing `build` job with a `npm test` step before the build step — whichever the team prefers).
- Job runs on the same matrix as build (`windows-latest`, `macos-latest`) and on every push + PR.
- E2E-in-CI is NOT wired here — deferred to a separate follow-up per F10 finding. The reason: Playwright's build-target needs U0's resolution to be merged AND tested in CI before a meaningful E2E CI job can be designed; matrix complexity for a CI build → CI E2E chain is its own decision worth a separate planning pass.
- After the workflow change merges, verify on a deliberately-failing branch (don't merge; just push) that the test job fails the build status.

**Test scenarios:**
- Test expectation: none for the CI config itself — the test is "deliberately-broken vitest test causes the test job to fail."
- For CI wire-up: a deliberately-failing test (added on a throwaway branch, not merged) causes the test job to fail.

**Verification:**
- CI runs `npm test` on every push.
- Deliberately-broken test fails the test job.
- The build job continues to work unchanged.
- vitest job wall-clock recorded (target: under 5 minutes per PR; if exceeded, file a sharding follow-up).

---

### U19. Close-out — AGENTS.md refresh, conventions promotion, gaps-backlog conversion, post-audit summary

**Goal:** Land the remaining close-out deliverables: refresh stale AGENTS.md, promote two conventions to `docs/solutions/`, convert gaps backlog to GitHub issues, and write the post-audit summary.

**Requirements:** R14, R15.

**Dependencies:** U18 (the E2E audit completes; audit log captures the final state).

**Files:**
- Modify: `AGENTS.md` (root — full structural refresh, not just testing claims).
- Create: `docs/solutions/conventions/vitest-better-sqlite3-shim-2026-05-19.md`
- Create: `docs/solutions/conventions/twitch-kick-client-mocking-2026-05-19.md`
- Modify: `docs/test-audit/2026-05-19-audit-log.md` (add `## Post-Audit Summary` section with totals + `## Status: point-in-time snapshot, not maintained` header).
- Delete: `docs/test-audit/2026-05-19-gaps-backlog.md` (after converting entries to GitHub issues).

**Approach:**
- **AGENTS.md refresh (full pass, not testing-only):** rewrite the testing claims to reflect actual state — use the actual test count computed at write time (`find apps/desktop/tests -name '*.test.*' -o -name '*.spec.*' | wc -l`) plus the actual E2E spec count. Update tooling claims to match reality: `electron-vite` (not Vite directly), `electron-builder` (not `electron-forge`; remove all `forge.config.ts` references), `biome` (not eslint/prettier). Update the `Branch:` and date metadata. Verify path aliases match current `tsconfig`. Cross-check against current `apps/desktop/package.json` scripts.
- **Conventions promotion:**
  - `vitest-better-sqlite3-shim-2026-05-19.md`: document the alias setup, the shim's surface, the parity test contract, and when to add a parity case (mirror the comment header on `better-sqlite3-shim.test.ts`).
  - `twitch-kick-client-mocking-2026-05-19.md`: catalog the `vi.stubGlobal('fetch', …)` pattern, the Hermes envelope shape, the GQL persisted-operation hash assertion pattern, and the per-platform reset (`vi.unstubAllGlobals()` in `afterEach`). If the patterns don't cohere into one doc (research found the surfaces are heterogeneous — Helix REST, GQL persisted-ops, Hermes WebSocket, Kick REST), ship as separate per-surface guides instead: `twitch-helix-mocking.md`, `twitch-gql-mocking.md`, `twitch-hermes-mocking.md`, `kick-client-mocking.md`. Decide at write time based on what the audit actually consolidated.
- **Gaps backlog conversion:** for each entry in `gaps-backlog.md`, create a GitHub issue with the entry's text as the body (label: `test-audit-gap`, milestone optional). Verify all entries converted, then delete the markdown file. Future maintainers find gaps in the issue tracker, not in a rotting markdown file.
- **Post-audit summary:** append totals to the audit log (files reviewed, Keep/Rewrite/Delete counts per batch, regression tests added, gaps issue count). Add the `## Status: point-in-time snapshot, not maintained` header at the top of the audit log so future readers see immediately it isn't live state.

**Patterns to follow:**
- Existing `docs/solutions/conventions/tailwind-flex-truncation-trio-2026-05-18.md` for the conventions doc shape.
- Existing root `AGENTS.md` structure for the refresh (but verify everything against current reality before copying old text).

**Test scenarios:**
- Test expectation: none for the docs — pure documentation.

**Verification:**
- Root `AGENTS.md` no longer says "no tests yet"; tooling claims match the actual stack (no `forge.config.ts` references); test counts computed against current tree.
- Both convention docs land in `docs/solutions/conventions/` (or, if heterogeneous, the per-surface guides land instead).
- All gaps-backlog entries appear as GitHub issues with the `test-audit-gap` label; the markdown file is deleted.
- Audit log has a complete `## Post-Audit Summary` section + `## Status: point-in-time snapshot` header.

---

## System-Wide Impact

- **Interaction graph:** No production code interaction changes from the audit itself. The audit modifies test code, audit-log files, AGENTS.md docs, `.github/workflows/build.yml` (in U19a), and possibly `apps/desktop/tests/e2e/playwright.config.ts` + `apps/desktop/package.json` (in U0).
- **Error propagation:** Existing tests' error paths are audited but not re-architected; new regression tests follow the codebase's existing error-stub conventions.
- **State lifecycle risks:** The audit will run over weeks. Drift risk: if other work merges new tests during the audit, those tests should follow `tests/AGENTS.md` going forward. Mitigation: the per-batch commit shape lets the audit pause and resume; new tests added mid-audit get a `// Guards:` retroactively when their area's batch lands.
- **API surface parity:** None — no public APIs change.
- **Integration coverage:** The E2E batch (U18) explicitly addresses cross-layer integration for the locked critical flows. Service-level tests added in U5–U10 cover singleton-bus, fan-out, and emote-scoping integration concerns that unit tests would miss.
- **Unchanged invariants:** Existing source code under `apps/desktop/src/` is not modified by the audit (except possibly `apps/desktop/package.json` in U0 if Option B is chosen). The audit is a test-and-docs operation, not a refactor.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Audit takes weeks and source code drifts under it | By-area batching limits exposure per batch; tests added mid-audit get retroactive `// Guards:` in the area's batch. |
| Per-batch gap discovery snowballs and the audit never finishes | Origin R11 routing rule: critical-path inline, non-critical to backlog. Codified in `tests/AGENTS.md` (U2) before any batch runs. |
| Regression test for an old commit can't be cleanly reproduced (dependency drift, deleted code paths, or post-fix refactor changed the API surface) | Origin R8 allows best-effort with explicit caveat. The **source-diff-revert fallback** (documented in `tests/AGENTS.md`) handles the common case: revert only the source diff of the fix commit onto current HEAD, test against that synthetic buggy state, then re-apply. U7's `640870a` post-fix refactor and U8's `7b80b33` refactor-bundle are pre-flagged in their Execution notes. |
| Parent commit doesn't build at all under current toolchain | Source-diff-revert fallback (above) bypasses build-bisect entirely by working on current HEAD's lockfile/config. |
| CI vitest gate at U19a exposes failing tests in audited areas | U19a sequenced after Phase 3 (named regression backfills landed and green). If new failures surface, they become Phase 4–6 audit findings, not blockers. |
| Phases 4–7 stall after named regressions land in Phase 3 | U19a wires the CI gate after Phase 3, not after U18, so the strategic value (CI gating) ships even if remaining phases lag. U19's docs/conventions promotion + gaps-backlog conversion lands whenever the audit finishes. |
| Playwright build-target path mismatch blocks U18 + U19a's E2E plans | U0 resolves the mismatch before U18. E2E-in-CI is deferred past U19a so the build-path resolution can be tested in CI independently. |
| Promoted convention docs (R15) drift from reality | Cite specific files (`tests/helpers/better-sqlite3-shim.ts`, sample Twitch/Kick test files) so future readers can verify against living code. |
| AGENTS.md refresh introduces new errors (tooling, scripts) | Cross-check against `apps/desktop/package.json` scripts live during U19; do not copy old text. Full structural pass per F23. |
| `// Guards:` comment content rots after future refactors | Soft rule in `tests/AGENTS.md`: PR touching guarded test updates comment or notes guard-still-holds in PR description. Reviewer attention is the mitigation; mechanical enforcement intentionally absent. |
| Mocking-catalog (R15) doesn't generalize across Twitch / Kick surfaces | Fallback: U19 ships per-surface guides instead of a single catalog. Decision made at write time based on what audit consolidated. |
| Critical-flow list locks the wrong five | U3 produces a confirm-or-revise recommendation against existing specs + 6-month bug history; user approves before U4+ proceed. Cheapest revision moment is at U3. |
| User loses interest or capacity mid-audit | Per-batch commits leave the suite in a coherent state at every pause point. The audit log + gaps backlog form a complete handoff surface for a future session or agent. U19a's CI gate after Phase 3 means the highest-value piece ships first. |

---

## Phased Delivery

### Phase 0 — Setup
- U0: Reconcile Playwright build-target path
- U1: Verify pre-audit baseline (cleanup already landed)
- U2: Audit infrastructure (log, backlog, `tests/AGENTS.md`)
- U3: Critical-flow review + E2E spec triage (user-approval gate at end)

### Phase 1 — Adblock
- U4: `adblock/` batch

### Phase 2 — Chat & API platforms
- U5: `backend/services/chat/` batch
- U6: `backend/api/platforms/twitch/` batch
- U7: `backend/api/platforms/kick/` batch (surface-refactor warning in Execution note)

### Phase 3 — Other backend
- U8: `backend/services/` remaining (emotes + database + mod-log) (surface-refactor warning)
- U9: `backend/auth/` batch

### Phase 3.5 — Early close-out
- **U19a: CI vitest gate.** Ships immediately after Phase 3 so the named regression backfills become load-bearing even if remaining phases lag.

### Phase 4 — Frontend state and small modules
- U10: `store/` batch
- U11: `hooks/` + `shared/` + `lib/` combined batch (with check-before-delete on mod hooks)

### Phase 5 — Components
- U12: `components/ui/` + `layout/` + `auth/` + `TopNavBar/` + `search/` + `icons/` + root primitives (~20-25 files)
- U13: `components/chat/` base components (~18 files)
- U13b: `components/chat/mod/` subtree (~12 files; mostly Delete-class with check-before-delete)
- U14: `components/stream/` + `discovery/` batch
- U15: `components/player/` batch
- U16: `components/multistream/` batch (depends on U8; the cross-platform emote-race regression added in Phase 3 must be in place first)
- U17: `pages/` top-level (~12 files)
- U17b: `pages/Mod/` subtree (~7 files; mostly Delete-class with check-before-delete)

### Phase 6 — E2E
- U18: `e2e/` batch (audit + critical-flow hardening; depends on U0 for build path)

### Phase 7 — Final close-out
- U19: AGENTS.md refresh + conventions promotion + gaps-backlog → GitHub issues + post-audit summary + audit log point-in-time snapshot header

Each phase can be paused, resumed, or split across PRs. Default delivery: one commit per unit on a single branch; merge to main per phase as readiness allows. **U19a is the load-bearing checkpoint** — once it ships, the audit's strategic value (CI gates the named regressions) is realized regardless of how the remaining phases play out.

---

## Documentation Plan

- `docs/test-audit/2026-05-19-audit-log.md` — created in U2, updated every batch, summarized + marked point-in-time-snapshot in U19.
- `docs/test-audit/2026-05-19-gaps-backlog.md` — created in U2, updated every batch, converted to GitHub issues + deleted in U19.
- `apps/desktop/tests/AGENTS.md` — created in U2; becomes the per-test-conventions source of truth.
- `AGENTS.md` (root) — refreshed in U19 (full structural pass, not just testing/tooling claims).
- `docs/solutions/conventions/vitest-better-sqlite3-shim-2026-05-19.md` — created in U19.
- `docs/solutions/conventions/twitch-kick-client-mocking-2026-05-19.md` — created in U19 (or split into per-surface guides if patterns don't cohere).

---

## Operational / Rollout Notes

- No production deploy risk — the audit modifies tests, docs, and CI workflow; no shipped application behavior changes.
- **Mid-audit drift policy.** Merge cadence is per-phase to main. New tests landing on main during the audit defer to the next batch in their area for retroactive `// Guards:` — if the area's batch has already merged, the retroactive step becomes its own follow-up commit. Mid-audit fix commits become R7 backfill candidates (added to the gaps backlog, folded into the next applicable batch). CI is not gating until U19a — until then, reviewer attention on each batch commit/PR is the gating mechanism. After U19a, the CI vitest gate enforces baseline behavior.
- U19a's CI wire-up makes vitest gating. If the team's PR velocity depends on the existing "all green" assumption being soft, the wire-up may cause short-term friction as flaky tests surface. Mitigation: most flakes get filed in the gaps backlog for separate follow-up; CI matrix vitest measurements should land in U19a's audit-log entry (target: under 5 minutes per PR per platform).
- The convention docs in `docs/solutions/` are reference material, not runbooks — no rollout concern.
- E2E-in-CI is intentionally deferred past U19a. When that follow-up gets planned, it should account for U0's build-path resolution, the Mac/Linux matrix question, and the runtime budget of running 14+ E2E specs against a freshly-built electron app.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-19-test-suite-audit-requirements.md`
- **Codebase research summary:** captured in Context & Research above (vitest config, playwright config, helpers, conventions, shim, build-target mismatch).
- **Doc review (2026-05-19, headless + interactive):** four reviewer personas (coherence, feasibility, scope-guardian, adversarial). Headless pass applied 9 safe-auto fixes; interactive walkthrough resolved 21 Apply / 2 Skip / 0 Defer decisions, all reflected in the revised plan body.
- **Institutional learnings (cited per unit):**
  - `docs/solutions/architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md`
  - `docs/solutions/architecture-patterns/singleton-bus-multiview-channel-filter-2026-05-19.md`
  - `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md`
  - `docs/solutions/integration-issues/twitch-gql-search-pagination-skeleton-flicker-loop-2026-05-17.md`
  - `docs/solutions/integration-issues/twitch-viewer-prediction-read-discovery-2026-05-18.md`
  - `docs/solutions/integration-issues/twitch-irc-missing-chat-scopes-2026-05-19.md`
- **Recent fix commits cited as regression targets:** `cfb0033`, `7b80b33`, `6d3606d`, `cb0b7b6`. Post-fix surface refactor: `640870a`.
- **Pre-audit cleanup commits (baseline):** `c91ce25`, `2f25211`, `1b1e30b`, plus the cookie-stripper test files.
- **Related auto-memory** (informs plan, not authoritative): `project_better_sqlite3_binary_swap`, `project_kick_dual_id_followups`, `project_twitch_gql_pinned_message_schema`, `project_twitch_search_pagination_limit`, `project_channel_mgmt_scope_change_2026_05_18`.
