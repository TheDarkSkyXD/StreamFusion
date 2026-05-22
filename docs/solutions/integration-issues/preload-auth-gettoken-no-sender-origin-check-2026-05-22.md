---
title: AUTH_GET_TOKEN IPC has no sender-origin check (webSecurity:false vector)
date: 2026-05-22
discovered-during: docs/plans/2026-05-22-002-feat-predictions-backend-integration-plan.md (P0b audit during ce-work)
scope: pre-existing inherited gap, NOT introduced by predictions plan
---

# AUTH_GET_TOKEN preload IPC has no sender-origin check

## What

`apps/desktop/src/backend/ipc/handlers/auth-handlers.ts:192` handles the `AUTH_GET_TOKEN` IPC with:

```ts
ipcMain.handle(IPC_CHANNELS.AUTH_GET_TOKEN, (_event, { platform }: { platform: Platform }) => {
  return storageService.getToken(platform);
});
```

The `_event` parameter is underscore-prefixed — intentionally ignored. There is no `event.senderFrame.url` check or equivalent allowlist of caller origins. Any content loaded in the renderer (extensions, iframed/navigated-to pages, injected scripts, eval'd remote code) can call `window.electronAPI.auth.getToken("twitch" | "kick")` and receive the OAuth bearer token in plaintext.

Combined with `webSecurity: false` (set in `apps/desktop/src/backend/window-manager.ts:132` per the predictions plan's risk table), this means:

1. Any web content the renderer loads can read platform OAuth tokens.
2. Vote mutations being added by the predictions plan (Twitch `MakePrediction`, Kick `POST /predictions/vote`) become reachable from arbitrary renderer content using those tokens — channel-points debit attack surface.
3. The predictions plan's stated defense ("retrieve token at submit time only, never cache in component state") does not actually mitigate this — the IPC is the leak surface, not the cache.

## Why it survived

Pre-existing inherited gap. Not introduced by any current plan. The codebase pattern across all IPC handlers in `apps/desktop/src/backend/ipc/handlers/*.ts` matches — none enforce sender-origin checks. The implicit assumption is that the renderer only ever loads the app's own bundle, but `webSecurity: false` invalidates that assumption.

## How to fix (out of predictions plan scope)

Either:

1. **Re-enable webSecurity** — investigate which app feature required disabling it; replace that mechanism with a CSP-allowed alternative.
2. **Add sender-frame allowlist to security-sensitive IPC handlers** — at minimum on auth-token getters, save handlers, and any newly-added write surfaces (vote mutations). Check `event.senderFrame.url` against `app://` or `file://...index.html` pattern; reject from any other origin.
3. **Move credential-using mutations entirely into the main process** — renderer calls IPC; main process attaches token + dispatches request. Renderer never sees the token. Bigger refactor but the cleanest separation.

Recommended next step: open a new hardening plan that addresses the `webSecurity: false` posture together with this IPC gap and the safestorage base64 fallback gap (`docs/plans/2026-05-22-001-fix-safestorage-fallback-hardening-plan.md`). All three are part of the same renderer-trust-boundary cluster.

## Predictions plan implication

Predictions plan U2/U4 implementations proceed as scoped — they don't introduce this gap, but they DO widen its blast radius (channel-point debit becomes reachable via injected content). Reference this doc from the predictions plan's Risk Analysis row about `webSecurity: false`.
