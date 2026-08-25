# Reliability hardening architecture, candidate A

## Usage

Feature handlers register one operation. Sender validation, request parsing, response parsing, cancellation, deadlines, safe errors, diagnostics, and retry policy stay inside the registrar.

```ts
registerReliableIpcHandler({
  channel: IPC_CHANNELS.STREAMS_GET_FOLLOWED,
  contract: ipcContracts[IPC_CHANNELS.STREAMS_GET_FOLLOWED],
  operation: readOperation({
    dependency: "platform",
    capability: "followed-streams",
    deadlineMs: 12_000,
  }),
  handle: async ({ request, operation }) =>
    streamDiscovery.getFollowedStreams(request, operation),
});
```

Writes use the same path, but their policy blocks automatic replay unless an idempotency key or a reconciliation step proves replay safety.

```ts
registerReliableIpcHandler({
  channel: IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE,
  contract: ipcContracts[IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE],
  operation: writeOperation({
    dependency: "kick",
    capability: "chat-send",
    replay: "never",
    deadlineMs: 10_000,
  }),
  handle: async ({ request, operation }) =>
    kickChatSender.sendMessage(request, operation),
});
```

Platform adapters receive an `OperationContext`. They do not own another retry loop.

```ts
const result = await dependencyClient.requestJson({
  operation,
  dependency: "kick",
  request: {
    method: "GET",
    url: kickUrl("/public/v2/categories", query),
    auth: "app-or-user",
  },
  response: kickSchemas.categoryList,
});

return transformKickCategories(result.data);
```

Renderer hooks pass cancellation to preload and render a resource state. Empty copy only renders after an authoritative complete empty result.

```ts
const follows = useReliableQuery({
  queryKey: STREAM_KEYS.followed("kick"),
  load: (signal) =>
    window.electronAPI.streams.getFollowed({ platform: "kick", limit: 100 }, { signal }),
  staleFallback: "keep-last-good",
});

return <ResourceStateView state={follows.state} onRetry={follows.retry} />;
```

Startup becomes recoverable. The normal renderer loads only after durable state is safe enough to use.

```ts
const boot = await bootRecovery.start({
  database: dbService,
  storage: storageService,
  userDataPath,
});

if (boot.kind === "ready") createMainWindow();
else createBootRecoveryWindow(boot);
```

## Problem

StreamFusion needs standardization, not a rewrite. The current working tree has 189 direct `ipcMain.handle` matches and eight `registerTrustedIpcHandler` registrations. The trusted helper already validates the sender, request, response, and fallback, but most handlers still return `{ success: false, error: string }` or raw `Error.message`. React Query retries reads three times, Twitch and Kick requestors can retry again, and some renderer cancellation only checks the signal after IPC returns. The visible result is duplicated retries, late obsolete work, raw technical copy, false empty states, and startup or renderer failures that can leave the app blank or unable to open.

The design preserves the current boundaries. `shared/` remains types and constants only. Preload remains the only renderer bridge. Lazy IPC feature loading stays. Mutation retry remains `false`. Auth refresh stays single-flight. Existing stale caches, per-platform health, and durable write journals stay in place.

## Shape

Candidate A adds three deep modules and one renderer view model.

### Core types

These types remove optional-field bags and stringly-typed error handling.

```ts
export type AppErrorCode =
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "transient"
  | "timeout"
  | "offline"
  | "canceled"
  | "corrupt_local_data"
  | "schema_drift"
  | "internal";

export type SafeAppError = {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  diagnosticId: string;
  platform?: Platform;
  retryAfterMs?: number;
  missingScopes?: readonly string[];
};

export type IpcOutcome<T> =
  | { ok: true; data: T; completion?: ProviderCompletion }
  | { ok: false; error: SafeAppError; completion?: ProviderCompletion };

export type ResourceState<T> =
  | { kind: "loading"; previous?: T }
  | { kind: "complete"; data: T; receivedAt: number }
  | { kind: "partial"; data: T; failedProviders: ProviderFailure[]; receivedAt: number }
  | { kind: "stale"; data: T; staleSince: number; refreshError: SafeAppError }
  | { kind: "empty"; receivedAt: number }
  | { kind: "failed"; error: SafeAppError; lastGood?: T };
```

`shared/` exports only these types and constants. Runtime Zod schemas live in `src/ipc-contracts/`, `backend/api/platforms/*/*-schemas.ts`, and `backend/services/emotes/*-schemas.ts`.

### Trusted IPC

`registerReliableIpcHandler` extends the existing trusted helper. It has no production opt-outs for sender, request, or response validation.

```ts
export type IpcContract<Request, Response> = {
  request: z.ZodType<Request>;
  response: z.ZodType<Response>;
};

export type IpcOperationPolicy =
  | { kind: "read"; dependency?: DependencyName; capability: string; deadlineMs: number }
  | {
      kind: "write";
      dependency?: DependencyName;
      capability: string;
      deadlineMs: number;
      replay:
        | "never"
        | { kind: "idempotency-key"; keyFromRequest: string }
        | "reconcile-before-replay";
    };

export function registerReliableIpcHandler<Request, Response>(args: {
  channel: IpcChannel;
  contract: IpcContract<Request, IpcOutcome<Response>>;
  operation: IpcOperationPolicy;
  handle(input: {
    event: IpcMainInvokeEvent;
    request: Request;
    operation: OperationContext;
  }): Promise<Response | IpcOutcome<Response>>;
}): void;
```

The registrar validates the main frame, the app renderer URL, and `isAllowedSender`. Preload attaches an `operationId` to invocations and sends `ipc:operation-cancel` when the caller's `AbortSignal` aborts. Main owns the matching `AbortController`. This generalizes the current search and chat-replay request-ID pattern.

### Operation runtime

`OperationContext` is the only owner of deadlines, cancellation, retry eligibility, diagnostic IDs, and dependency budgets.

```ts
export type OperationContext = {
  id: OperationId;
  startedAt: number;
  deadlineAt: number;
  signal: AbortSignal;
  policy: IpcOperationPolicy;
  diagnostics: DiagnosticScope;
  retry: RetryAuthority;
};

export interface RetryAuthority {
  run<T>(args: {
    dependency: DependencyName;
    capability: string;
    request: RetryableRequestDescription;
    classify(error: unknown, response?: Response): ClassifiedFailure;
    execute(signal: AbortSignal): Promise<T>;
  }): Promise<T>;
}
```

Reads can retry transient, timeout, rate-limited, and offline recovery classes within the overall deadline. Writes do not retry by default. A write can replay only when the policy names an idempotency key or a reconcile-before-replay step. Auth refresh stays inside `twitchAuthService` and `kickAuthService`, including existing single-flight behavior. The runtime only permits one safe replay after 401 when the operation policy allows replay.

React Query keeps caching and stale data. It stops owning transport retry for migrated hooks. The global query retry becomes `false` once hooks return `IpcOutcome<T>`. Mutations remain `retry: false`.

### External validation

Every external response parser takes `unknown` and returns a domain type or a classified `schema_drift` error.

```ts
export interface JsonEndpoint<Response> {
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: URL;
  response: z.ZodType<Response>;
  bodyLimitBytes: number;
  retry: "read" | "none" | "idempotent-write";
}

export async function requestJson<Response>(
  operation: OperationContext,
  endpoint: JsonEndpoint<Response>
): Promise<Response>;
```

Twitch keeps the `requestDecoded` pattern. Kick gets separate schema modules for official API responses and legacy `kick.com/api/*` responses. Third-party emote services get schemas beside the provider service. Identity and pagination failures fail the whole response. Decorative emote catalog items may use a `skip-invalid-items` policy when enough valid data remains to show a partial result honestly.

### Honest UI state

Renderer hooks map `IpcOutcome<T>` and TanStack Query state into `ResourceState<T>`.

- `empty` requires a successful complete provider result with an empty collection.
- `failed` means no usable current or stale data exists.
- `stale` means a refresh failed but last good data remains.
- `partial` means at least one requested provider completed and at least one failed.
- `canceled` suppresses toast and inline error UI.

This fixes the `SidebarFollows` class of bug. A failure with no cached rows is `failed`, not `empty`. A failure with cached rows is `stale`. A Twitch success plus Kick failure is `partial`.

### React, Electron, and startup recovery

Renderer recovery has three layers.

```ts
export function AppRecoveryBoundary(props: { children: React.ReactNode }): JSX.Element;
export function RouteRecoveryBoundary(props: { children: React.ReactNode }): JSX.Element;
export function ResourceStateView<T>(props: ResourceStateViewProps<T>): JSX.Element;
```

`App.tsx` wraps the provider tree in an app-level boundary. `routes/router.tsx` adds route error components. Feature components use `ResourceStateView` or a local equivalent for async regions. Main-process recovery extends `installRendererCrashRecovery` to handle `crashed`, `abnormal-exit`, `launch-failed`, and `integrity-failure` with a crash-loop guard. A first failure reloads the current URL. Repeated failures open safe mode.

Startup recovery moves durable initialization behind one owner.

```ts
export type BootRecoveryResult =
  | { kind: "ready" }
  | { kind: "recovery-required"; failures: DurableStateFailure[]; recoveryId: string };

export type DurableStateFailure =
  | { kind: "database"; path: string; action: "repair" | "quarantine" | "restore-backup" }
  | { kind: "storage"; path: string; action: "reset-preferences" | "quarantine" }
  | { kind: "secure-storage"; action: "reauthorize" | "continue-without-secrets" };
```

`bootRecovery.start` runs SQLite integrity checks, wraps migrations in transactions where possible, creates a pre-migration backup, quarantines corrupt disposable state, and leaves durable user data untouched unless the user picks a recovery action.

### Module map

`apps/desktop/src/shared/app-error-types.ts` owns `SafeAppError`, `IpcOutcome<T>`, `ProviderCompletion`, and `ResourceState<T>` as types only.

`apps/desktop/src/ipc-contracts/` owns Zod IPC schemas and exports `ipcContracts`.

`apps/desktop/src/backend/ipc/register-reliable-ipc-handler.ts` owns sender enforcement, operation creation, request parse, response parse, safe errors, and cancel registration.

`apps/desktop/src/backend/resilience/operation-runtime.ts` owns `OperationContext`, deadlines, cancellation composition, and operation IDs.

`apps/desktop/src/backend/resilience/dependency-client.ts` owns per-attempt timeout, retry classification, jitter, `Retry-After`, retry budgets, and body-size limits.

`apps/desktop/src/backend/resilience/safe-error.ts` maps thrown errors, HTTP failures, schema failures, and durable-state failures to `SafeAppError`.

`apps/desktop/src/backend/api/platforms/kick/kick-schemas.ts` and `legacy-kick-schemas.ts` own Kick validation.

`apps/desktop/src/backend/services/emotes/third-party-emote-schemas.ts` owns 7TV, BTTV, and FFZ validation.

`apps/desktop/src/preload/reliable-invoke.ts` owns operation IDs, optional `AbortSignal`, cancel sends, and response normalization.

`apps/desktop/src/hooks/queries/resource-state.ts` owns the React Query to `ResourceState<T>` mapping.

`apps/desktop/src/backend/startup/boot-recovery.ts` owns recoverable database, storage, and secure-storage startup.

### Interface depth

The public API is small:

- `registerReliableIpcHandler`
- `operationRuntime.start`
- `dependencyClient.requestJson`
- `useReliableQuery`
- `ResourceStateView`
- `bootRecovery.start`

Those functions hide sender checks, schemas, retry loops, stale cache semantics, and boot repair. This follows model-the-domain, boundary-discipline, type-system-discipline, laziness-protocol, and minimize-reader-load.

## Synthesis decision

Not synthesized. Candidate A recommends a contract-first reliability layer. It uses the existing trusted IPC helper, search cancellation pattern, `requestDecoded` pattern, platform health tracker, stale snapshots, and mutation retry policy as the base. It rejects a wholesale transport rewrite because the app already has specialized BrowserWindow, Electron `net`, HLS, and chat paths that cannot all become one HTTP class safely.

The principles changed specific choices. Boundary discipline put Zod contracts at IPC and external-provider entry points. Type-system discipline made `SafeAppError`, `IpcOutcome`, and `ResourceState` discriminated unions. Model the domain made complete, partial, stale, failed, and empty first-class states. Make-operations-idempotent blocked automatic write replay. Laziness protocol kept existing lazy feature loading, stale caches, auth single-flight, and per-platform health. Build-the-lever and sequence-verifiable-units shaped the migration as generated coverage checks plus feature-by-feature units.

## Migration units and enforcement

1. Add shared type-only `SafeAppError`, `IpcOutcome`, `ProviderCompletion`, and `ResourceState`.
2. Add `registerReliableIpcHandler` and migrate the eight current user-profile channels to prove parity.
3. Add `tests/shared/ipc-contract-coverage.test.ts`. It scans source like `ipc-wiring-coverage.test.ts`, fails on new raw `ipcMain.handle` or `ipcMain.on` outside the registrar, and tracks remaining legacy registrations in a checked migration manifest.
4. Migrate non-payload system and app handlers.
5. Migrate read-only discovery handlers. Add provider completion to streams, categories, channels, search, videos, clips, and emotes.
6. Turn React Query retry off for migrated discovery hooks. Convert `SidebarFollows`, category search, and unified search first.
7. Add `operationRuntime` and `dependencyClient`, then move Twitch and Kick read retries into that owner.
8. Migrate writes as `replay: "never"` unless the current service already has a journal, idempotency key, or reconciliation proof.
9. Add Kick and third-party response schemas beside their owning adapters.
10. Add root, route, and region recovery boundaries. Convert false-empty components to `ResourceState`.
11. Add `bootRecovery.start` around `dbService.initialize()` and `storageService.initialize()`.
12. Remove the migration manifest. The final gate fails every raw handler, channel without a contract, `z.any`, and whole-request `z.unknown`.

Mechanical checks:

- IPC contract coverage verifies one reliable handler per invoked channel.
- ESLint bans direct `ipcMain` imports in handler files except the reliable registrar and explicit push-event helpers.
- Contract-schema tests reject unsafe schemas and raw `Error` responses.
- Retry-ownership tests reject direct retry sleeps in migrated adapters after they accept `OperationContext`.
- Provider schema tests load captured Kick, 7TV, BTTV, and FFZ fixtures as `unknown`.
- Component tests assert loading, complete, partial, stale, failed, and empty branches where a component can render them.
- Operation runtime tests assert deadlines, cancel propagation, `Retry-After`, retry classification, and no write replay without policy.
- Packaged-app failure injection follows `docs/brainstorms/2026-08-23-resilience-failure-ux-research.md` after unit and component gates pass.

## Tradeoffs accepted

- We accept many small Zod contracts in exchange for mechanical IPC review.
- We accept operation IDs on renderer invokes in exchange for cancellation that stops main-process work.
- We accept keeping multiple transport implementations in exchange for one shared retry and decoding policy.
- We accept temporary migration accounting in tests in exchange for avoiding unsafe production opt-outs.
- We accept fail-closed UI for uncertain empty data in exchange for never showing false empty states.
- We accept a small boot recovery window in exchange for keeping the normal renderer out of corrupt durable state.

## Alternatives considered

One universal `httpClient` for every outbound request lost. It hides retry and concurrency, but it exposes the wrong implementation choice to hidden BrowserWindow fetches, Electron `net.fetch`, HLS paths, OAuth windows, and chat transports.

Preload-only validation lost. The privileged boundary is main. A hostile or broken renderer can still invoke a channel, so request validation and sender validation must happen in main.

Renderer-only error mapping lost. It would leave raw strings crossing IPC and make every hook repeat policy. Main has the cause, platform, HTTP status, retry headers, and diagnostic logger.

Putting Zod schemas under `shared/` lost. It violates the shared-layer rule and invites runtime logic into the contract layer.

Keeping React Query and adapter retries both enabled lost. A single retry owner gives bounded elapsed time and one place to reason about write replay.

## Open questions and risks

- Which old IPC channels should become reliable listeners rather than invoke handlers?
- Which Kick legacy endpoints have enough fixtures to validate shape without over-rejecting presentation drift?
- Should the first CI gate allow a short legacy manifest, or only fail on new raw registrations until each feature domain moves?
- How much state should safe mode restore before it risks reloading the crashing workspace?
- Can every Electron `net.fetch` call site accept `AbortSignal.any`, or do some need adapter-specific cleanup?
- Should `schema_drift` on provider enrichment skip one malformed item or fail the provider for each emote and search response?

## Next implementation step

Build `registerReliableIpcHandler` by extending the existing trusted handler, migrate the eight user-profile channels through it, and add the IPC contract coverage test that blocks new raw registrations while the rest of the migration proceeds.
