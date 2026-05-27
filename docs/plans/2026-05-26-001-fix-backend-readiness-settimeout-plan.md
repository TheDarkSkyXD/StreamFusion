# Backend Readiness `setTimeout` Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three backend fixed-delay "wait for the page/connection to be ready" `setTimeout` guesses with waits on the real signal — a shared DOM-readiness poll helper for two Kick SPA-render waits, and a single-flight promise for the Twitch IRC concurrent-connect guard.

**Architecture:** A new stateless helper `waitForWebContentsCondition` polls a page's DOM (via `webContents.executeJavaScript`) for a readiness predicate until truthy or a timeout, resolving `false` on timeout so callers degrade to today's behavior. The two Kick fixes supply a page-context predicate and call it; the Twitch fix stores the in-flight connect attempt in a `connectingPromise` field so a concurrent `connect()` awaits it instead of guessing. Predicates are exported constants, unit-tested against fixture DOM in jsdom.

**Tech Stack:** TypeScript, Electron (main process), Vitest (jsdom env, default), tmi.js (Twitch IRC client).

**Spec:** [`docs/brainstorms/2026-05-26-backend-readiness-settimeout-fixes-requirements.md`](../brainstorms/2026-05-26-backend-readiness-settimeout-fixes-requirements.md)

> **Commands:** `npx vitest run …` and `npx tsc --noEmit` are run **from `apps/desktop/`** (the desktop workspace). `git` commands are run from the **repo root**. Per project memory, `tsc` + Vitest are the gates — **not** `biome` (baseline-red).

---

## File Structure

**Create:**
- `apps/desktop/src/backend/services/web-contents-ready.ts` — the `waitForWebContentsCondition` poll helper (one responsibility: poll a DOM predicate with a timeout). This is the single sanctioned poll timer; SP4's future lint rule must allowlist it.
- `apps/desktop/tests/backend/services/web-contents-ready.test.ts` — helper unit tests.
- `apps/desktop/tests/backend/api/platforms/kick/follow-grid-predicate.test.ts` — `GRID_READY_PREDICATE` DOM tests.
- `apps/desktop/tests/backend/auth/auth-header-predicate.test.ts` — `HEADER_RENDERED_PREDICATE` DOM tests.
- `apps/desktop/tests/backend/services/chat/twitch-chat.test.ts` — single-flight connect test (twitch-chat has no existing test file).

**Modify:**
- `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts` — add `GRID_READY_PREDICATE`; replace the 6 s wait at the `/following` scrape (~line 340).
- `apps/desktop/src/backend/auth/auth-window.ts` — add `HEADER_RENDERED_PREDICATE`; replace the 1.2 s wait in the kick.com `did-finish-load` handler (~line 186).
- `apps/desktop/src/backend/services/chat/twitch-chat.ts` — add `connectingPromise` field; rewrite the `connect()` concurrency guard (~line 117-136) and extract the attempt body into `_doConnect`.

> Line numbers are a 2026-05-26 snapshot — confirm before editing.

---

## Task 1: `waitForWebContentsCondition` helper

**Files:**
- Create: `apps/desktop/src/backend/services/web-contents-ready.ts`
- Test: `apps/desktop/tests/backend/services/web-contents-ready.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/backend/services/web-contents-ready.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

import { waitForWebContentsCondition } from "../../../../src/backend/services/web-contents-ready";

function fakeWebContents(opts: {
  executeJavaScript: (code: string) => Promise<unknown>;
  isDestroyed?: () => boolean;
}) {
  return {
    executeJavaScript: vi.fn(opts.executeJavaScript),
    isDestroyed: vi.fn(opts.isDestroyed ?? (() => false)),
  };
}

describe("waitForWebContentsCondition", () => {
  it("resolves true as soon as the predicate is truthy", async () => {
    let calls = 0;
    const wc = fakeWebContents({
      executeJavaScript: async () => {
        calls += 1;
        return calls >= 3; // false, false, true
      },
    });
    const ready = await waitForWebContentsCondition(wc, "PRED", { timeoutMs: 1000, intervalMs: 5 });
    expect(ready).toBe(true);
    expect(wc.executeJavaScript).toHaveBeenCalledWith("PRED");
  });

  it("resolves false when the predicate never becomes truthy before the timeout", async () => {
    const wc = fakeWebContents({ executeJavaScript: async () => false });
    const ready = await waitForWebContentsCondition(wc, "PRED", { timeoutMs: 40, intervalMs: 5 });
    expect(ready).toBe(false);
  });

  it("stops and resolves false if the webContents is destroyed mid-poll", async () => {
    let aliveChecks = 0;
    const wc = fakeWebContents({
      executeJavaScript: async () => false,
      isDestroyed: () => {
        aliveChecks += 1;
        return aliveChecks >= 2; // alive on first check, destroyed on second
      },
    });
    const ready = await waitForWebContentsCondition(wc, "PRED", { timeoutMs: 1000, intervalMs: 5 });
    expect(ready).toBe(false);
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(1); // no poll after destroy
  });

  it("swallows executeJavaScript rejections and keeps polling", async () => {
    let calls = 0;
    const wc = fakeWebContents({
      executeJavaScript: async () => {
        calls += 1;
        if (calls < 3) throw new Error("Cloudflare challenge");
        return true;
      },
    });
    const ready = await waitForWebContentsCondition(wc, "PRED", { timeoutMs: 1000, intervalMs: 5 });
    expect(ready).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/desktop/`): `npx vitest run tests/backend/services/web-contents-ready.test.ts`
Expected: FAIL — `Failed to resolve import "../../../../src/backend/services/web-contents-ready"` (module does not exist yet).

- [ ] **Step 3: Write the helper**

Create `apps/desktop/src/backend/services/web-contents-ready.ts`:

```ts
/**
 * Poll a page's DOM for a readiness condition instead of guessing a fixed delay.
 *
 * Evaluates `predicateExpression` in the page every `intervalMs` until it returns
 * truthy (resolve `true`) or `timeoutMs` elapses (resolve `false`). Resolving
 * `false` on timeout — rather than throwing — is deliberate: callers proceed with
 * "whatever rendered," so a stale/incorrect predicate degrades to the previous
 * fixed-delay behavior instead of becoming a hard error.
 *
 * Used for third-party SPA pages (kick.com) where no first-party "render complete"
 * event exists to await: `did-finish-load` / `dom-ready` fire before the SPA
 * renders the content we need.
 *
 * NOTE: the internal `setTimeout` is the single sanctioned poll timer — there is
 * no async/await equivalent for "poll later in wall-clock time". SP4's lint rule
 * must allowlist this file.
 */

/** Minimal slice of Electron.WebContents this helper needs (electron-free, easily faked in tests). */
interface PollableWebContents {
  executeJavaScript(code: string): Promise<unknown>;
  isDestroyed(): boolean;
}

export async function waitForWebContentsCondition(
  webContents: PollableWebContents,
  predicateExpression: string,
  options: { timeoutMs: number; intervalMs?: number },
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? 150;
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    if (webContents.isDestroyed()) return false;
    try {
      const result = await webContents.executeJavaScript(predicateExpression);
      if (result) return true;
    } catch {
      // Per-poll failure (Cloudflare challenge, mid-poll navigation) — treat as
      // "not ready yet" and keep polling until the deadline.
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/desktop/`): `npx vitest run tests/backend/services/web-contents-ready.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/backend/services/web-contents-ready.ts apps/desktop/tests/backend/services/web-contents-ready.test.ts
git commit -m "feat(backend): add waitForWebContentsCondition DOM-readiness poll helper"
```

---

## Task 2: Kick follows-grid — poll instead of fixed 6 s wait

**Files:**
- Modify: `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts` (add predicate near line 31; replace wait near line 340; add import near line 29)
- Test: `apps/desktop/tests/backend/api/platforms/kick/follow-grid-predicate.test.ts`

- [ ] **Step 1: Add and export `GRID_READY_PREDICATE`**

In `follow-endpoints.ts`, after the existing constants block (after `const FETCH_TIMEOUT_MS = 10000;`, ~line 32), add:

```ts
/**
 * Readiness predicate (page-context JS) for the /following/channels scrape:
 * true once the "Followed Channels" heading exists AND its container holds at
 * least one channel anchor with an avatar image. Mirrors the scoping logic of
 * the scrape itself. Exported for unit testing against fixture DOM.
 */
export const GRID_READY_PREDICATE = `(() => {
  for (const h of document.querySelectorAll('h2, h3, [role="heading"]')) {
    if (/followed channel|channels you follow|following channels/i.test((h.textContent || '').trim())) {
      let p = h.parentElement;
      for (let i = 0; i < 6 && p; i++) {
        if (p.querySelectorAll('a[href] img').length >= 1) return true;
        p = p.parentElement;
      }
    }
  }
  return false;
})()`;
```

- [ ] **Step 2: Write the failing predicate test**

Create `apps/desktop/tests/backend/api/platforms/kick/follow-grid-predicate.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { GRID_READY_PREDICATE } from "../../../../../src/backend/api/platforms/kick/endpoints/follow-endpoints";

// The predicate string is the exact JS executed in the page; run it against
// fixture DOM in jsdom (the default Vitest environment for this repo).
function evaluate(predicate: string): boolean {
  return new Function(`return ${predicate}`)() as boolean;
}

describe("GRID_READY_PREDICATE", () => {
  it("is true once the followed-channels grid has rendered at least one card", () => {
    document.body.innerHTML = `
      <section>
        <h2>Followed Channels</h2>
        <div>
          <a href="/streamerone"><img alt="StreamerOne" src="/a.png" /></a>
          <a href="/streamertwo"><img alt="StreamerTwo" src="/b.png" /></a>
        </div>
      </section>`;
    expect(evaluate(GRID_READY_PREDICATE)).toBe(true);
  });

  it("is false before the grid has rendered (heading present, no cards yet)", () => {
    document.body.innerHTML = `
      <section>
        <h2>Followed Channels</h2>
        <div><span>Loading…</span></div>
      </section>`;
    expect(evaluate(GRID_READY_PREDICATE)).toBe(false);
  });

  it("is false on a bare page with no following heading", () => {
    document.body.innerHTML = `<main><div class="spinner"></div></main>`;
    expect(evaluate(GRID_READY_PREDICATE)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run (from `apps/desktop/`): `npx vitest run tests/backend/api/platforms/kick/follow-grid-predicate.test.ts`
Expected: PASS — 3 passed. (The const exists from Step 1, so this goes green immediately; it is the executable spec for the predicate logic and guards future edits to it.)

- [ ] **Step 4: Wire the helper into the scrape flow**

In `follow-endpoints.ts`, add the import alongside the existing internal imports (after line 29, `import { acquireBrowserWindowSlot } from "./channel-endpoints";`):

```ts
import { waitForWebContentsCondition } from "../../../../services/web-contents-ready";
```

Then replace this block (~lines 334-340):

```ts
    // Give the SPA time to fetch + render the follows grid. Kick's SPA does
    // its own auth-aware API call here; we just wait for it to populate the
    // DOM. 6s is conservative; if performance allows, tighten later.
    console.debug(
      "[KickFollows] BrowserWindow fallback: waiting 6s for /following SPA render"
    );
    await new Promise((resolve) => setTimeout(resolve, 6000));
```

with:

```ts
    // Wait for the SPA to render the follows grid rather than guessing a fixed
    // delay. Resolves as soon as the grid is present (typically < 6s); a slow
    // render is covered up to the 8s cap; a zero-follow account never populates
    // the grid, so the poll hits the cap and the scrape below returns empty
    // (same outcome as the old flat wait). Return value intentionally ignored —
    // the scrape runs either way.
    console.debug(
      "[KickFollows] BrowserWindow fallback: waiting for /following grid to render"
    );
    await waitForWebContentsCondition(win.webContents, GRID_READY_PREDICATE, {
      timeoutMs: 8000,
    });
```

- [ ] **Step 5: Typecheck**

Run (from `apps/desktop/`): `npx tsc --noEmit`
Expected: no errors (the helper import resolves, `win.webContents` satisfies `PollableWebContents`).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts apps/desktop/tests/backend/api/platforms/kick/follow-grid-predicate.test.ts
git commit -m "fix(kick): poll for follows grid instead of fixed 6s wait before scrape"
```

---

## Task 3: kick.com auth header — poll instead of fixed 1.2 s wait

**Files:**
- Modify: `apps/desktop/src/backend/auth/auth-window.ts` (add predicate near line 19; add import; replace wait near line 186)
- Test: `apps/desktop/tests/backend/auth/auth-header-predicate.test.ts`

- [ ] **Step 1: Add and export `HEADER_RENDERED_PREDICATE`**

In `auth-window.ts`, after the import block and before `// ========== Types ==========` (~line 19-21), add:

```ts
/**
 * Readiness predicate (page-context JS) for kick.com's header: true once EITHER
 * auth state's markers have rendered — a Sign In/Up button (anonymous) OR an
 * avatar/user-menu element (logged in). Either proves the SPA header finished
 * rendering, so the subsequent `_isKickWebAuthenticated` check runs against real
 * DOM rather than a half-rendered page. Markers mirror `_isKickWebAuthenticated`;
 * keep them in sync. Exported for unit testing against fixture DOM.
 */
export const HEADER_RENDERED_PREDICATE = `(() => {
  const els = Array.from(document.querySelectorAll('button, a'));
  const hasAuthButton = els.some((el) => /^\\s*(Sign\\s*In|Log\\s*In|Sign\\s*Up)\\s*$/i.test((el.textContent || '').trim()));
  const hasAvatar =
    !!document.querySelector('img[alt][src*="profile"]') ||
    !!document.querySelector('img[alt][src*="default-avatar"]') ||
    !!document.querySelector('button[aria-haspopup="menu"]') ||
    !!document.querySelector('[data-testid*="user"]');
  return hasAuthButton || hasAvatar;
})()`;
```

- [ ] **Step 2: Write the failing predicate test**

Create `apps/desktop/tests/backend/auth/auth-header-predicate.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { HEADER_RENDERED_PREDICATE } from "../../../src/backend/auth/auth-window";

function evaluate(predicate: string): boolean {
  return new Function(`return ${predicate}`)() as boolean;
}

describe("HEADER_RENDERED_PREDICATE", () => {
  it("is true when the anonymous header (Sign In button) has rendered", () => {
    document.body.innerHTML = `<header><button>Sign In</button></header>`;
    expect(evaluate(HEADER_RENDERED_PREDICATE)).toBe(true);
  });

  it("is true when the logged-in header (avatar / user menu) has rendered", () => {
    document.body.innerHTML = `<header><button aria-haspopup="menu"><img alt="me" src="/x.png" /></button></header>`;
    expect(evaluate(HEADER_RENDERED_PREDICATE)).toBe(true);
  });

  it("is false before the header has rendered", () => {
    document.body.innerHTML = `<div id="app"></div>`;
    expect(evaluate(HEADER_RENDERED_PREDICATE)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run (from `apps/desktop/`): `npx vitest run tests/backend/auth/auth-header-predicate.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 4: Wire the helper into the auth flow**

In `auth-window.ts`, add the import after the `oauth-config` import block (after the closing `} from "./oauth-config";`, ~line 19):

```ts
import { waitForWebContentsCondition } from "../services/web-contents-ready";
```

Then replace this block (~lines 184-187, inside the kick.com `did-finish-load` handler):

```ts
        // Give the SPA ~1.2s to bootstrap and render the header (logged-in
        // users see avatar; anonymous users see Sign In button).
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (window.isDestroyed()) return;
```

with:

```ts
        // Wait for the header to actually render (avatar for logged-in users,
        // Sign In button for anonymous) instead of guessing ~1.2s, so the auth
        // check below runs against real DOM. On a slow machine the old fixed
        // wait could fire pre-render, fail-close to "not authed", and needlessly
        // re-prompt an already-signed-in user. Return value ignored — the auth
        // check runs either way.
        await waitForWebContentsCondition(window.webContents, HEADER_RENDERED_PREDICATE, {
          timeoutMs: 4000,
        });
        if (window.isDestroyed()) return;
```

- [ ] **Step 5: Typecheck**

Run (from `apps/desktop/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/backend/auth/auth-window.ts apps/desktop/tests/backend/auth/auth-header-predicate.test.ts
git commit -m "fix(auth): poll for kick.com header render instead of fixed 1.2s wait"
```

---

## Task 4: Twitch IRC — single-flight concurrent connect

**Files:**
- Modify: `apps/desktop/src/backend/services/chat/twitch-chat.ts` (add field ~line 90; rewrite `connect()` guard + extract `_doConnect`, ~lines 107-136)
- Test: `apps/desktop/tests/backend/services/chat/twitch-chat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/backend/services/chat/twitch-chat.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

// vi.mock is hoisted above imports, so the client constructor it references must
// be created via vi.hoisted (same pattern as follow-endpoints.test.ts).
const { ClientCtor } = vi.hoisted(() => ({ ClientCtor: vi.fn() }));
vi.mock("tmi.js", () => ({ default: { Client: ClientCtor } }));

import { TwitchChatService } from "../../../../src/backend/services/chat/twitch-chat";

// A controllable stand-in for tmi.js's Client. connect() resolves immediately;
// the service treats the "connected" EVENT (not connect()'s resolution) as
// success, so the test drives completion by emitting "connected".
let fakeClient: EventEmitter & { connect: ReturnType<typeof vi.fn> };

describe("TwitchChatService connect() single-flight", () => {
  beforeEach(() => {
    fakeClient = Object.assign(new EventEmitter(), {
      connect: vi.fn(() => Promise.resolve(["irc-ws.chat.twitch.tv", 443])),
    });
    ClientCtor.mockReset();
    ClientCtor.mockImplementation(() => fakeClient);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a concurrent second connect() rides the in-flight attempt instead of building a competing client", async () => {
    vi.useFakeTimers();
    const service = new TwitchChatService();

    // Two near-simultaneous connects (e.g. React StrictMode double-mount).
    const p1 = service.connect({ anonymous: true });
    const p2 = service.connect({ anonymous: true });

    // Let any "wait 100ms then take over" window elapse *before* the first
    // attempt has connected. The old code superseded here and built a 2nd
    // client; single-flight keeps awaiting the one in-flight attempt.
    await vi.advanceTimersByTimeAsync(100);
    expect(ClientCtor).toHaveBeenCalledTimes(1);
    expect(fakeClient.connect).toHaveBeenCalledTimes(1);

    // Complete the in-flight attempt; both callers settle on it.
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([p1, p2]);

    expect(ClientCtor).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/desktop/`): `npx vitest run tests/backend/services/chat/twitch-chat.test.ts`
Expected: FAIL — `expect(ClientCtor).toHaveBeenCalledTimes(1)` receives `2`. On the current code the second `connect()` waits 100 ms, sees "not connected yet", supersedes, and builds a second client.

- [ ] **Step 3a: Add the `connectingPromise` field**

In `twitch-chat.ts`, in the "Connection tracking" field block (~lines 87-89), after `private currentConnectionId = 0;`, add:

```ts
  // Single-flight: a concurrent connect() awaits the in-flight attempt instead
  // of racing a second one. Mirrors the `_inFlight` pattern in follow-endpoints.
  private connectingPromise: Promise<void> | null = null;
```

- [ ] **Step 3b: Rewrite the connect guard and extract `_doConnect`**

Replace lines 107-136 — from `async connect(options: TwitchChatOptions = {}): Promise<void> {` through `this.isConnecting = true;` (the line right after `const connectionId = ++this.currentConnectionId;`) — with the following. **Everything from line 138 onward (`this.debugMode = options.debug ?? false;` through the method's closing `}` at ~line 249) stays exactly as-is; it simply becomes the body of `_doConnect`.**

```ts
  async connect(options: TwitchChatOptions = {}): Promise<void> {
    // Mark service as active - allows connections and reconnections
    this.isActive = true;

    // If already connected, just return
    if (this.client && this.connectionState === "connected") {
      this.log("Already connected");
      return;
    }

    // If a connection attempt is already in flight, ride it rather than guessing
    // a delay or racing a second attempt. A failed in-flight attempt (.catch)
    // falls through to a fresh connect below.
    if (this.connectingPromise) {
      this.log("Connection already in progress, awaiting it...");
      await this.connectingPromise.catch(() => {});
      if (this.connectionState === "connected") {
        this.log("Connection completed while waiting");
        return;
      }
    }

    // Check if service was deactivated while waiting
    if (!this.isActive) {
      this.log("Service deactivated, aborting connection");
      return;
    }

    const attempt = this._doConnect(options);
    this.connectingPromise = attempt;
    try {
      await attempt;
    } finally {
      // Only clear if a newer attempt hasn't replaced this one.
      if (this.connectingPromise === attempt) this.connectingPromise = null;
    }
  }

  /**
   * Run a single Twitch IRC connection attempt. Wrapped by `connect()` so that
   * concurrent callers share one in-flight attempt (see `connectingPromise`).
   */
  private async _doConnect(options: TwitchChatOptions): Promise<void> {
    // Generate a unique connection ID for this attempt
    const connectionId = ++this.currentConnectionId;
    this.isConnecting = true;
```

(The existing `this.debugMode = …` line and the rest of the original method body now follow, unchanged, as the remainder of `_doConnect`. The original method-closing `}` becomes `_doConnect`'s closing brace.)

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/desktop/`): `npx vitest run tests/backend/services/chat/twitch-chat.test.ts`
Expected: PASS — 1 passed.

- [ ] **Step 5: Typecheck**

Run (from `apps/desktop/`): `npx tsc --noEmit`
Expected: no errors. (`isConnecting` is still read by `disconnect()` and the `finally` inside `_doConnect`; it is unchanged.)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/backend/services/chat/twitch-chat.ts apps/desktop/tests/backend/services/chat/twitch-chat.test.ts
git commit -m "fix(chat): de-dupe concurrent Twitch IRC connects via single-flight promise"
```

---

## Task 5: Full-suite gate + live manual verification

**Files:** none (verification only). This task covers spec Verification §2 (full suite) and §3 (live manual checks — the unavoidable part, since R2/R3/R4 touch live third-party sites / real IRC).

- [ ] **Step 1: Run the full test suite + typecheck**

Run (from `apps/desktop/`): `npx vitest run` then `npx tsc --noEmit`
Expected: all tests pass (including the 4 new files); no type errors. If unrelated pre-existing tests fail, confirm they failed before this branch (do not attempt to fix them here).

- [ ] **Step 2: Live-verify R2 (Kick follows import)**

Run the app (`npm run dev` from `apps/desktop/`). With a Kick account **that follows channels**, trigger a follows import and confirm the same channels import as before, and noticeably faster than a flat 6 s. Then with a **zero-follow** account, confirm the import completes and returns an empty list (no error, no hang beyond the 8 s cap).

- [ ] **Step 3: Live-verify R3 (Kick OAuth header)**

Open the Kick sign-in flow while **already signed into kick.com in the app session** — confirm it proceeds straight to `id.kick.com` OAuth without re-prompting Sign In. Then signed **out**, confirm it still auto-clicks Sign In and reaches the login modal.

- [ ] **Step 4: Live-verify R4 (Twitch chat connect)**

In dev (React StrictMode double-mounts), open a Twitch chat and confirm a single IRC connection establishes (watch the debug logs for one connect, no "superseded" churn). Mount/unmount quickly and confirm `disconnect()` mid-connect still tears down cleanly.

- [ ] **Step 5: Finalize**

If all manual checks pass, the branch is ready. Use superpowers:finishing-a-development-branch to decide merge/PR. If a manual check reveals a wrong predicate (R2/R3), the helper's timeout-→-fallback bounds it to the old behavior — adjust the predicate constant and re-run its unit test.

---

## Self-Review

**Spec coverage:**
- Spec R1 (helper) → Task 1. ✓
- Spec R2 (follow-endpoints:340) → Task 2. ✓
- Spec R3 (auth-window:186) → Task 3. ✓
- Spec R4 (twitch-chat:121 single-flight) → Task 4. ✓
- Spec Verification §1 (helper unit tests) → Task 1 Steps 1-4. ✓
- Spec Verification §2 (tsc + full suite) → Tasks 2-4 typecheck steps + Task 5 Step 1. ✓
- Spec Verification §3 (live manual) → Task 5 Steps 2-4. ✓
- Spec B1/B2/B3 behaviors → exercised by Task 5 Steps 2/3/4 respectively. ✓
- Out-of-scope sites (auth-window:155/205/310, follow-endpoints:267) → untouched by every task. ✓

**Type/name consistency:** `waitForWebContentsCondition(webContents, predicateExpression, { timeoutMs, intervalMs? }): Promise<boolean>` — identical signature in Task 1 (def), Task 2 (call), Task 3 (call). `GRID_READY_PREDICATE` / `HEADER_RENDERED_PREDICATE` const names consistent between their defining task and test. `connectingPromise` / `_doConnect` consistent within Task 4. Import paths: `../../../../services/web-contents-ready` (from kick/endpoints), `../services/web-contents-ready` (from auth) — both resolve to `backend/services/web-contents-ready`.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command + expected result. The one deferred item (Kick empty-state short-circuit) is explicitly scoped out in the spec and not a task here.
