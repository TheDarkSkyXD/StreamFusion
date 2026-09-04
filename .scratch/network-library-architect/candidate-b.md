# Candidate B: capability-resolved desktop network engine

## Problem

Xtra's `Network library` setting is an Android HTTP-engine selector. StreamFusion cannot copy the labels or the scope because Electron already splits traffic across Chromium session networking, Electron `net.fetch`, `Session.fetch`, renderer HLS fetch/XHR, Node global `fetch`, and WebSockets. The useful desktop version is a selector for main-owned HTTP calls, backed by a route policy that refuses to bypass the configured session proxy. The selector must not claim control over renderer HLS media loads or chat sockets.

## Usage (caller's view)

Settings stores one preference.

```ts
await window.electronAPI.preferences.update({
  network: { engine: "chromium-session" },
});

const status = await window.electronAPI.network.getStatus();
```

The Settings copy should read like this.

```text
Network engine

Controls main-process API, OAuth, GraphQL, manifest, image, and metadata HTTP requests that StreamFusion owns. Video playback in the renderer and chat WebSockets keep their fixed transports.

Chromium session
Uses Electron's Chromium network stack and the app proxy when enabled.

Node compatibility
Uses Node fetch for routable main-process requests when the app proxy is off. Requests that require cookies, Chromium compatibility, or the app proxy stay on Chromium.
```

Twitch GQL callers stop importing `fetch`.

```ts
const responses = await networkClient.jsonTuple({
  class: "twitch-gql-public",
  url: "https://gql.twitch.tv/gql",
  method: "POST",
  headers: {
    "Client-Id": GQL_CLIENT_ID,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(queries),
  timeoutMs: 10_000,
  maxBytes: 2_000_000,
});
```

OAuth callers keep raw tokens in main and only change the transport boundary.

```ts
const response = await networkClient.json<TokenResponse | TokenError>({
  class: "oauth-token",
  platform: params.platform,
  url: refreshEndpoint,
  method: "POST",
  headers: {
    "Content-Type": isTwitch ? "application/x-www-form-urlencoded" : "application/json",
    Accept: "application/json",
  },
  body,
  timeoutMs: 15_000,
  maxBytes: 256_000,
});
```

The manifest proxy uses the same boundary and marks its request class as proxy-covered.

```ts
const playlist = await networkClient.text({
  class: "twitch-hls-manifest-proxy",
  url: details.url,
  timeoutMs: 2_000,
  retry: { attempts: 2, baseDelayMs: 200 },
});
```

Kick callers that depend on Chromium stay boring. The caller still asks for data. The route table picks Chromium because the class requires it.

```ts
const response = await networkClient.json<KickApiResponse>({
  class: "kick-official-api",
  platform: "kick",
  url: `${KICK_API_BASE}${endpoint}`,
  method,
  headers,
  body,
  timeoutMs: 15_000,
});
```

## Shape

The named data shape is `DesktopNetworkRoute`. It is the single source of truth for what the setting can affect.

```ts
export type NetworkEnginePreference = "chromium-session" | "node-compat";

export interface NetworkPreferences {
  engine: NetworkEnginePreference;
}

export type NetworkRequestClass =
  | "oauth-token"
  | "token-validation"
  | "twitch-helix"
  | "twitch-gql-public"
  | "twitch-playback-token"
  | "twitch-hls-manifest-proxy"
  | "twitch-playlist-fetch"
  | "twitch-image"
  | "twitch-clip-media"
  | "kick-official-api"
  | "kick-web-api"
  | "kick-cdn-image"
  | "emote-rest"
  | "status-page";

export type FixedNetworkClass =
  | "renderer-hls-playback"
  | "renderer-fetch"
  | "chat-websocket"
  | "eventsub-websocket";

export type TransportEngine = "chromium-session" | "node-fetch" | "direct-session";

export type ProxyCoverage =
  | { kind: "uses-app-proxy-when-enabled" }
  | { kind: "must-bypass-app-proxy"; reason: string }
  | { kind: "not-covered"; reason: string };

export type RouteConstraint =
  | { kind: "preference-routable" }
  | { kind: "requires-chromium"; reason: string }
  | { kind: "requires-direct-session"; partition: string; reason: string };

export interface DesktopNetworkRoute {
  class: NetworkRequestClass;
  defaultEngine: TransportEngine;
  constraint: RouteConstraint;
  proxyCoverage: ProxyCoverage;
  concurrencyKey: "origin" | "kick-global" | "none";
}

export type EffectiveNetworkRoute =
  | {
      kind: "routed";
      class: NetworkRequestClass;
      requestedEngine: NetworkEnginePreference;
      engine: TransportEngine;
      proxyApplied: boolean;
      reason?: "proxy-enabled" | "class-requires-chromium" | "class-requires-direct-session";
    }
  | {
      kind: "fixed";
      class: FixedNetworkClass;
      reason: string;
    };
```

The public main-process interface stays small.

```ts
export interface DesktopNetworkClient {
  response(request: NetworkRequest): Promise<NetworkResponse>;
  text(request: NetworkRequest): Promise<string>;
  json<T>(request: NetworkRequest): Promise<T>;
  jsonTuple<T extends readonly unknown[]>(request: NetworkRequest): Promise<T>;
  getStatus(): NetworkStatusSnapshot;
}

export interface NetworkRequest {
  class: NetworkRequestClass;
  platform?: Platform;
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs: number;
  maxBytes?: number;
  retry?: NetworkRetryPolicy;
  signal?: AbortSignal;
}

export interface NetworkRetryPolicy {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  retryStatuses?: readonly number[];
}

export interface NetworkResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface NetworkStatusSnapshot {
  preference: NetworkPreferences;
  effectiveDefault: NetworkEnginePreference;
  proxy: {
    enabled: boolean;
    appliedTo: "chromium-session";
  };
  routable: Array<{
    class: NetworkRequestClass;
    requestedEngine: NetworkEnginePreference;
    effectiveEngine: TransportEngine;
    proxyApplied: boolean;
    reason?: EffectiveNetworkRoute["reason"];
  }>;
  fixed: Array<{
    class: FixedNetworkClass;
    reason: string;
  }>;
}
```

The route resolver is pure.

```ts
export function resolveNetworkRoute(input: {
  requestClass: NetworkRequestClass;
  preference: NetworkPreferences;
  proxyEnabled: boolean;
}): EffectiveNetworkRoute;
```

The policy table carries the real desktop constraints. This excerpt shows the load-bearing entries; implementation should enumerate every `NetworkRequestClass`.

```ts
export const DESKTOP_NETWORK_ROUTES = {
  "twitch-gql-public": {
    class: "twitch-gql-public",
    defaultEngine: "chromium-session",
    constraint: { kind: "preference-routable" },
    proxyCoverage: { kind: "uses-app-proxy-when-enabled" },
    concurrencyKey: "origin",
  },
  "oauth-token": {
    class: "oauth-token",
    defaultEngine: "chromium-session",
    constraint: { kind: "preference-routable" },
    proxyCoverage: { kind: "uses-app-proxy-when-enabled" },
    concurrencyKey: "origin",
  },
  "twitch-hls-manifest-proxy": {
    class: "twitch-hls-manifest-proxy",
    defaultEngine: "chromium-session",
    constraint: { kind: "preference-routable" },
    proxyCoverage: { kind: "uses-app-proxy-when-enabled" },
    concurrencyKey: "origin",
  },
  "kick-official-api": {
    class: "kick-official-api",
    defaultEngine: "chromium-session",
    constraint: { kind: "requires-chromium", reason: "Kick API compatibility depends on Electron networking." },
    proxyCoverage: { kind: "uses-app-proxy-when-enabled" },
    concurrencyKey: "kick-global",
  },
  "kick-cdn-image": {
    class: "kick-cdn-image",
    defaultEngine: "direct-session",
    constraint: {
      kind: "requires-direct-session",
      partition: "persist:kick-cdn-direct",
      reason: "Kick CDN image requests intentionally bypass the app proxy.",
    },
    proxyCoverage: { kind: "must-bypass-app-proxy", reason: "Current image workaround uses a direct CDN partition." },
    concurrencyKey: "kick-global",
  },
} satisfies Partial<Record<NetworkRequestClass, DesktopNetworkRoute>>;
```

If the user picks `node-compat` while the proxy is enabled, `resolveNetworkRoute` returns Chromium for any route with `proxyCoverage.kind === "uses-app-proxy-when-enabled"`. That makes bypass impossible by construction. The status snapshot exposes the forced route so Settings can say the effective engine is Chromium for proxy-covered classes.

This is a deep module because one call hides engine selection, timeout composition, retry, response-byte limits, concurrency gates, Chromium session choice, and proxy-safety policy. The public surface is one request object plus three result helpers. Callers no longer coordinate `fetch`, `net.fetch`, `session.fetch`, `AbortSignal.timeout`, bounded response reading, and proxy rules themselves.

Invariants encoded in types:

- Fixed classes cannot be passed to `networkClient.response`.
- A request always names its class.
- Node compatibility is a preference, not a guaranteed engine.
- Effective routing records the requested engine and actual engine separately.
- Direct sessions are represented only through route policy, not caller-selected strings.

Validation lives at boundaries. IPC parses the preference. The network client validates URL protocol and response size. Internal callers receive typed results and do not re-check proxy safety. This follows `principle-model-the-domain`, `principle-boundary-discipline`, `principle-type-system-discipline`, `principle-laziness-protocol`, and `principle-minimize-reader-load`.

## Module map

```text
apps/desktop/src/shared/auth-types.ts
  Adds NetworkPreferences and DEFAULT_NETWORK_PREFERENCES.

apps/desktop/src/shared/ipc-channels.ts
  Adds NETWORK_GET_STATUS and NetworkStatusSnapshot types.

apps/desktop/src/backend/services/desktop-network/
  index.ts
    Exports networkClient and status helpers.
  network-route-policy.ts
    Owns DesktopNetworkRoute, DESKTOP_NETWORK_ROUTES, resolveNetworkRoute.
  desktop-network-client.ts
    Applies route policy, timeout, retry, byte limit, and error classification.
  transports.ts
    Owns ChromiumSessionTransport, NodeFetchTransport, DirectSessionTransport.
  network-concurrency.ts
    Replaces RobustHttpClient's Twitch origin queue and Kick global semaphore over time.

apps/desktop/src/backend/ipc/handlers/network-handlers.ts
  Exposes getStatus. It returns capability metadata only.

apps/desktop/src/backend/services/stream-proxy-service.ts
  Remains the owner of proxy application and credentials. Exposes a metadata-only proxy state reader to desktop-network.

apps/desktop/src/backend/api/platforms/twitch/
  twitch-requestor.ts, twitch-gql-client.ts, twitch-public-profile-reader.ts, twitch-gql-pin-mutations.ts, twitch-eventsub-client.ts
    Migrate owned HTTP calls to networkClient by class. EventSub WebSocket stays fixed.

apps/desktop/src/backend/api/platforms/kick/
  kick-client.ts, endpoints/*.ts, kick-session-request.ts
    Migrate direct fetch and net.fetch calls to networkClient only where the route table preserves the current Chromium or direct-session requirement.

apps/desktop/src/backend/auth/
  token-exchange.ts, twitch-auth.ts, kick-auth.ts, device-code-flow.ts
    Migrate token and validation requests. Raw tokens remain main-owned.

apps/desktop/src/backend/services/
  http-client.ts
    Deleted after its queue/retry behavior moves into desktop-network.
  twitch-manifest-proxy.ts, twitch-playlist-fetch-service.ts
    Route main-owned manifest and playlist fetches through networkClient.

apps/desktop/src/backend/preload/index.ts
  Adds window.electronAPI.network.getStatus.

apps/desktop/src/frontend/pages/Settings/index.tsx
  Adds the selector and accurate scope summary. Proxy copy changes from "Twitch traffic" to "Chromium-session traffic".
```

## Rollout

1. Add the shared `network` preference with default `{ engine: "chromium-session" }`. Hydrate invalid or missing stored values back to Chromium. No caller migration yet.
2. Add `desktop-network` with fakeable transports and the pure route resolver. Wire `network.getStatus`. The selector can be hidden behind a dev flag until at least Twitch GQL and OAuth use it.
3. Migrate `token-exchange.ts`, `device-code-flow.ts`, and token validation first. These are compact call sites and prove OAuth still works without crossing the preload boundary.
4. Migrate `twitch-gql-client.ts` and `twitch-manifest-proxy.ts`. This gives the setting real behavior for Twitch GQL and playback-token-adjacent requests.
5. Move `http-client.ts` queue, retry, circuit breaker, and bounded body behavior into `desktop-network-client.ts`, then delete `http-client.ts`.
6. Migrate Kick routes without changing their effective transport. `kick-official-api` remains Chromium. `kick-cdn-image` remains the direct partition.
7. Show the Settings selector once status reports at least two preference-routable classes migrated. The visible control is honest because `node-compat` changes real main-owned requests when the proxy is off.
8. Update Settings proxy copy to state that the proxy applies to Chromium-session requests and fixed renderer HLS, but not Node compatibility routes when the proxy is off and not direct-session exceptions.

Every phase is idempotent. Startup reads stored preference and proxy state, computes routes, and leaves no mutable engine state to reconcile. Re-running migration steps either routes the same caller through the same class or leaves it untouched.

## Deterministic tests

Add `apps/desktop/tests/backend/services/desktop-network/network-route-policy.test.ts`.

- Guards: `node-compat` with proxy off routes `twitch-gql-public`, `oauth-token`, and `twitch-hls-manifest-proxy` to Node.
- Guards: `node-compat` with proxy on forces every `uses-app-proxy-when-enabled` class to Chromium and reports `reason: "proxy-enabled"`.
- Guards: Kick official API always resolves to Chromium.
- Guards: Kick CDN image always resolves to the direct partition and never claims app-proxy coverage.
- Guards: fixed classes are present in status but cannot be requested through the client.

Add `apps/desktop/tests/backend/services/desktop-network/desktop-network-client.test.ts`.

- Inject fake transports and assert only the effective transport receives the request.
- Assert timeout and caller abort compose into one signal.
- Assert byte limit failure happens before JSON parse.
- Assert retry covers configured 502/503/504 responses and retryable network failures.
- Assert no retry on caller abort or 4xx.

Add `apps/desktop/tests/backend/ipc/handlers/network-handlers.test.ts`.

- Assert disallowed sender origins receive no private data and do not mutate preferences.
- Assert the status payload has no token, password, proxy username, or proxy host if the product decision is to hide host from this panel.

Extend `apps/desktop/tests/backend/services/stream-proxy-service.test.ts`.

- Assert enabling proxy changes the route resolver's effective route for `node-compat` proxy-covered classes to Chromium.
- Assert clearing proxy lets `node-compat` become effective again.

Add focused migration tests beside touched callers.

- `twitch-gql-client.test.ts` asserts the GQL endpoint goes through `networkClient` with `class: "twitch-gql-public"`.
- `token-exchange.test.ts` asserts token refresh uses `class: "oauth-token"` and never exposes token values outside the existing return path.
- `twitch-manifest-proxy.test.ts` asserts manifest refetches use `class: "twitch-hls-manifest-proxy"`.

No test requires public Twitch, Kick, proxy, or CDN access. All transports are injected or mocked.

## Synthesis decision

Candidate B's base is a capability-resolved route table rather than a literal global engine switch. I chose it because it gives the user two meaningful desktop behaviors while making the effective engine explicit per request class. The design rejects a selector that directly toggles `fetch` versus `net.fetch` at each call site because it would spread proxy and compatibility rules through the codebase. It also rejects hiding the selector forever because StreamFusion has enough Node-fetch call sites to make a compatibility engine real after migration.

## Tradeoffs accepted

- We accept that `node-compat` is not universal in exchange for honest proxy and Chromium-cookie behavior.
- We accept a route-policy table in exchange for deleting scattered transport branches from callers.
- We accept one new IPC read channel in exchange for a Settings UI that can display effective behavior instead of guessing from preferences.
- We accept moving queue and retry behavior out of `http-client.ts` in exchange for one request boundary across Twitch GQL, OAuth, manifests, and selected platform APIs.
- We accept that the selector ships after the first migrations, not at preference-definition time, in exchange for avoiding a control that initially changes nothing.

## Alternatives considered

Literal Xtra labels lost. `HttpEngine`, `Cronet`, and `OkHttp` are Android engines. They hide no useful desktop capability, expose false implementation names to users, and would require fake mappings under the hood.

Session-only selector lost. A UI that only says "Chromium" and applies `session.defaultSession.setProxy` has no second behavior. It is just the existing proxy control with new words.

Per-request-class toggles lost. Token, multivariant playlist, and media playlist switches would expose implementation stages to callers and users. Electron's `setProxy` is session-wide, so those toggles would either lie or require separate sessions and custom loaders before they could work.

Full Node proxy engine lost for the first rollout. It could use Undici `ProxyAgent` or another proxy-aware dispatcher, but that would make proxy credentials available to a second subsystem and add a new dependency and auth path. The current credential owner is `stream-proxy-service`, and the safe first design keeps proxy-covered traffic on Chromium.

No selector yet was viable but weaker. It is technically safest, and the research note supports it if the team refuses a partial selector. It gives users no compatibility lever. The route-policy design earns the selector by making its limited scope visible and enforceable.

## Open questions and risks

- Should `node-compat` be hidden unless proxy is disabled, or shown with a status line that says proxy-covered requests are forced to Chromium while the proxy is on?
- Should the status panel show the configured proxy host, or only "proxy enabled" to avoid repeating sensitive-ish network configuration in renderer state?
- Do any current Node-fetch call sites depend on Undici-specific behavior that `net.fetch` or `Session.fetch` does not match?
- Should `status-page` polling ignore the user engine preference so outage detection always uses Chromium, or should it follow the preference so it diagnoses the selected stack?
- Will moving `http-client.ts` queue and circuit-breaker state into the shared network client change Twitch GQL timing enough to affect manifest ad-recovery?

## Red-flag screen

Shallow module check passes. Callers make one request call, while the module hides route selection, proxy safety, transport choice, retries, timeouts, body limits, and concurrency.

Information leakage check passes. Transport names are exposed only as Settings choices and status metadata. Wire response parsing stays behind caller-specific decode functions.

Temporal decomposition check passes. The module is organized around network route ownership and transport policy, not load, validate, transform, and save stages.

Pass-through check passes if callers migrate directly to `networkClient`. Do not add per-platform wrapper methods that mirror `json()` or `text()` without adding policy.

## Rubric fit

The selector has two meaningful desktop behaviors. `chromium-session` routes migrated main-owned HTTP through Electron's network stack and the app proxy. `node-compat` routes preference-routable main-owned calls through Node fetch when proxy is off.

The design names fixed request classes. Renderer HLS playback, renderer fetch, chat WebSockets, and EventSub WebSockets are reported as fixed and never claimed as controlled.

The session proxy remains effective. Proxy-covered routes are forced to Chromium when proxy is enabled, so selected Node compatibility cannot silently bypass it.

Token and credential boundaries remain intact. Raw tokens stay in auth services and storage. Proxy credentials stay in `stream-proxy-service`.

The migration is incremental and safe by default. The default is Chromium. The selector becomes visible only after migrated request classes prove real behavior.

The public interface is small. Callers pass a named request class and request data. Transport selection stays inside `desktop-network`.

## Next implementation step

Build `desktop-network/network-route-policy.ts` and its pure Vitest coverage first, then wire `network.getStatus` from the existing preference and proxy metadata.
