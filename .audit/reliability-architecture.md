# Reliability hardening architecture

## Synthesis decision

Candidate B is the base. It scored highest in the independent cross-judge because its mandatory `TrustedIpcRegistry` closes the lazy-loader security gap, while its read-only `runBoundedRead` primitive centralizes retry mechanics without becoming a feature workflow framework.

The final design grafts three details from candidate A:

- a normalized `SafeAppError` vocabulary with stable codes, retry advice, and diagnostic IDs;
- an explicit write replay policy of `never`, `idempotency-key`, or `reconcile-before-replay`;
- contract gates that reject `z.any()` and whole-request `z.unknown()` schemas.

Runtime IPC contracts stay in the existing process-neutral `src/ipc-contracts/` direction, not under `backend/`. Provider schemas stay beside their adapters. `shared/` remains types and constants only.

Rejected from candidate A were the generic `useReliableQuery`, mandatory `ResourceStateView`, and broad `dependencyClient.requestJson` surface. They exposed feature and presentation policy through a central reliability stack. Rejected from candidate B was putting IPC schemas under `backend/ipc/contracts`, because preload and main need the same wire contract without reversing the process boundary.

## Caller usage

Handlers register through the trusted registry. The registry owns exact sender checks, request parsing, operation cancellation, safe exception mapping, and response parsing.

```ts
registry.handle({
  channel: IPC_CHANNELS.CHANNELS_GET_FOLLOWED,
  contract: followedChannelsContract,
  operation: { kind: "read", maxDeadlineMs: 12_000 },
  execute: ({ request, signal, operation }) =>
    followedChannelsReader.load(request.platform, { signal, operation }),
});
```

Renderer reads disable automatic TanStack retries and forward cancellation through preload. Existing feature hooks remain the public UI API.

```ts
useQuery({
  queryKey: CHANNEL_KEYS.followed(platform),
  retry: false,
  queryFn: ({ signal }) => window.electronAPI.channels.getFollowed({ platform }, { signal }),
});
```

Only dependency adapters may automatically retry a read. Writes use a separate API whose type requires replay policy to be explicit.

```ts
runBoundedRead({ operation, dependency: "kick", attempt, decode });
executeWriteOnce({ operation, replay: "never", execute });
```

Collection results make false empties unrepresentable: `empty` requires at least one completed source and admits no failed source; `partial`, `stale`, and `failed` remain distinct.

## Core shape

```ts
export type SafeAppError = {
  code:
    | "invalid_input" | "unauthenticated" | "forbidden" | "not_found"
    | "conflict" | "rate_limited" | "transient" | "timeout" | "offline"
    | "canceled" | "corrupt_local_data" | "upstream_schema" | "internal";
  retry: { kind: "none" } | { kind: "manual" } | { kind: "after"; retryAtMs: number };
  diagnosticId: string;
  platform?: Platform;
};

export type IpcReply<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; error: SafeAppError };

export type WriteReplayPolicy =
  | { kind: "never" }
  | { kind: "idempotency-key"; key: string }
  | { kind: "reconcile-before-replay"; journalId: string };

export type ListView<T> =
  | { kind: "complete"; items: readonly [T, ...T[]]; sources: NonEmpty<CompleteSource> }
  | { kind: "partial"; items: readonly [T, ...T[]]; complete: NonEmpty<CompleteSource>; failed: NonEmpty<FailedSource> }
  | { kind: "stale"; items: readonly [T, ...T[]]; asOf: number; unavailable: readonly FailedSource[] }
  | { kind: "empty"; items: readonly []; sources: NonEmpty<CompleteSource> }
  | { kind: "failed"; error: SafeAppError; failed: NonEmpty<FailedSource> };
```

Target state: `TrustedIpcRegistry.handle(route)` is the only invoke registration path. The implemented migration state has nine fully schema-validated routes; the other 184 invoke routes use `trustedIpcMain`, a production compatibility gate that enforces the exact main renderer, payload budgets, and safe thrown errors while route-specific Zod contracts are added. Raw Electron `ipcMain` imports are mechanically forbidden outside the two boundary adapters.

`runBoundedRead` composes the caller abort signal, an absolute operation deadline, and a per-attempt timeout. It owns jitter, `Retry-After` parsing, queue removal, body limits, and retry classification. Provider adapters retain auth, domain transforms, fallback choices, and health reporting. TanStack Query retains cache and explicit/manual refetch, but no automatic retries.

Implemented startup recovery catches durable-service initialization before IPC/window startup and opens a store-independent static recovery window, with a native error-box fallback. Database preflight performs SQLite `quick_check` and a pre-migration backup; the existing idempotent schema initialization now executes transactionally. There is no recovery journal or versioned migration framework yet, and durable data is never silently deleted. Renderer recovery uses app, route, sidebar, and mini-player boundaries. Electron renderer loss gets one controlled reload before safe mode; an unresponsive forced exit is recorded as abnormal; an uncaught main-process exception logs synchronously and exits.

## Module map

- `shared/reliability-types.ts`: serializable types/constants only.
- `ipc-contracts/`: Zod request and response contracts shared by preload/main.
- `backend/ipc/trusted-ipc-registry.ts`: sender enforcement, parsing, operation leases, safe errors.
- `backend/reliability/bounded-json-read.ts`: deadline, cancellation, retry, body-limit mechanics for JSON reads only.
- `backend/api/platforms/*/*-schemas.ts`: vendor response decoders.
- Existing feature handlers/readers: fan-out, domain transforms, completion state, cache admission.
- Existing hooks/components: scoped presentation and manual retry actions.
- `backend/startup/startup-recovery-window.ts`: store-independent startup failure UI and native fallback.

## Migration and proof

1. Add shared types, trusted registry, operation lease, and route-inventory gate. Register the lazy feature loader and existing trusted profile routes first.
2. Migrate category search, sidebar follows, followed-channel convenience paths, and unified search so failures cannot become empty data. Disable renderer read retries.
3. Move one lazy feature at a time through request/response contracts. Writes declare replay policy and default to `never`.
4. Move Twitch, Kick, 7TV, BTTV, and FFZ reads to the bounded primitive and local decoders. Remove displaced retry loops.
5. Add scoped React recovery, fatal process policy, renderer crash budget, transactional database startup, and the recovery window.
6. Remove the legacy inventory. Release requires zero raw `ipcMain.handle` registrations outside the registry, one contract per invoke route, no unsafe schemas, no raw vendor JSON admission, and no renderer automatic retries.

Each unit ends with focused tests, typecheck, lint, and `git diff --check`. Final proof adds the full desktop suite, build, React Doctor, route inventory, fault-injection tests, and observed Electron flows for offline/partial/error/retry/crash recovery.

## Tradeoffs accepted

- We accept one schema per route in exchange for meaningful runtime validation.
- We accept an operation envelope on cancellable reads in exchange for cancellation that reaches queues, timers, fetches, and body reads.
- We accept feature-local availability presentation in exchange for avoiding a shallow universal UI framework.
- We accept a small independent recovery journal/window in exchange for startup that remains operable when normal persistence is corrupt.

## Open risks

- Contract migration is large; the generated inventory must make the remaining count explicit after every unit.
- Some Electron and hidden-window transports need adapter-specific abort cleanup rather than a generic `fetch` signal.
- Safe-mode workspace restoration must be deliberately minimal so it cannot recreate the renderer crash loop.

## Next implementation step

Build the trusted registry and route inventory, then migrate `IPC_FEATURE_LOAD` plus the existing trusted user-profile routes before any feature handler.
