---
date: 2026-05-26
topic: backend-readiness-settimeout-fixes
status: ready for plan
---

# Backend Readiness `setTimeout` Fixes — Await the Render, Don't Guess It

## Summary

Three backend (`main`-process) `setTimeout` call sites use a *guessed* delay to wait for
something that is actually observable — a third-party SPA finishing its render, or an
in-flight connection completing. Replace each with a wait on the real signal:

- a shared **`waitForWebContentsCondition`** poll for the two SPA-render waits (the Kick
  follows grid; the kick.com auth header), and
- a stored **single-flight promise** for the Twitch IRC concurrent-connect guard.

Of the 8 backend timers a sweep flagged as suspicious, only these 3 are genuine
anti-patterns. The rest are legitimate elapsed-time timers (backoff, heartbeat,
rate-limit, polling, abort-after-N) — and one (`auth-window.ts:155`) is a deliberate UX
dwell the sweep miscategorized. They all stay. No user-visible behavior changes **except**
one deliberate improvement to Twitch IRC connect de-duplication (B3).

> This is **SP1** of a 4-part timer-hygiene program. SP2 = frontend timer-hygiene
> migration; SP3 = backend backoff/heartbeat/guard quarantine; SP4 = lint enforcement.
> It is the backend analogue of the shipped UI render-wait fixes
> ([`2026-05-24-ui-settimeout-render-wait-fixes`](./2026-05-24-ui-settimeout-render-wait-fixes-requirements.md)).

> Line numbers below are a 2026-05-26 snapshot — verify before editing.

---

## Problem Frame

A `setTimeout(fn, n)` whose purpose is "wait until X has happened" is a latent bug: if the
machine is slow, `n` is too short and the code runs before X; if fast, it wastes `n` ms.
The fix is to wait on X directly.

The wrinkle for the backend cases: two of them wait on **third-party SPA pages we do not
control** (`kick.com`). There is no first-party promise or render-complete event to await —
Electron's `did-finish-load` / `dom-ready` fire when the HTML loads, **before** the SPA
hydrates and renders the content we need (the follows grid; the logged-in/anonymous
header). So the robust equivalent of "await the real signal" is to **poll the rendered DOM
for the actual readiness condition, with a timeout** — still timer-based under the hood,
but conditioned on real state instead of a fixed guess. The Twitch case is different: a real
in-flight `Promise` already exists (the IRC `connect()` work), so it can be awaited directly.

The shared goal is *deterministic sequencing*, not a uniform syntax — the same principle as
the sibling UI spec.

---

## Affected Behaviors

- **B1.** Kick follow-import (`getAllFollowedChannels` → `_fetchViaBrowserWindow`) returns
  the same channel list it does today, but as soon as the follows grid has rendered
  (typically **faster** than the current flat 6 s) rather than always after 6 s. A slow
  render still resolves correctly up to the cap; an account following **zero** channels
  still returns an empty `{ status: "ok" }`.
- **B2.** The Kick OAuth flow's "is the user already signed into kick.com?" decision is made
  **after** the kick.com header has actually rendered. An already-logged-in user is no
  longer re-prompted to sign in on a slow machine (a latent fail-closed bug today).
- **B3.** *(Intended change.)* A second concurrent `TwitchChatService.connect()` arriving
  while one is in flight now rides the in-flight attempt's **real outcome** instead of
  waiting a fixed 100 ms and then superseding it. React StrictMode's double-mount no longer
  abandons a perfectly good in-flight socket to start a competing one.

---

## Requirements

### R1 — New `waitForWebContentsCondition` helper

New pure util: `apps/desktop/src/backend/services/web-contents-ready.ts` (co-located with
`http-client.ts` and the other backend services; no `-service` suffix — it is stateless).

```ts
export async function waitForWebContentsCondition(
  webContents: Electron.WebContents,
  predicateExpression: string,            // JS evaluated in the page; truthy = ready
  options: { timeoutMs: number; intervalMs?: number }, // intervalMs default 150
): Promise<boolean>;                        // true = condition met; false = timed out
```

Behavior:
- Poll `webContents.executeJavaScript(predicateExpression)` every `intervalMs`. Resolve
  `true` on the first truthy result.
- On reaching `timeoutMs`, resolve **`false`** (do **not** reject). Rationale: every caller
  proceeds with "whatever rendered" on timeout, so a wrong/stale predicate degrades to
  today's behavior and can never be slower-to-fail or turn an edge case into a thrown error.
- Cancel-safe: stop and resolve `false` if `webContents.isDestroyed()`; always clear the
  interval/timeout on resolve.
- Swallow per-poll `executeJavaScript` rejections (Cloudflare challenge, mid-poll
  navigation) as "not ready yet" and keep polling until the cap — matching the existing
  fail-closed convention in `auth-window.ts`.

**Acceptance:** unit-tested (see Verification) and `tsc` passes.

### R2 — `follow-endpoints.ts`: poll for the grid, then scrape (1 site)
`apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts:340`

In `_fetchViaBrowserWindow`, replace:

```ts
await new Promise((resolve) => setTimeout(resolve, 6000));
```

with a readiness poll, then the existing scrape:

```ts
await waitForWebContentsCondition(win.webContents, GRID_READY_PREDICATE, { timeoutMs: 8000 });
```

`GRID_READY_PREDICATE` is the lightweight readiness check derived from the existing scrape
JS — the "Followed Channels" heading exists **and** its container holds ≥ 1 anchor with an
`<img>`. Illustrative (confirm against live DOM during implementation):

```js
(() => {
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
})()
```

- The boolean result is intentionally **not** branched on — the scrape runs either way; a
  `false`/timeout simply means "scrape whatever rendered."
- Cap is **8000 ms** (≥ today's 6 s) so a slow render never regresses.
- **Zero-follow edge case:** the grid never populates → poll hits the cap → the existing
  scrape runs and returns empty `ok` (same outcome as today, just after the cap). A
  short-circuit on Kick's empty-state markup is a *later* refinement, not part of SP1 —
  noted because it can only be authored against the live empty-state DOM.

**Acceptance:** B1 verified (logged-in account with follows; zero-follow account); `tsc`.

### R3 — `auth-window.ts`: poll for the header, then the auth check (1 site)
`apps/desktop/src/backend/auth/auth-window.ts:186` (inside the kick.com `did-finish-load` handler)

Replace:

```ts
await new Promise((resolve) => setTimeout(resolve, 1200));
```

with:

```ts
await waitForWebContentsCondition(window.webContents, HEADER_RENDERED_PREDICATE, { timeoutMs: 4000 });
```

then the **unchanged** `_isKickWebAuthenticated(window)` call and its existing branch.
`HEADER_RENDERED_PREDICATE` returns true once **either** auth state's markers have rendered
(so it proves the header finished, regardless of authed/anonymous):

```js
(() => {
  const els = Array.from(document.querySelectorAll('button, a'));
  const hasAuthButton = els.some((el) => /^\s*(Sign\s*In|Log\s*In|Sign\s*Up)\s*$/i.test((el.textContent || '').trim()));
  const hasAvatar =
    !!document.querySelector('img[alt][src*="profile"]') ||
    !!document.querySelector('img[alt][src*="default-avatar"]') ||
    !!document.querySelector('button[aria-haspopup="menu"]') ||
    !!document.querySelector('[data-testid*="user"]');
  return hasAuthButton || hasAvatar;
})()
```

- The avatar/sign-in markers intentionally mirror those already inside
  `_isKickWebAuthenticated`, so the predicate and the auth check stay in sync. Keep both
  blocks consistent if Kick's selectors are updated.
- As in R2, the boolean result is not branched on — `_isKickWebAuthenticated` runs either way.

**Acceptance:** B2 verified (already-signed-in kick.com session proceeds straight to OAuth;
anonymous session still auto-clicks Sign In); `tsc`.

### R4 — `twitch-chat.ts`: single-flight connect promise (1 site)
`apps/desktop/src/backend/services/chat/twitch-chat.ts:121`

Adopt the single-flight pattern already used by `getAllFollowedChannels` / `_inFlight` in
`follow-endpoints.ts`, applied to a class field:

- Add `private connectingPromise: Promise<void> | null = null;` near the existing
  `isConnecting` / `currentConnectionId` fields.
- In `connect()`, replace the `isConnecting` guard's body — currently
  `await new Promise((resolve) => setTimeout(resolve, 100)); if (connected) return;` — with
  an await on the stored attempt:
  `if (this.connectingPromise) { await this.connectingPromise.catch(() => {}); if (this.connectionState === "connected") return; }`.
  The `.catch(() => {})` matters: a **failed** in-flight attempt must let the second caller
  fall through to a fresh connect, not re-throw the first attempt's error.
- `connectingPromise` holds the in-flight connect work and is cleared (`= null`) in the same
  `finally` that today clears `isConnecting`, gated on `connectionId === this.currentConnectionId`.
  *How* it is populated (wrapping the existing connect body vs. extracting a `_doConnect`
  helper) is a plan-level detail — the requirement is only that it holds the current attempt
  and is awaited with `.catch`.
- Leave **all** `currentConnectionId` supersede logic intact — it is what `disconnect()` and
  reconnect rely on; only the 100 ms guess is removed.

**Acceptance:** B3 verified — StrictMode double-mount yields a single IRC connection (no
abandoned socket); a `disconnect()` mid-connect still aborts cleanly; `tsc`.

---

## Verification

1. **Helper unit tests** — `apps/desktop/tests/backend/services/web-contents-ready.test.ts`
   (mirrors the source path, per the repo's test layout) with a fake `WebContents`
   (`executeJavaScript` mock) and Vitest fake timers. Cases: ready before timeout; never
   ready → resolves `false` at the cap; `isDestroyed()` mid-poll → resolves `false` and
   stops polling; `executeJavaScript` rejects on early polls then succeeds → resolves `true`.
   This is the genuinely testable core.
2. **`tsc`** typecheck across the desktop app (catches the helper wiring and the
   `connectingPromise` field/finally changes). Per project memory, `tsc` + Vitest are the
   gates — not biome lint (baseline-red).
3. **Live manual verification** (the unavoidable part — these scrape live third-party
   sites):
   - R2: import follows on an account **with** follows and on a **zero-follow** account.
   - R3: open the Kick OAuth window while **already** signed into kick.com (must skip the
     re-prompt) and while **signed out** (must auto-click Sign In).
   - R4: mount/unmount a Twitch chat in dev (StrictMode) and confirm a single connection.

   The helper's timeout-→-`false` design means a mis-authored predicate degrades to today's
   behavior, not a hard break — so live verification confirms the *speedup/bugfix*, and a
   regression is bounded by the existing fallbacks.

---

## Out of Scope (with reason)

- **`auth-window.ts:155`** — 1.5 s delay before closing the OAuth success window. This is a
  deliberate **UX dwell** so the user sees the success page; nothing is being waited *for*.
  Not an anti-pattern. (A sweep miscategorized it.)
- **`auth-window.ts:205`** — the 100 ms `setInterval` that clicks the kick.com Sign In
  button is *already* a conditioned DOM poll (capped at ~3 s), injected into the page. Fine
  as-is; a MutationObserver would be marginal.
- **`auth-window.ts:310` and `follow-endpoints.ts:267`** — the **borderline** cookie waits
  (1.5 s poll cadence; 2.5 s warm-visit settle). Lower payoff, more auth-critical/fragile;
  deferred (the 3 high-confidence fixes were chosen for SP1).
- **All backoff / heartbeat / keepalive / rate-limit / polling / `setTimeout(abort, ms)`
  guard timers** — legitimate elapsed-time use; `async/await` cannot replace them. These
  belong to **SP3** (quarantine behind cancel-safe helpers), not here.

---

## Risks & Assumptions

- **R1.** Kick can change its DOM, invalidating a predicate. Mitigation: the helper resolves
  `false` on timeout and the caller proceeds with whatever rendered — the same code path as
  today — so a stale predicate degrades gracefully and never throws.
- **R2.** R4 changes Twitch IRC connect concurrency semantics (B3) — the **only** behavior
  change in SP1. The plan must call it out and verification must cover StrictMode
  double-mount and mid-connect `disconnect()`.
- **A1.** `did-finish-load` / `dom-ready` are *not* sufficient signals for B1/B2 — they fire
  before SPA render. Polling the rendered DOM is the correct primitive, deliberately, not a
  fallback for missing event wiring.
- **A2.** No behavior change is intended at R1–R3; observable differences there during
  verification are regressions to fix, not accepted trade-offs. R4's B3 change is the sole
  exception and is intended.
