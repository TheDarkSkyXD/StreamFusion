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

<!-- Append more entries per batch as gaps are discovered. -->
