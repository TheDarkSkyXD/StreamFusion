---
date: 2026-05-19
topic: test-suite-audit
---

# Test Suite Audit (E2E + Unit)

## Summary

A file-by-file audit of every test in `apps/desktop/tests/` that classifies each as keep / rewrite / delete, attaches a one-line `// Guards:` comment to every kept test, and proceeds in reviewable per-area batches. Each batch backfills regression tests for the area's already-shipped bugs, so the audit produces evidence of value as it goes rather than only at the end.

---

## Problem Frame

The desktop app has ~80 unit/integration tests plus 14 E2E specs across `apps/desktop/tests/`, but the suite is not load-bearing in practice. Bugs are still shipping past green tests — most recently a Twitch emote rendering regression that traced to cross-platform loader scoping (fix: `cfb0033`) and a multistream emote race (fix: `7b80b33`), both in code areas that already had test files. The pattern suggests many existing tests assert shallow facts (component renders, prop is forwarded, mock was called) rather than the behaviors that would have failed under those regressions.

The result is a suite expensive to maintain and slow to run but producing weak confidence: critical user paths (chat with emotes, multistream, login, watching followed streams) have visible gaps, refactoring feels risky, and the count of tests has stopped correlating with how safe shipping feels.

---

## Requirements

**Audit scope and procedure**

- R1. Every file under `apps/desktop/tests/` that is a vitest or playwright test (`*.test.ts`, `*.test.tsx`, `*.spec.ts`) is reviewed exactly once. Test-support files (`tests/helpers/`, `tests/e2e/fixtures/`, `tests/e2e/page-objects/`, `tests/test-utils.tsx`) are reviewed only when a test under audit reveals them as broken or shallow.
- R2. The audit proceeds in batches by directory area, in this order: `adblock/` → `backend/services/chat/` → `backend/api/platforms/twitch/` → `backend/api/platforms/kick/` → `backend/services/` (emotes, database-service, mod-log-writer) → `backend/auth/` → `store/` → `hooks/` → `shared/` → `lib/` → `components/` (UI → chat → stream → player → multistream → discovery → layout → auth → TopNavBar → pages) → `e2e/`. Each batch lands as its own commit or PR.
- R3. Before the audit starts, the in-flight working-tree changes (`database-service.test.ts`, `third-party-cookie-stripper*`, `vitest.config.ts`, `tests/helpers/`, `tests/services/`) land as their own commit so the audit begins on a clean tree.

**Per-test verdict and purpose**

- R4. Each reviewed test receives one of three verdicts:
  - **Keep** — the test, as written, would fail if a real regression in the behavior under test were introduced.
  - **Rewrite** — the test exists for a legitimate reason but its assertions are too shallow (asserts implementation details, render-without-crash only, mock-shape verification, etc.) to catch a real regression. The verdict comes with a one-line statement of the behavior it *should* test, and rewriting happens in the same batch.
  - **Delete** — the test guards no observable behavior, duplicates another test, or has been superseded by integration coverage. Deletion happens in the same batch.
- R5. Every Keep and Rewrite test carries a one-line comment at the top of its `describe` block (or top of the file if no `describe`) stating the WHY: the specific behavior or regression class the test guards. Format: `// Guards: <behavior or regression class in plain language>`. When the test exists to prevent a specific shipped bug, the comment references the fix commit SHA in parentheses.
- R6. The audit produces a per-batch summary appended to a single tracking file (`docs/test-audit/2026-05-19-audit-log.md`) recording: files reviewed, verdicts per file with one-line rationale, regression tests added with parent-fails / fix-passes verification, and gaps backlogged.

**Regression backfill**

- R7. For each batch, every shipped bug in that area's recent git history (default window: last 6 months) gets a regression test added inline as part of the batch. Initial backfill targets are at minimum:
  - Emote scoping leak across platforms (`cfb0033`)
  - Multistream emote race (`7b80b33`)
  - Kick fan-out cold-burst (`6d3606d`)
  - Kick public-stream cache invalidation (`cb0b7b6`)
  - Kick dual-numeric-ID / slug-mismatch class (per `project_kick_dual_id_followups` memory)
  - Twitch pinned-message id-vs-pin-id distinction (per `project_twitch_gql_pinned_message_schema` memory)
  - Twitch search pagination cursor handling (per `project_twitch_search_pagination_limit` memory)
- R8. A regression test is considered valid only if it fails on the parent commit of the fix (the buggy code) and passes on the fix commit. The audit log records this verification for each backfilled regression. When a regression cannot be cleanly reproduced this way (e.g., requires upstream state long-since changed), it is documented in the log as best-effort with an explicit caveat.

**Critical-path E2E coverage**

- R9. Before the audit reaches the `e2e/` batch, the five critical user flows that must always work to ship are named explicitly:
  - (a) Launch → guest mode → home renders with stream cards
  - (b) Launch → login (Twitch + Kick) → followed streams render across both platforms
  - (c) Open a followed stream → video plays → chat renders with platform-correct emotes
  - (d) Add a second stream to multistream → both play simultaneously → emotes per-platform stay correctly scoped
  - (e) Search → result → category → click stream → stream page loads
- R10. The 14 existing E2E specs are audited against the five critical flows. Specs covering critical flows are kept and hardened (real backends where feasible, deterministic waits, no mock-only paths through the stack). Specs covering non-critical flows that pass the Keep test are retained. Specs that pass only because they mock the path they're supposedly testing are flagged Rewrite.

**Gaps discovered mid-audit**

- R11. Coverage gaps discovered during the audit are handled by criticality:
  - **Critical-path gap** (a gap meaning one of the five flows in R9 is not actually tested end-to-end) — fixed inline during the batch where it's discovered.
  - **Non-critical-path gap** — recorded in `docs/test-audit/2026-05-19-gaps-backlog.md` as a tracked item (file path, area, behavior to cover, suggested test shape) but not blocking. The backlog is worked separately after the audit completes.
- R12. The audit does not introduce new testing layers (visual regression, performance benchmarks, accessibility automation), framework changes (vitest → jest, playwright → cypress), or coverage-% thresholds in CI. The metric is per-test purpose and critical-path coverage, not numbers.

---

## Acceptance Examples

- AE1. **Covers R4.** Given a test file `apps/desktop/tests/components/ui/button.test.tsx` that asserts only "button renders without crashing" and "onClick prop is forwarded", when the auditor reviews it, the verdict is **Delete** — these assertions guard no observable StreamForge-specific behavior (the underlying button library covers them and a real button regression in our app would not be caught). The deletion is included in the `components/` batch commit.
- AE2. **Covers R4, R5.** Given a test file `apps/desktop/tests/backend/services/emotes/emote-manager.test.ts` that has substantive assertions about per-platform scoping but no comment explaining WHY, when the auditor reviews it, the verdict is **Keep** and a `// Guards: emote loader must scope global-load state per platform so Kick's no-op stops firing on Twitch (regression cfb0033)` comment is added.
- AE3. **Covers R7, R8.** Given the multistream emote race fixed in `7b80b33`, when the auditor reaches the multistream batch, a regression test is added that reproduces the race (mounting two streams of different platforms simultaneously) and asserts both streams display the correct platform's emotes. The auditor verifies the test fails on the parent commit of `7b80b33` and passes on `7b80b33`, and records both results in the audit log.
- AE4. **Covers R11.** Given the auditor reaches the `backend/services/chat/` batch and finds no test for the Twitch pinned-message id-vs-pin-id distinction (per memory), the gap is critical-path-adjacent (chat rendering is one of the five R9 flows), so the test is added inline. When the same auditor finds that `lib/languages.ts` has no tests, the gap is recorded in `gaps-backlog.md` (not critical-path) and the audit moves on without adding the test.

---

## Success Criteria

- The audit is complete when every test file under `apps/desktop/tests/` has a recorded verdict in the audit log, every Keep/Rewrite test has a `// Guards:` comment, every regression in the R7 list has a passing test with verified parent-fails / fix-passes behavior, and each of the five critical flows in R9 has at least one E2E spec exercising the real stack.
- A downstream agent (or future self) opening any test file in the audited suite can state in one sentence what behavior or regression class that test guards, without having to read the source under test.
- Shipping the next bug in an audited area produces a follow-up test added before the fix merges — the regression-on-bug rule becomes the steady-state habit the audit seeds.
- The audit log and gaps backlog together form a handoff surface: any session, human or agent, can pause after a batch and resume on the next batch without losing context.

---

## Scope Boundaries

- New testing layers (visual regression, screenshot diff, performance benchmarks, accessibility automation, mutation testing) are not added.
- Testing framework changes (vitest → jest, playwright → cypress) are not made.
- CI configuration changes, coverage-% thresholds, and required-check policies are not modified.
- Test-support and fixture refactoring is not undertaken proactively — only when a specific test under review requires it.
- Areas outside `apps/desktop/tests/` (other workspace packages, root-level scripts, anything in `node_modules/`) are not audited.
- The non-critical-path gap backlog is filed during the audit but worked separately after the audit ends.
- Tests for the Kick channel-management console work removed mid-build (per `project_channel_mgmt_scope_change_2026_05_18` memory) — if any exist, they are Delete-class under R4 rather than audited for keeping.

---

## Key Decisions

- **Exhaustive over targeted (Approach 1 over Approach 4):** The user explicitly chose to review every file rather than rely on critical-path E2E + regression-on-bug + test-on-touch. Accepted cost: weeks of work, some on stable code. Accepted benefit: no shadow remains; every test in the suite has explicit standing.
- **Per-file `// Guards:` comments rather than an external registry:** The WHY for each test lives in the file itself, so it cannot drift independently of the test's assertions. Trades off central queryability for in-place truth.
- **Regression backfill happens inline per batch, not as a separate pass:** Each batch produces visible evidence (passing regression tests for already-shipped bugs in that area) that the audit is catching what it should. Trades off "audit then backfill" cleanliness for incremental ROI.
- **By-area batching, not alphabetical or random:** Each batch lands as its own commit/PR. Halts and redirects are cheap because the audit can stop after any batch without leaving the suite in a half-audited state.
- **Critical-path gaps are fixed inline; non-critical gaps are backlogged:** Otherwise the audit never terminates — every batch finds new gaps. The five named flows in R9 are the threshold; everything else queues.
- **In-flight test changes land first:** Starting the audit on the current dirty tree would conflate audit verdicts with in-progress work. One pre-audit commit clears the slate.
- **The five critical flows are named upfront (R9), not discovered:** Otherwise the `e2e/` batch becomes a debate about what's critical rather than an audit. The list can be revised, but it must exist before the E2E batch starts.

---

## Dependencies / Assumptions

- Assumes the existing testing stack (vitest for unit/integration, playwright for E2E, the `better-sqlite3` → `node:sqlite` shim per `project_better_sqlite3_binary_swap` memory) continues to work as the audit proceeds. If the shim or vitest config breaks during the audit, that becomes a blocker, not a side quest.
- Assumes recent fix commits in R7 can each be checked out cleanly enough to verify regressions fail on the parent — i.e., the codebase is git-bisectable across the audit window.
- Assumes the auditor has access to the original bug reports or PR descriptions for the R7 backfill list. Where context is missing, the audit relies on the fix commit's message and the surrounding code to infer the regression class, and notes the inference in the log.
- Assumes "the auditor" is the user, a future agent session, or both — the audit log and per-file `// Guards:` comments are the handoff surface that lets work pause and resume without losing state.
- Assumes a 6-month git-history backfill window for R7 is the right horizon. If the user prefers a shorter window (current quarter only) or a longer one (full project history), this is settled at the start of planning before R7 work begins.
- Assumes the audit is open-ended in calendar time, paced per batch. If a deadline exists (e.g., "done in 4 weeks"), planning sizes batches accordingly.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][User decision] Audit duration target — open-ended (default) vs. a calendar deadline. Affects whether the planner sizes batches for single-auditor sequential work or splits batches across parallel sessions/agents.
- [Affects R7][User decision] Regression backfill window — last 6 months (default), last quarter, or full project history. Affects which fix commits become backfill targets beyond the explicitly-listed minimums.
- [Affects R6][Technical] Audit log format — single growing markdown file (default), one file per batch, or structured (JSONL/CSV) for tooling. Planner decides based on whether any reporting beyond human reading is wanted.
- [Affects R3][Technical] Whether the in-flight working-tree changes can land as a single pre-audit commit or need to be split. The modified files (`database-service.test.ts`, `vitest.config.ts`, etc.) and the untracked dirs (`tests/helpers/`, `tests/services/`) may have different review needs. Settle during planning when the diffs are inspected directly.
- [Affects R10][Needs research] Which of the 14 existing E2E specs actually exercise real backends vs. mock-only paths — the audit reveals this per-file, but the planner can pre-scan to estimate `e2e/` batch size and whether real-backend hardening is realistic within the planner's chosen window.
