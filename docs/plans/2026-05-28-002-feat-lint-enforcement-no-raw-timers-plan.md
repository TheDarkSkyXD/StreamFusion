# Lint Enforcement — Ban Raw Timers (SP4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock SP1–SP3's "zero raw `setTimeout`/`setInterval` outside sanctioned helpers" via one Vitest test that auto-gates every PR build through CI's existing `npm test` step.

**Architecture:** A single Vitest test under `apps/desktop/tests/policy/` walks `apps/desktop/src/**/*.{ts,tsx}` and fails on any raw `setTimeout(`/`setInterval(` call that isn't (a) in a sanctioned file (file-path wholesale allowlist — the helpers, dev tooling, and the WIP-deferred Settings page) or (b) annotated with a `// timer-allowlist: <reason>` marker on the same or previous line. The test ships with fixture-based self-tests that verify the matcher itself. No new tooling, no biome/ESLint changes.

**Tech Stack:** TypeScript, Vitest (`node:fs` for file walking — env-agnostic).

**Spec:** [`docs/brainstorms/2026-05-28-lint-enforcement-no-raw-timers-requirements.md`](../brainstorms/2026-05-28-lint-enforcement-no-raw-timers-requirements.md)

> **Commands (use EXACTLY):**
> - Typecheck: `npm --prefix "apps/desktop" run typecheck` (from repo root)
> - Full suite: `npm --prefix "apps/desktop" test` (from repo root). Do NOT run `npx vitest`/`npm exec vitest` from the repo root — wrong vitest, no `@/` alias, false mass-failures.
> - Single test file: in your Bash tool, `cd "apps/desktop"` first, then `npx vitest run tests/policy/no-raw-timers.test.ts`.
> - Git from repo root. Stage ONLY this plan's files; unrelated WIP is in the tree; NEVER `git add -A`/`.`.

> **Baseline:** `main` is at `9937945` (SP3 merged + pushed). Full suite = 202 files / 1658 tests passing. Branch `policy/no-raw-timers` off `main` before starting.

> **Line numbers in Task 2's inventory are a 2026-05-28 snapshot — re-grep each site before editing.**

---

## File Structure

**Create (Task 1):**
- `apps/desktop/tests/policy/no-raw-timers.test.ts` — the lint test (self-tests + the real scan).

**Modify (Task 2):** add inline `// timer-allowlist: <reason>` markers in ~14 files (one comment per raw timer site; see inventory in Task 2).

---

## Task 1: Build the lint test (with fixture self-tests)

**Files:**
- Create: `apps/desktop/tests/policy/no-raw-timers.test.ts`

- [ ] **Step 1: Create the test file**

Create `apps/desktop/tests/policy/no-raw-timers.test.ts` with exactly this content:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.resolve(__dirname, "../../src");

/**
 * Files where every raw setTimeout/setInterval is sanctioned:
 *   - the sanctioned helper utilities themselves
 *   - dev-only tooling
 *   - the WIP-deferred Settings page (see DEFERRED note)
 *
 * Paths are relative to apps/desktop/src/, forward slashes.
 */
const SANCTIONED_FILES = new Set<string>([
  // sanctioned helpers (SP1/SP2/SP3) — these ARE the wrappers
  "lib/sleep.ts",
  "lib/managed-interval.ts",
  "hooks/useDebounce.ts",
  "hooks/useInterval.ts",
  "hooks/useTimeout.ts",
  "hooks/useManagedTimeout.ts",
  "backend/services/web-contents-ready.ts",
  // dev-only tooling (out of scope per SP2 O5)
  "components/dev/PerfTool.tsx",
  "components/dev/interval-tracker.ts",
  // DEFERRED until the user's WIP on this file lands; then tag the :380
  // auto-dismiss setTimeout with an inline `// timer-allowlist: <reason>`
  // marker (or migrate it to useTimeout from @/hooks/useTimeout, since
  // SP2's hook is now available) and remove this entry.
  "pages/Settings/index.tsx",
]);

const TIMER_CALL = /\b(setTimeout|setInterval)\s*\(/;
const ALLOW_MARKER = /\/\/\s*timer-allowlist\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function relSrc(file: string): string {
  return path.relative(SRC_DIR, file).split(path.sep).join("/");
}

interface Violation {
  file: string;
  line: number;
  source: string;
}

function findViolations(filePath: string, content: string): Violation[] {
  const rel = relSrc(filePath);
  const violations: Violation[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!TIMER_CALL.test(lines[i])) continue;
    const sameLine = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : "";
    if (ALLOW_MARKER.test(sameLine) || ALLOW_MARKER.test(prevLine)) continue;
    violations.push({ file: rel, line: i + 1, source: sameLine.trim() });
  }
  return violations;
}

describe("policy: no raw setTimeout/setInterval outside sanctioned helpers", () => {
  // --- Self-tests: verify the matcher itself with small fixtures (no file I/O). ---
  describe("findViolations (fixture-based self-tests)", () => {
    const FIXTURE_PATH = "/fake/src/a.ts";

    it("flags a raw setTimeout call with no marker", () => {
      const src = "setTimeout(() => doX(), 100);\n";
      expect(findViolations(FIXTURE_PATH, src)).toHaveLength(1);
    });

    it("accepts setTimeout with `// timer-allowlist: <reason>` on the same line", () => {
      const src = "setTimeout(() => doX(), 100); // timer-allowlist: reason\n";
      expect(findViolations(FIXTURE_PATH, src)).toHaveLength(0);
    });

    it("accepts setTimeout with `// timer-allowlist:` on the previous line", () => {
      const src = "// timer-allowlist: reason\nsetTimeout(() => doX(), 100);\n";
      expect(findViolations(FIXTURE_PATH, src)).toHaveLength(0);
    });

    it("ignores type references like `ReturnType<typeof setTimeout>`", () => {
      const src = "let t: ReturnType<typeof setTimeout> | null = null;\n";
      expect(findViolations(FIXTURE_PATH, src)).toHaveLength(0);
    });

    it("flags setInterval the same as setTimeout", () => {
      const src = "setInterval(() => tick(), 1000);\n";
      expect(findViolations(FIXTURE_PATH, src)).toHaveLength(1);
    });
  });

  // --- The actual enforcement: scan all of src/. Fails with a full list. ---
  it("src/ has no raw timer calls outside sanctioned files or allowlist markers", () => {
    const violations: Violation[] = [];
    for (const file of walk(SRC_DIR)) {
      const rel = relSrc(file);
      if (SANCTIONED_FILES.has(rel)) continue;
      const content = fs.readFileSync(file, "utf8");
      violations.push(...findViolations(file, content));
    }
    if (violations.length === 0) return;
    const message = [
      "Raw setTimeout/setInterval without `// timer-allowlist: <reason>`:",
      ...violations.map((v) => `  src/${v.file}:${v.line}: ${v.source}`),
      "",
      "Fix: route the timer through one of the sanctioned helpers:",
      "  - @/lib/sleep                 for async backoff (await sleep(ms))",
      "  - @/lib/managed-interval      for recurring backend intervals",
      "  - @/hooks/useInterval         for React recurring intervals",
      "  - @/hooks/useTimeout          for React declarative one-shots",
      "  - @/hooks/useManagedTimeout   for React imperative one-shots",
      "  - AbortSignal.timeout(ms)     for fetch deadlines",
      "OR if the raw timer is intentional, add a marker on the same or prior line:",
      "  // timer-allowlist: <reason>",
    ].join("\n");
    throw new Error(message);
  });
});
```

- [ ] **Step 2: Run it; capture the current violation list**

Run (from `apps/desktop/`): `npx vitest run tests/policy/no-raw-timers.test.ts`
Expected: 5 self-tests pass; the real-scan test FAILS with the full list of current violations. **Save that list** — it's the actual ground-truth inventory for Task 2 (line numbers may differ from the 2026-05-28 snapshot below).

- [ ] **Step 3: Do NOT commit yet**

Leave the test file uncommitted on disk. Task 2 adds the markers and commits both together so the suite never goes red between commits.

---

## Task 2: Tag every remaining exception + atomic commit

**Files:** add a `// timer-allowlist: <reason>` marker for each raw timer site listed below (or as reported by Task 1's actual scan if it differs). For each site, the marker can go on the **same line as the call** (suffix comment) OR on the **previous line** — pick whichever reads more cleanly per site. Reasons below are the suggested texts; adjust wording slightly if the actual code context warrants.

> Re-grep each site at execution time; line numbers are a 2026-05-28 snapshot. If a site listed below has already moved or no longer exists, skip it and report.

### Inventory (~20 sites across ~14 files)

#### WS keepalive watchdogs (restart-on-event timers reset by heartbeats/connect-events; restructure-cost > benefit per SP1/SP3)
- [ ] `apps/desktop/src/backend/services/chat/twitch-chat.ts:~179`
  Marker: `// timer-allowlist: IRC connection-timeout watchdog inside _doConnect connected-event waiter (SP1/SP3 out-of-scope)`
- [ ] `apps/desktop/src/backend/services/chat/twitch-hermes-client.ts:~151`
  Marker: `// timer-allowlist: pong watchdog reset on heartbeat (SP1/SP3 out-of-scope)`
- [ ] `apps/desktop/src/backend/api/platforms/twitch/twitch-eventsub-client.ts:~357`
  Marker: `// timer-allowlist: EventSub keepalive watchdog reset on message (SP1/SP3 out-of-scope)`
- [ ] `apps/desktop/src/backend/services/chat/kick-chat.ts:~291`
  Marker: `// timer-allowlist: Pusher connect deadline (SP1/SP3 out-of-scope)`
- [ ] `apps/desktop/src/backend/services/chat/kick-chat.ts:~317`
  Marker: `// timer-allowlist: Pusher connect deadline (SP1/SP3 out-of-scope)`

#### Promise.race nav/load timeouts (raw new Promise reject — not fetch abort guards; AbortSignal.timeout doesn't apply)
- [ ] `apps/desktop/src/backend/auth/oauth-callback-server.ts:~239`
  Marker: `// timer-allowlist: raw new Promise reject timeout for callback-server wait (no fetch/AbortSignal integration)`
- [ ] `apps/desktop/src/backend/api/platforms/kick/endpoints/channel-endpoints.ts:~331`
  Marker: `// timer-allowlist: Promise.race nav-timeout on win.loadURL (SP3 out-of-scope)`
- [ ] `apps/desktop/src/backend/api/platforms/kick/endpoints/chat-endpoints.ts:~91`
  Marker: `// timer-allowlist: Promise.race nav-timeout on win.loadURL (SP3 out-of-scope)`
- [ ] `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts:~275`
  Marker: `// timer-allowlist: Promise.race warm-visit nav-timeout (SP3 out-of-scope)`
- [ ] `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts:~336`
  Marker: `// timer-allowlist: Promise.race page-load nav-timeout (SP3 out-of-scope)`
- [ ] `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts:~472`
  Marker: `// timer-allowlist: Promise.race executeJavaScript timeout (SP3 out-of-scope)`

#### Cancellable helper (could be migrated to a future backend createManagedTimeout)
- [ ] `apps/desktop/src/backend/api/platforms/kick/endpoints/stream-endpoints.ts:~222`
  Marker: `// timer-allowlist: staggerDelay cancellable helper — needs a backend createManagedTimeout primitive (out of SP3 scope)`

#### Self-rescheduling chains / loops (variable cadence; restructure to while+sleep would be invasive)
- [ ] `apps/desktop/src/backend/auth/twitch-auth.ts:~186`
  Marker: `// timer-allowlist: self-rescheduling scheduleRefreshIn chain for proactive token refresh (SP3 out-of-scope)`
- [ ] `apps/desktop/src/components/chat/EmoteDialog.tsx:~667`
  Marker: `// timer-allowlist: self-rescheduling pump() prefetch loop (rIC fallback; SP2 out-of-scope)`
- [ ] `apps/desktop/src/components/chat/EmoteDialog.tsx:~671`
  Marker: `// timer-allowlist: self-rescheduling pump() prefetch loop (rIC fallback; SP2 out-of-scope)`
- [ ] `apps/desktop/src/components/player/hooks/use-video-lifecycle.ts:~197`
  Marker: `// timer-allowlist: self-rescheduling memory-pressure rIC+setTimeout loop (SP2 out-of-scope)`
- [ ] `apps/desktop/src/components/player/hooks/use-video-lifecycle.ts:~222`
  Marker: `// timer-allowlist: self-rescheduling memory-pressure rIC+setTimeout loop (SP2 out-of-scope)`
- [ ] `apps/desktop/src/components/player/hooks/use-video-lifecycle.ts:~232`
  Marker: `// timer-allowlist: self-rescheduling memory-pressure rIC+setTimeout loop (SP2 out-of-scope)`

#### Shutdown / UX one-shots
- [ ] `apps/desktop/src/backend/auth/auth-window.ts:155`
  Marker: `// timer-allowlist: 1.5s success-page dwell before closing OAuth window (deliberate UX pause)`
- [ ] `apps/desktop/src/backend/auth/auth-window.ts:~205`
  Marker: `// timer-allowlist: 100ms click poll inside executeJavaScript template (runs in page DOM, not Node)`
- [ ] `apps/desktop/src/backend/window-manager.ts:~169`
  Marker: `// timer-allowlist: force-quit grace if renderer unresponsive (shutdown deadline)`
- [ ] `apps/desktop/src/main.ts` — **search for `setTimeout(`/`setInterval(`**; if a force-quit deadline exists, add `// timer-allowlist: force-quit deadline (shutdown)`. If no raw timers exist here post-SP1/2/3, no action.

#### Non-React module-level cache eviction
- [ ] `apps/desktop/src/hooks/useStreamPlayback.ts:~126`
  Marker: `// timer-allowlist: TTL eviction in subscribePlayback (module-level, non-React; SP2 out-of-scope)`

### Steps

- [ ] **Step 1: Re-grep current state**

From repo root, search src for all raw timer call sites (informational):
```
git grep -n -E "\b(setTimeout|setInterval)\s*\(" -- apps/desktop/src
```
Cross-reference with the inventory above and with Task 1 Step 2's failure list. Note any drift (line numbers, missing/moved sites).

- [ ] **Step 2: Apply the markers**

For each inventory item above (and any extras revealed by Task 1's actual scan), add a `// timer-allowlist: <reason>` marker on the same or previous line as the call. Use the suggested marker text (lightly adapt wording per site if context warrants). Make NO other changes to those files — markers only.

- [ ] **Step 3: Re-run the lint test**

From `apps/desktop/`: `npx vitest run tests/policy/no-raw-timers.test.ts`
Expected: all tests pass (5 self-tests + 1 real-scan = 6 passed).

- [ ] **Step 4: Run typecheck and full suite**

From repo root:
```
npm --prefix "apps/desktop" run typecheck   # expect clean (no errors)
npm --prefix "apps/desktop" test            # expect 203 files / 1664 tests passing
```
(202 → 203 files: the new no-raw-timers.test.ts; 1658 → 1664 tests: 5 self-tests + 1 real-scan added.)

If the real-scan test still fails, the error message lists exact `file:line` for any missed sites — add markers there and re-run.

- [ ] **Step 5: Commit (single atomic commit covering Task 1 + Task 2)**

From repo root, stage ONLY the new test file + the touched source files (NEVER `git add -A`/`.` — unrelated WIP is in the tree):
```
git add apps/desktop/tests/policy/no-raw-timers.test.ts
git add <each modified source file from Step 2, listed explicitly>
git commit -m "feat(policy): add no-raw-timers lint test + tag SP1/2/3 deliberate exceptions"
```

For the `git add` list, enumerate the files explicitly (one per `git add` call or space-separated, never globbed). The set is the test file plus whichever files Step 2 actually modified (a subset of the inventory above).

---

## Final gate (after Task 2)
- `npm --prefix "apps/desktop" run typecheck` → clean.
- `npm --prefix "apps/desktop" test` → 203 files / 1664 tests passing.
- `git status --short` shows ONLY the user's pre-existing WIP files (the 6 modified + `settings-toast.ts` untracked) — nothing else.

The branch is then ready for the same finishing options as SP1/SP2/SP3 (merge to main + push, PR, or keep).

---

## Self-Review

**Spec coverage:**
- Spec § Mechanism → Task 1's `TIMER_CALL`/`ALLOW_MARKER` regexes, `findViolations`, sanctioned-file check, error report. ✓
- Spec § Wholesale-allowlist → `SANCTIONED_FILES` constant in Task 1 (9 sanctioned + Settings DEFERRED). ✓
- Spec § Per-line marker convention (`// timer-allowlist: <reason>`, same or prior line, reason required) → matcher checks both lines; Task 2 marker texts all include a reason. ✓
- Spec § Phase 0 (build test + fixture self-tests) → Task 1 with 5 self-tests (raw flagged, same-line marker, prev-line marker, type-ref ignored, setInterval flagged). ✓
- Spec § Phase 1 (tag ~20 sites) → Task 2 inventory with every site categorized (WS watchdogs / Promise.race / staggerDelay / self-rescheduling / shutdown / module-level) and a concrete marker text each. ✓
- Spec § Verification (self-tests + full suite + tsc + CI auto-gate) → Task 2 Steps 3-5 + the test runs as part of `npm test` (gated by `.github/workflows/build.yml`). ✓
- Spec § Risk R1 (regex false positives in strings/comments) → per-line markers; `auth-window.ts:~205`'s in-page click poll inside `executeJavaScript` template gets a marker. ✓
- Spec § R3 (Settings WIP deferral) → wholesale-allowlisted in `SANCTIONED_FILES` with an explicit DEFERRED comment. ✓
- Spec § R4 (`main.ts` may have no raw timers) → Task 2 inventory item explicitly says "search; if none, no action". ✓

**Placeholder scan:** Task 1 contains complete test code (no stubs). Task 2's inventory has concrete marker texts per site and an explicit "re-grep at execution time" caveat with Task 1 Step 2's actual scan as the authoritative ground truth. The `main.ts` "if present" hedge is bounded by a concrete grep instruction.

**Type/name consistency:** `TIMER_CALL`, `ALLOW_MARKER`, `SANCTIONED_FILES`, `findViolations`, `Violation`, `walk`, `relSrc` — defined in Task 1, not referenced elsewhere. Marker convention `// timer-allowlist: <reason>` is consistent between the matcher (Task 1) and every marker text (Task 2).
