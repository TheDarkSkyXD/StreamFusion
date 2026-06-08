# Test-suite audit gaps backlog — 2026-05-19

Non-critical-path test coverage gaps and source bugs discovered during the [test-suite audit](../plans/2026-05-19-001-refactor-test-suite-audit-plan.md). Converted to GitHub issues + this file deleted at U19.

## Backlog overview

- **Source:** appended chronologically as gaps are discovered per batch.
- **Routing:** critical-path gaps are fixed inline per batch (per plan R11); only non-critical-path gaps land here.
- **Lifecycle:** at U19, every entry is converted to a GitHub issue with label `test-audit-gap` (or `bug` for source-code findings), then this file is deleted.

---

## Entries

### ~~Kick image-fetch dynamic-require failure~~ — RESOLVED 2026-05-20

> Originally filed 2026-05-19 (U0 smoke). Resolved 2026-05-20: dynamic `require("../../../services/third-party-cookie-stripper")` in `apps/desktop/src/backend/api/platforms/kick/kick-client.ts:242` was replaced with a static `import` at module top. Same root cause as the `electron.net.request` runtime require in `stream-endpoints.ts` (which got the same treatment as part of the fan-out regression backfill). The CDN-session cookie-stripper is now wired correctly on every Kick image fetch, eliminating the `Cannot find module` log spam and restoring the cookie-strip on Kick image responses.

### ~~Kick fan-out / public-stream-cache 4-part contract~~ — RESOLVED 2026-05-20

> Originally filed 2026-05-20 (U7). Resolved 2026-05-20: regression test landed at `apps/desktop/tests/backend/api/platforms/kick/stream-endpoints.test.ts` with 3 of 4 contracts as live assertions:
>
> - **Contract 1** (positive-cache TTL > poll interval) — covered.
> - **Contract 2** (stagger after cache check) — covered.
> - **Contract 3** (AbortController scoped per dispatch) — covered.
> - **Contract 4** (transient timeout doesn't preempt fresh positive cache) — documented in-file as not unit-testable at this integration layer (the guard only fires in an in-flight race the test can't stage without exposing module-private cache maps as test seams). The guard is named in the file-level `// Guards:` comment so a future maintainer trying to delete it triggers reviewer attention.
>
> Source-diff-revert verification of contracts 1 + 2: temporarily neutered the positive-cache block in `stream-endpoints.ts` (lines 306-317); both tests failed as expected. Restored, both pass. Contract 3 was independently verified (passes with the cache block intact, hits the abort path before reaching it).
>
> A small companion source change landed alongside: `stream-endpoints.ts` switched from dynamic `require("electron")` inside `_doFetchPublicStreamBySlug` to a static `import { net } from "electron"` at module top. The dynamic require pattern wasn't necessary (backend-only file) and prevented `vi.mock("electron")` from intercepting — same root cause as the kick-client image-fetch resolution above, fixed the same way.

---

### Flaky parallel-execution race in `bug-report-handlers.test.ts` — 2026-06-08 (U20.c)

> Discovered during U20.c backend sweep. `tests/backend/ipc/handlers/bug-report-handlers.test.ts` reported "1 failed" during one of several parallel vitest runs (6,117 ms wall) but passes deterministically in isolation (237 ms tests / 2.47 s total wall). Pre-existing — not introduced by U20.c.
>
> **Hypothesis:** shared global state (likely `ipcMain.handle` registration, file-system path, or environment variable) leaks across files when worker threads run concurrently with neighboring backend tests.
>
> **Out of U20 scope** because (a) reproducing requires a specific parallel-execution ordering that the in-isolation run does not surface, and (b) the symptom is in pre-existing test infrastructure, not in any code U20 touched. The U20 final full-suite run is the authoritative green/red signal for U20.

---

<!-- Append more entries per batch as gaps are discovered. -->
