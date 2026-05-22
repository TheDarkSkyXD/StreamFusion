---
title: "Stubs whose empty return is the intended contract must not log a per-call warning"
module: apps/desktop/backend/api/platforms/kick
date: 2026-05-21
category: conventions
problem_type: convention
component: service_object
severity: low
applies_when:
  - "A backend adapter method is a permanent stub returning an empty result (e.g. `{ data: [] }`) because the upstream API does not support the operation"
  - "The stub's caller is on a recurring poll interval (React Query `refetchInterval`, `setInterval`, IPC handler)"
  - "`console.warn` (or equivalent) fires unconditionally inside the stub body"
  - "The warn text describes an API limitation, not an unexpected runtime failure"
tags: [logging, stub, convention, polling, kick, ipc, react-query, log-noise]
---

# Stubs whose empty return is the intended contract must not log a per-call warning

## Context

React Query hooks with `refetchInterval` call their backing IPC handlers on a steady clock. When a platform adapter method is a permanent stub — returning `{ data: [] }` because the upstream API simply does not expose the operation — any `console.warn` inside that stub fires on every poll tick, multiplied by the number of mounted consumers. The result is terminal noise that obscures real warnings and misleads anyone reading the logs into thinking the function is broken.

The immediate trigger: `StreamEndpoints.getFollowedStreams` in `apps/desktop/src/backend/api/platforms/kick/endpoints/stream-endpoints.ts:1316` contained a `console.warn("⚠️ Kick official API does not support followed streams directly")` before its `return { data: [] }`. The `useFollowedStreams` hook (`apps/desktop/src/hooks/queries/useStreams.ts:48`) polls every 60 seconds with `refetchInterval: 60000` and also refetches on window focus via `staleTime: 30000`. Two components mount the hook independently (sidebar follows + Following page), producing ~2 warns per minute plus bursts on focus, for every authenticated Kick user.

## Guidance

**Do not log at runtime inside a stub whose empty return is the intended contract.** Document the permanent limitation in code — JSDoc and an inline comment explaining the architectural role of the empty result — and omit the runtime signal entirely.

If a runtime signal is genuinely required (e.g., observability telemetry), gate it behind a module-level boolean flag that fires exactly once, not per-call.

```ts
// Good — limitation documented in code, no runtime noise
export async function getFollowedStreams(
  _client: KickRequestor,
  _options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedStream>> {
  // The official API doesn't have a followed streams endpoint.
  // Callers (the followed-streams IPC handler) union this empty result with
  // local-follow data fetched per-slug via getPublicStreamBySlug — the empty
  // return is the intended contract, not a failure.
  return { data: [] };
}
```

If a one-time runtime signal is ever needed:

```ts
let _warnedOnce = false;
export async function getFollowedStreams(...): Promise<PaginatedResult<UnifiedStream>> {
  if (!_warnedOnce) {
    console.warn("Kick: getFollowedStreams is a stub; upstream API unavailable.");
    _warnedOnce = true;
  }
  return { data: [] };
}
```

Reserve `console.warn` / `logger.warn` inside `stream-endpoints.ts` and `stream-handlers.ts` for genuinely unexpected branches: auth failures, parse errors, API shape changes.

## Why This Matters

A warn characterizes a result as a problem. When the result is architecturally correct — the IPC handler at `apps/desktop/src/backend/ipc/handlers/stream-handlers.ts:266-318` unions the empty stub result with per-slug `getPublicStreamBySlug` fan-out, and the stub exists specifically so `KickClient` satisfies `IPlatformClient` (`apps/desktop/src/backend/api/unified/platform-client.ts:46`) without breaking platform-agnostic handler logic — the warn is a lie. It trains readers to ignore warnings, which erodes signal fidelity for the warnings that actually matter.

The spam volume compounds this: two mounted consumers polling every 60 seconds is low by itself, but Kick users with the app open for an hour accumulate 120+ identical lines in their terminal. This drowns any genuine error that fires in the same window.

This convention is the stub-side complement of [`poll-fan-out-cache-stagger-pattern-2026-05-19.md`](../architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md), which already reserves warns on the *handler* side of this same module for genuine, unexpected failures (the doc's `AbortError`-filter on `Promise.allSettled` rejections is an instance of the same "expected states should not warn" principle generalized here).

## When to Apply

- Any `IPlatformClient` method stub that returns `{ data: [] }` or equivalent because the upstream platform API does not expose the operation.
- Any React Query hook with `refetchInterval > 0` (or `staleTime` that triggers focus-refetch) backed by a stub.
- Any `setInterval`- or cron-driven IPC handler that calls a stub on its polling path.
- Any handler that unions results from multiple sources where some sources are stubs — the stub-as-no-op is the normal pattern there, and per-call warns on the stubs corrupt the log stream for the entire union.

Do **not** apply this convention to: one-shot CLI commands where a single warn is informational; genuinely unexpected branches (auth failure, parse error, unexpected API shape change); or throwing/rejecting code paths where an error stack is the correct artifact.

## Examples

Canonical file: `apps/desktop/src/backend/api/platforms/kick/endpoints/stream-endpoints.ts:1316`

**Before (log spam on every poll):**
```ts
export async function getFollowedStreams(
  _client: KickRequestor,
  _options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedStream>> {
  // The official API doesn't have a followed streams endpoint
  // Would need to first get followed channels, then check which are live
  console.warn("⚠️ Kick official API does not support followed streams directly");
  return { data: [] };
}
```

**After (limitation in code, no runtime noise):**
```ts
export async function getFollowedStreams(
  _client: KickRequestor,
  _options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedStream>> {
  // The official API doesn't have a followed streams endpoint.
  // Callers (the followed-streams IPC handler) union this empty result with
  // local-follow data fetched per-slug via getPublicStreamBySlug — the empty
  // return is the intended contract, not a failure.
  return { data: [] };
}
```

The polling chain that makes this matter: `useFollowedStreams` (`apps/desktop/src/hooks/queries/useStreams.ts:48`, `refetchInterval: 60000`) → IPC `STREAMS_GET_FOLLOWED` → `fetchKickFollowed` (`apps/desktop/src/backend/ipc/handlers/stream-handlers.ts:266`) → `kickClient.getFollowedStreams` (`apps/desktop/src/backend/api/platforms/kick/kick-client.ts:704`) → `StreamEndpoints.getFollowedStreams`.

Fixed in commit `525d19c`.

## Related

- [`docs/solutions/architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md`](../architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md) — Same polling pipeline (`stream-endpoints.ts` / `stream-handlers.ts` / 60s cycle). The `AbortError` warn-filter described there is a specific instance of the broader "expected states should not warn" principle this convention generalizes.
- [`docs/solutions/conventions/electron-webrequest-callback-contract-2026-05-19.md`](./electron-webrequest-callback-contract-2026-05-19.md) — Parallel convention: document load-bearing contracts in comments when the correct form is non-obvious. Different mechanism, same discipline.
