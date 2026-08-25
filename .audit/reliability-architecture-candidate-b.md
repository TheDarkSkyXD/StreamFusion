# Reliability architecture candidate B

## Problem

StreamFusion already has good local recovery work, but equivalent requests take incompatible paths. The renderer retries reads three times in `query-provider.tsx`. Twitch and Kick requestors also retry. Most of the 188 `ipcMain.handle` registrations trust a TypeScript payload and return a raw message on failure. `registerTrustedIpcHandler` proves the safer shape for eight profile routes, while `lazy-feature-loader.ts` proves that handlers can remain lazy. The design must make every invoke route trusted and runtime-validated without turning `shared/` into a runtime package, removing lazy loading, replaying a write, or replacing proven cache, health, auth, and persistence work with a new framework.

Candidate B uses two narrow standards and keeps feature ownership local. A trusted route registry owns only Electron boundary mechanics. A bounded-read primitive owns only an individual upstream read's deadline, cancellation, and retry loop. Discovery, follow, search, playback, and startup continue to decide their own data, cache, and recovery policy. This differs intentionally from a universal reliability pipeline that would route every feature through one large coordinator.

## Usage (caller's view)

The caller keeps a normal TanStack Query. It disables Query retries because the platform adapter owns automatic read retries. Cancellation reaches main immediately and a manual Refresh starts a fresh operation.

```ts
export function useFollowedChannels(platform: Platform) {
	return useQuery({
		queryKey: CHANNEL_KEYS.followed(platform),
		retry: false,
		queryFn: ({ signal }) =>
			invokeListRead({
				signal,
				start: (operation) =>
					window.electronAPI.channels.getFollowed({ platform, operation }),
			}),
	});
}

function SidebarFollowsContent({ state }: { state: ListView<UnifiedChannel> }) {
	switch (state.kind) {
		case "complete":
			return <FollowList channels={state.items} />;
		case "partial":
			return <FollowList channels={state.items} notice={platformNotice(state.failed)} />;
		case "stale":
			return <FollowList channels={state.items} notice={`Showing data from ${state.asOf}`} />;
		case "empty":
			return <FollowEmptyState />;
		case "failed":
			return <FollowFailure error={state.error} />;
	}
}
```

The IPC handler declares the schema and calls its existing domain service. The registry validates sender, request, and response. It never passes a raw exception to the renderer. The handler keeps its lazy import inside the route body.

```ts
export function registerChannelHandlers(registry: TrustedIpcRegistry): void {
	registry.handle({
		channel: IPC_CHANNELS.CHANNELS_GET_FOLLOWED,
		request: followedChannelsRequestSchema,
		response: ipcReplySchema(listViewSchema(unifiedChannelSchema)),
		execute: async ({ request, operation }) => {
			const { channelReader } = await import("../../features/channels/channel-reader");
			return channelReader.getFollowed(request.platform, operation);
		},
	});
}
```

An upstream adapter gets a read lease, not a generic retry option. The type does not admit a mutation, so chat send, follow, moderation, token exchange, and settings writes cannot enter this automatic replay path.

```ts
const response = await runBoundedRead({
	operation,
	dependency: "kick-public-api",
	attempt: ({ signal }) => net.fetch(url, { headers, signal }),
	decode: kickFollowedChannelsSchema,
});
```

The caller can only render an empty invitation after an authoritative empty result. A provider error returns `partial`, `stale`, or `failed`, never `empty`.

## Shape

### Core types and signatures

`shared/reliability-types.ts` contains serialization-safe types and constants only. It contains no Zod imports, functions, Electron types, vendor types, or schema instances.

```ts
declare const operationIdBrand: unique symbol;
export type OperationId = string & { readonly [operationIdBrand]: "OperationId" };

export interface ReadOperation {
	readonly id: OperationId;
	readonly deadlineAtMs: number;
	readonly cancellationKey: string;
}

export type FaultCode =
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
	| "upstream_schema"
	| "internal";

export type RetryAdvice =
	| { readonly kind: "none" }
	| { readonly kind: "manual" }
	| { readonly kind: "after"; readonly retryAtMs: number };

export interface AppFault {
	readonly code: FaultCode;
	readonly retry: RetryAdvice;
	readonly diagnosticId: string;
}

export type IpcReply<T> =
	| { readonly kind: "ok"; readonly value: T }
	| { readonly kind: "error"; readonly error: AppFault };

type NonEmpty<T> = readonly [T, ...T[]];
export type CompleteSource = { readonly platform: Platform; readonly completedAtMs: number };
export type FailedSource = { readonly platform: Platform; readonly error: AppFault };

export type ListView<Item> =
	| { readonly kind: "complete"; readonly items: NonEmpty<Item>; readonly sources: NonEmpty<CompleteSource> }
	| { readonly kind: "partial"; readonly items: NonEmpty<Item>; readonly complete: NonEmpty<CompleteSource>; readonly failed: NonEmpty<FailedSource> }
	| { readonly kind: "stale"; readonly items: NonEmpty<Item>; readonly asOf: number; readonly unavailable: readonly FailedSource[] }
	| { readonly kind: "empty"; readonly items: readonly []; readonly sources: NonEmpty<CompleteSource> }
	| { readonly kind: "failed"; readonly error: AppFault; readonly failed: NonEmpty<FailedSource> };
```

`ListView` is deliberately for collection reads. A scalar feature keeps its existing explicit state type or adds a matching value union. The design does not turn every IPC response into an artificial list. A `kind` switch is exhaustive. `empty` has no failed source. `partial` has both usable fresh data and a failed source. `stale` requires data and an age. A nonempty source tuple makes a supposedly authoritative result impossible without a completed provider.

The backend contract stays close to Electron because Zod executes there. Endpoint schemas live beside their adapter or handler and parse `unknown` into application types. `registerTrustedRoute` is the only module that imports `ipcMain.handle`.

```ts
interface TrustedRoute<Request, Success> {
	readonly channel: IpcChannel;
	readonly request: z.ZodType<Request>;
	readonly response: z.ZodType<IpcReply<Success>>;
	execute(input: {
		readonly request: Request;
		readonly operation: ReadOperation | undefined;
		readonly signal: AbortSignal;
	}): Promise<IpcReply<Success>>;
}

interface TrustedIpcRegistry {
	handle<Request, Success>(route: TrustedRoute<Request, Success>): void;
}

function registerTrustedRoute<Request, Success>(
	registry: TrustedIpcRegistry,
	route: TrustedRoute<Request, Success>
): void;

function invokeListRead<Item>(input: {
	readonly signal: AbortSignal;
	readonly start: (operation: ReadOperation) => Promise<IpcReply<ListView<Item>>>;
}): Promise<ListView<Item>>;
```

The registry checks the exact trusted `webContents`, main frame, expected app document, and existing `isAllowedSender` policy. It parses the request before any side effect. It creates or joins the operation cancellation lease. It parses the returned `IpcReply` before returning it. A malformed response or thrown exception logs a redacted cause with the operation ID and returns `{ kind: "error", error: { code: "internal", ... } }`. `invokeListRead` turns a non-canceled reply error into `ListView.failed`. `canceled` rejects the renderer query as cancellation, without a toast or an error state. The stable code, retry advice, and diagnostic ID cross IPC. Raw error messages, stack traces, upstream bodies, paths, and credentials do not.

`ReadOperation` has an absolute deadline that main clamps to a route maximum. Main owns a map from `OperationId` to `AbortController` for the trusted sender. The `ipc:cancel-operation` route validates the same sender before it aborts the controller. Superseding a matching `cancellationKey` aborts the previous queued attempt, retry timer, response body, and fan-out. The renderer signal only requests cancellation. It cannot expand the deadline or grant a retry budget.

```ts
type DependencyName =
	| "twitch-helix"
	| "kick-public-api"
	| "7tv"
	| "bttv"
	| "ffz";

interface BoundedRead<Output> {
	readonly operation: ReadOperation;
	readonly dependency: DependencyName;
	attempt(context: { readonly signal: AbortSignal; readonly attempt: number }): Promise<Response>;
	decode(response: Response): Promise<Output>;
}

function runBoundedRead<Output>(read: BoundedRead<Output>): Promise<Output>;
function executeWriteOnce<Input, Output>(input: WriteCommand<Input>): Promise<IpcReply<Output>>;
```

`runBoundedRead` is a small main-process primitive, not an application HTTP client. The adapter that directly knows Twitch, Kick, 7TV, BTTV, FFZ, or a media endpoint calls it and is the only automatic retry owner for that dependency call. It combines the operation signal with each attempt timeout, checks status before decoding, caps bodies, parses the decoder, honors `Retry-After` seconds or date and platform reset headers, uses jitter, and stops on deadline, cancellation, exhaustion, offline evidence, or permanent error. Its per-platform budget is a leased token bucket owned by the existing platform-health scope. Foreground work can take a bounded slot before background refreshes. A schema failure, 400, 401 after one coordinated safe replay, 403, 404, and 409 never retry.

The adapter removes retry loops from `TwitchRequestor.request`, `KickClient.request`, and `RobustHttpClient` as each caller moves. The current single-flight `TwitchAuthService.refreshToken()` and `KickAuthService.refreshToken()` remain. A safe read may refresh once and replay once through `runBoundedRead`. A write remains in `executeWriteOnce`, uses the existing durable reconciliation or an upstream idempotency key, and reports `unknown` rather than guessing success after a timeout. React Query changes its read default to `retry: false`. Its cache, refetch, stale-time, persistence, and reconnect invalidation remain useful, but it never adds another automatic attempt.

### Module map and ownership

| Module | Owns | Does not own |
| --- | --- | --- |
| `shared/reliability-types.ts` | Serializable result, fault, and operation types | Zod, functions, Electron, platform payloads |
| `backend/ipc/trusted-registry.ts` | Sender check, request and response parsing, safe IPC error mapping, operation cancellation lease | Feature business decisions, retry policy, vendor decoding |
| `backend/ipc/contracts/<feature>-contracts.ts` | Zod schemas for that feature's request and response | Shared runtime code or provider transport types |
| `backend/reliability/bounded-read.ts` | Read deadline, abort composition, one retry loop, rate wait, body limit, telemetry | Write replay, UI state, platform business transforms |
| `backend/api/platforms/<provider>/*-schemas.ts` | Provider response parsing and item-level validation | IPC and UI response mapping |
| Existing feature readers and handlers | Feature fan-out, cache choice, `ListView` construction, lazy imports | Sender trust and generic retry mechanics |
| `hooks/queries/invoke-read.ts` | Operation creation and renderer-to-main cancellation cleanup | Retry, cache policy, visible copy |
| Existing pages and components | Scoped loading, complete, partial, stale, empty, and failure presentation | Provider inference and raw error handling |
| `backend/startup/boot-coordinator.ts` | Start decision and narrow storage repair choices | Normal feature persistence and page rendering |

The runtime flow is `React hook -> restricted preload method -> trusted registry -> feature reader -> bounded platform read -> decoded domain result -> ListView -> component`. Import direction stays flat. UI imports only the restricted preload types and shared types. The registry imports shared types and feature contracts. Platform adapters import their local schemas and shared types. `shared/` stays types and constants only. The existing preload feature map and `lazy-feature-loader.ts` remain. `IpcRegistrationContext` flows through the lazy loader so loaded feature modules register routes through the same trusted registry rather than importing Electron's `ipcMain` themselves.

### Startup and recovery

`BootCoordinator` runs before `dbService.initialize()` and `storageService.initialize()`. It uses a tiny, independently versioned recovery journal that writes atomically outside SQLite and electron-store. The journal holds only a session ID, app version, crash count, startup phase, and a sanitized workspace restore reference. It contains no token, cookie, chat text, stream URL, or absolute user path.

For a normal start, the coordinator records `starting`, preflights the journal, database, settings, and secure storage, then records `ready` after the shell becomes healthy. Database migration takes a pre-migration backup, runs integrity check and versioned migration in a transaction, and changes the journal only after commit. A corrupt cache is rebuilt. A corrupt preferences file is quarantined and reset. A database, credential, disk, or permission problem opens a minimal recovery window before the normal shell. That window uses only pre-registered trusted `recovery:*` routes to export a backup, rebuild a cache, reset preferences, repair durable data, or retry secure storage. It never silently signs the user out or clears an unrelated class of data.

React gets a boundary tree rather than one catch-all fallback. The shell, route content, each player slot, chat panel, settings content, and modal root have a recovery boundary with a local diagnostic ID. The fallback explains the affected region, keeps other regions alive, exposes a keyboard-reachable action, restores focus, and uses a polite status announcement for routine recovery. Error boundaries do not cover event handlers or asynchronous work. Those paths consume `AppFault` and preserve input, draft, player volume, scroll position, and workspace intent.

Main-process `uncaughtException` logging becomes synchronous last-resort recording followed by an abnormal exit. `renderer-crash-recovery.ts` records every renderer loss reason. It allows one controlled reload that restores the journaled workspace, then opens safe mode after a repeated loss. `window-manager.ts` records a forced unresponsive destroy as abnormal, not clean. Resume invalidates expired read leases before the existing token refresh, health probe, chat, and playback recovery run. No recovery loop has an unbounded timer or an untracked attempt.

### Incremental migration units and mechanical enforcement

1. Add the serialization types, trusted registry, operation lease, and contract-test fixture. Port the eight user-profile handlers through the registry without changing their public preload methods. Register `IPC_FEATURE_LOAD` through the registry first, then pass the registration context through the existing lazy loader.
2. Fix the visible lies while the contract is small. Port category search, sidebar follows, followed-channel convenience methods, and unified search. Replace their `[]`-on-error branches with `ListView`. Disable Query read retries. Keep snapshot bootstrap and per-platform health unchanged.
3. Move one lazy feature at a time. Add request and response schemas, extract the existing callback body to `execute`, preserve its lazy imports, and add malformed sender, request, response, and safe-error tests. Search and chat replay move next because they already show request-ID cancellation. No new channel can use direct registration.
4. Move Twitch, Kick, and third-party read adapters to `runBoundedRead`. Each endpoint gets a local decoder. `KickClient.electronRequest<T>` loses its caller-selected generic after each endpoint has a decoder. A list can retain valid rows only when its result is marked partial and its rejected rows are logged and counted. Raw `net.fetch(...).json()` and `JSON.parse(...) as T` cannot enter a cache.
5. Add boot coordination, recovery routes, boundary tree, controlled fatal exit, renderer crash budget, and recovery-window proof. Keep current durable follow writes, recording journals, cache snapshots, auth single-flight, and platform health in place.
6. Finish the handler sweep with a generated route inventory. Release only when every invoke channel has one route contract and there are zero direct `ipcMain.handle` calls outside `trusted-registry.ts`. There is no production compatibility registration path or privileged opt-out.

The implementation adds these checks to the normal lint and test path.

- An AST route-inventory check compares all invoke channels in `IPC_CHANNELS`, preload methods, and registered route contracts. It fails on missing, duplicate, untyped, or direct registrations. Push-only channels are an explicit separate list.
- ESLint bans `ipcMain`, `ipcRenderer`, raw `fetch`, `net.fetch`, `Response.json`, and `JSON.parse` from the relevant handler and provider directories except for named boundary modules. It also bans `retry` values other than `false` in renderer query hooks. The rules cover relative and alias imports.
- Parameterized contract tests send malformed payloads and forged sender frames to every route, force invalid handler results, and assert a schema-checked safe error with a diagnostic ID. No raw error message may reach the preload result.
- Deterministic fake-clock tests prove deadline, jitter window, `Retry-After`, Twitch reset, budget exhaustion, queue removal, body abort, 401 single-flight, and zero automatic write replay. A test uses the current auth services to prove that concurrent 401s refresh once.
- Schema contract tests feed malformed Kick, 7TV, BTTV, FFZ, worker, chat, and persisted records. They assert no cache admission, correct partial or failed state, redacted diagnostics, and no platform-health spillover.
- Packaged-app failure injection runs the research matrix. It captures attempts, elapsed time, operation ID, visible state, preserved intent, focus, live announcement, abnormal restart, and diagnostic redaction. Unit tests alone do not close the migration.

The planned throughput checkpoint is the route inventory. It reports the remaining direct registrations, contracts, decoders, and boundary test cases per feature after every migration unit. It turns a long sweep into a measurable release condition.

The registry is deep because one `handle(route)` call hides sender validation, parsing, cancellation setup, response validation, safe mapping, and telemetry. `runBoundedRead` is deep because one adapter call hides deadline and retry mechanics. Feature code still exposes its own meaningful `ListView` and domain operation. There is no generic workflow service, no universal request object in business code, and no pass-through chain that forces a reader through an all-purpose reliability framework.

## Synthesis decision

Candidate B is the decentralized standards design. Its base is a mandatory IPC gate plus a read-only attempt primitive. It rejects a single `ReliabilityService` that would own caching, provider fan-out, UI state, writes, startup, and every protocol. The registry adopts the strongest part of the current `registerTrustedIpcHandler`. The operation lease adopts the request-ID cancellation shown by search and chat replay. The feature-level `ListView` extends `DiscoveryResult` without pretending that every data shape is discovery. This keeps the public interface small while hiding the difficult mechanics where they belong.

The decision follows Foundational Thinking by defining serialization-safe result and operation shapes before moving handlers. Boundary Discipline and Type System Discipline place parsing at IPC, provider, and persistence entry points and make false empty states harder to construct. Model the Domain makes data availability an exhaustive union instead of a cluster of booleans. Make Operations Idempotent keeps automatic retries out of writes and makes migration and startup recoverable. Experience First selects scoped recovery, last-good data, and useful error actions over a tidy but generic loading system. Laziness Protocol and Minimize Reader Load reject an application-wide framework and keep calls within a few files. Build the Lever makes the inventory and fault harness the evidence for a 188-route migration. Sequence Work into Verifiable Units makes each feature migration end in a concrete check.

## Tradeoffs accepted

- We accept one local schema declaration per route in exchange for rejecting malformed requests and responses before they touch feature code.
- We accept a one-time registration sweep before the final release in exchange for no permanent unsafe handler compatibility path.
- We accept a small operation envelope on cancellable reads in exchange for one deadline and cancellation path across renderer, IPC, queues, and response bodies.
- We accept Query no longer retries reads automatically in exchange for eliminating retry multiplication and making platform adapters the only retry owners.
- We accept visible `partial` and `stale` states in exchange for never telling users that known data is complete or empty when a provider failed.
- We accept a minimal recovery window and journal in exchange for allowing startup when the normal persistence stack cannot initialize.
- We accept local schema files beside adapters in exchange for keeping vendor payload types and Zod runtime code out of `shared/`.

## Alternatives considered

- A universal `ReliabilityService` that wraps every IPC call, cache, provider fan-out, retry, recovery boundary, and write. It hides a lot, but its public surface would expose feature policy through options and make every feature depend on a central scheduler. It loses on interface depth because callers must learn its policy knobs as well as their own domain.
- Retrying only in React Query. Its interface is small, but it cannot cancel main-process queues or body reads, honor platform rate headers, parse vendor responses, or distinguish safe reads from unknown writes. It exposes the wrong transport details to UI callers.
- Keeping `registerTrustedIpcHandler` as an opt-in security helper. Its interface is simple, but it hides nothing from the majority of handlers because every feature still has to remember whether to use it. It loses on enforcement, not implementation effort.
- Expanding `RobustHttpClient` into the mandatory transport for every protocol. It would centralize too much protocol-specific behavior and would either leak vendor choices through options or force special cases into one client. Candidate B keeps a shared read primitive while adapters retain transport-specific details.

## Open questions and risks

- Which existing invoke channels are genuine writes, reads, lifecycle controls, or push-only channels, and which of them need an explicit operation envelope?
- Which current Kick internal endpoints can expose a safe platform idempotency key, and which must remain `unknown` until durable reconciliation completes?
- What is the product's maximum useful deadline for foreground browse, background refresh, image, chat-history, and media metadata reads?
- Which workspace fields are safe and sufficient to restore after a renderer crash without persisting a stream URL, chat draft, or personal path in the recovery journal?
- Can the recovery window use a separate static page without violating the current packaging and preload build assumptions?
- Which existing platform-health signals should lease retry budget tokens, and how will thumbnail and background work yield to a user click?
- Does the route inventory need to model test-only handlers and development fixtures separately from packaged invoke channels?

## Next implementation step

Add `shared/reliability-types.ts`, `backend/ipc/trusted-registry.ts`, and the route-inventory test, then port `IPC_FEATURE_LOAD` and the existing user-profile routes through that gate before touching another feature.
