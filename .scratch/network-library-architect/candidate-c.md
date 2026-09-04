# Candidate C. Chromium-session network boundary, no selector yet

## Problem

Xtra exposes three Android engines because every selectable engine can serve its supported Android request classes. StreamFusion cannot truthfully copy that control. Renderer `fetch`, HLS.js media loads, `net.fetch`, and `Session.fetch` already use Chromium. Several main-process paths still use Node global `fetch`, including `http-client.ts`, OAuth work in `token-exchange.ts`, and parts of `twitch-manifest-proxy.ts`. `session.defaultSession.setProxy` does not govern Node global `fetch`.

A visible `Network library` selector would therefore either be cosmetic or make a configured proxy silently ineffective for selected requests. Do not ship the selector in this increment. First establish one main-process request boundary that always uses the window's Chromium session. The future selector is earned only by a second transport that has equivalent proxy, credential, cancellation, redirect, and test behavior for its declared scope.

This gives a useful desktop outcome now. When HTTP proxy is enabled, migrated OAuth, Twitch and Kick API, manifest, and first-party image requests follow the same Chromium proxy configuration as renderer traffic. Existing renderer HLS and WebSocket behavior does not change.

## Usage from callers

Callers never inspect a persisted transport preference. They receive one application fetch function.

```ts
// backend/auth/token-exchange.ts
export function createTokenExchangeService(network: AppNetwork) {
  return {
    exchangeCodeForToken: (params: TokenExchangeParams) =>
      network.fetch(getOAuthConfig(params.platform).tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(toTokenExchangeBody(params)),
      }),
  };
}
```

```ts
// backend/services/http-client.ts
const client = createRobustHttpClient({ fetch: appNetwork.fetch });

await client.fetch("https://gql.twitch.tv/gql", gqlInit, retryOptions);
```

```ts
// backend/services/twitch-manifest-proxy.ts
const manifestProxy = new TwitchManifestProxy({ fetchUpstream: appNetwork.fetch });
```

The renderer does not receive `AppNetwork`, a raw token, a proxy credential, or a transport name. It continues to use browser `fetch`, HLS.js, and existing IPC calls. Dedicated direct partitions remain owned by the small modules that need them, such as Kick CDN handling. They are explicit product exceptions and never a fallback selected by a caller.

## Shape

```ts
// backend/services/app-network.ts
export type AppNetwork = Readonly<{
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}>;

export type ChromiumSessionPort = Pick<Electron.Session, "fetch">;

export function createAppNetwork(session: ChromiumSessionPort): AppNetwork {
  return {
    fetch: (input, init) => session.fetch(input, init),
  };
}
```

`AppNetwork` is deliberately a one-method domain boundary. It hides the selected implementation, Electron `Session`, and future proxy-agent mechanics. The initial production instance is created from `session.defaultSession` after Electron is ready. It uses the same session that `stream-proxy-service.ts` configures. No `transport`, `proxy`, `agent`, or `session` option is exposed to API, auth, manifest, or retry callers.

The named data shape is `AppNetwork`. It has one invariant. Every ordinary main-process outbound HTTP request uses its Chromium session. Electron owns proxy routing for that session. `stream-proxy-service.ts` remains the only owner of proxy endpoint changes and `safeStorage` credentials.

The boundary parses no payloads and stores no secrets. It accepts the browser-standard `RequestInfo` and `RequestInit` types because its purpose is execution, not a second HTTP protocol. External input validation stays at existing IPC and OAuth boundaries. Typed request construction and retry policy stay with their current domain modules. This follows boundary discipline.

`createRobustHttpClient` changes its constructor dependency from an implicit global fetch to a required `FetchLike`. Its queue, retries, and circuit breaker remain policy above `AppNetwork`, rather than becoming a second transport wrapper. Existing tests pass a fake `FetchLike`.

```ts
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export function createRobustHttpClient(deps: { fetch: FetchLike }): RobustHttpClient;
```

Use a per-service factory or an explicit constructor dependency for modules currently imported as singletons. Do not change global `fetch`. A global monkey patch hides policy, affects test isolation, and can accidentally route development-only traffic.

The interface is deep. One `fetch` call hides session selection and therefore Chromium DNS, TLS, cache, cookies, proxy rules, proxy authentication, and future transport selection. Callers retain only request semantics. This follows model-the-domain and minimize-reader-load.

## Request-class contract

| Request class | After migration | Network-library setting claim |
| --- | --- | --- |
| Renderer fetch, renderer images, HLS.js master and media playlist loads | Existing Chromium window session | Fixed Chromium. Not selectable. |
| Renderer WebSockets and socket clients | Existing browser or socket implementation | Not controlled by this boundary or any future HTTP selector. |
| Main OAuth, token validation, Twitch Helix and GQL, Kick REST | `AppNetwork` over `defaultSession.fetch` | Chromium session in this increment. |
| Main Twitch manifest proxy and robust HTTP client | `AppNetwork` injected as `FetchLike` | Chromium session in this increment. |
| `net.fetch` callers | Chromium already | Migrate only for consistency when they need shared retry or observability. They are proxy-aware today. |
| Dedicated Kick CDN direct partition | Its existing direct `Session.fetch` | Explicit direct exception. It is never a failure fallback and remains documented in Proxy settings. |

The proxy applies before ordinary requests start. A proxy failure returns the existing apply error and leaves the default session direct, which is the current safe recovery behavior. Once a proxy applies successfully, `AppNetwork` cannot bypass it because it has no Node implementation or direct-session switch. A transport fallback must never turn a proxy-routed request into a direct request.

## Module map

`apps/desktop/src/backend/services/app-network.ts` owns the small Chromium-session boundary and its test factory.

`apps/desktop/src/backend/main.ts` creates the production `AppNetwork` after `app.whenReady()` and supplies it to startup-owned service factories.

`apps/desktop/src/backend/services/stream-proxy-service.ts` remains the sole owner of `defaultSession.setProxy`, connection closing, safeStorage credential persistence, and the proxy-auth callback.

`apps/desktop/src/backend/auth/token-exchange.ts`, `twitch-auth.ts`, and `kick-auth.ts` accept `AppNetwork` through their existing construction root. They retain tokens locally and return only existing token-status metadata across IPC.

`apps/desktop/src/backend/services/http-client.ts` requires an injected `FetchLike`. Its retry queue and circuit breaker remain unchanged.

`apps/desktop/src/backend/services/twitch-manifest-proxy.ts` accepts the same injected fetch dependency for every upstream HTTP request. It does not choose a transport itself.

`apps/desktop/src/backend/api/platforms/**` progressively receives `AppNetwork` through its platform client factories. Delete a direct global-fetch path only after every caller has migrated.

Do not add a renderer preference, preload API, IPC channel, or `UserPreferences.networkLibrary` field in this increment. A setting whose only value is Chromium is misleading.

## Rollout and migration

1. Add `app-network.ts`, its fake-session unit tests, and one composition-root factory. It changes no caller behavior yet. Verify it calls only the supplied `Session.fetch`.
2. Change `http-client.ts` and `twitch-manifest-proxy.ts` to accept `FetchLike`. Migrate their composition roots and run their existing retry and manifest suites with fake fetches.
3. Migrate auth and token-status services, then Twitch and Kick API factories. Each migration ends with a repository check that its former global-fetch call is gone and targeted tests are green.
4. Inventory remaining `globalThis.fetch` and bare `fetch` calls. Migrate every ordinary main-process HTTP path to `AppNetwork`. Preserve only documented renderer paths, test seams, development relay plumbing, or named direct partitions. A CI guard rejects new ordinary main-process global fetches.
5. Correct Proxy settings copy. It covers Chromium window-session traffic and migrated main HTTP work. It does not control dedicated direct partitions, arbitrary Node sockets, or WebSockets.
6. Revisit the selector only after a measured interoperability incident defines a second transport's request-class scope and it passes the parity suite below. The selector default remains Chromium. Existing installations need no preference migration because no preference is stored first.

This sequence follows foundational thinking and sequence-verifiable-units. Each commit makes one boundary or caller set testable. There is no temporary persisted preference or compatibility branch to later remove.

## Deterministic tests

- `app-network.test.ts` uses a fake `ChromiumSessionPort`. Assert input and init reach `session.fetch`, and assert no test path invokes global fetch.
- `stream-proxy-service.test.ts` keeps its fake default session. Assert a valid proxy calls `setProxy` before `closeAllConnections`. Assert disable and invalid input set direct mode.
- A composition test builds `AppNetwork` from the same fake default session passed to proxy setup. It applies a proxy, calls token exchange, GQL client, and manifest proxy through injected fakes, and asserts every request used that session's `fetch`.
- Retry tests inject a deterministic fake that fails twice then returns a response. Assert `RobustHttpClient` retries without replacing the injected fetch with global fetch.
- OAuth and token-status tests use local fake responses. Assert authorization headers are observed by the fake only and token strings never appear in IPC result fixtures or logs.
- Add a static Vitest test or repository script that scans backend production sources. It permits an allowlist of boundary implementation, Electron `net.fetch`, named direct-session modules, and test injection declarations. It fails on new ordinary `globalThis.fetch` or bare `fetch` calls. This is the lever that prevents proxy regressions without public services.
- Renderer playback tests remain separate. They assert HLS configuration still uses renderer loaders and make no promise that `AppNetwork` controls HLS or WebSockets.

## Rationale and synthesis decision

Candidate C chooses a Chromium-only internal boundary over an immediate two-engine setting. It is the only shape that satisfies the current proxy invariant without introducing a Node proxy stack, a second session policy, or per-caller transport branches. It fixes a real inconsistency now and leaves a narrow seam for later evidence.

Foundational thinking changed the rollout. The shared `AppNetwork` type and composition root come before migrations.

Model the domain changed the interface. A one-method request boundary models ordinary main-process egress instead of adding a `networkLibrary` conditional to every API module.

Boundary discipline changed ownership. Proxy credentials and proxy policy remain main-owned in `stream-proxy-service.ts`, while the new client only executes typed requests.

Type-system discipline changed the API. The transport is not a string field or an optional function. A constructed `AppNetwork` is the only ordinary egress capability.

Minimize reader load changed the module count. There is one boundary rather than separate selector, resolver, adapter, and proxy wrapper layers.

## Tradeoffs accepted

- We accept no user-visible Network library selector now in exchange for truthful scope and no proxy bypass.
- We accept one Chromium transport for migrated main requests in exchange for shared session behavior with playback and renderer fetch.
- We accept explicit dependency injection in legacy singleton services in exchange for deterministic tests and no global monkey patch.
- We accept retaining named direct partitions in exchange for preserving their existing product behavior. They must stay explicit and cannot be used as failure fallback.

## Alternatives considered

1. Ship `Chromium` and `Node` choices now. It loses because Node global fetch bypasses Electron session proxy rules. Giving callers a transport value also leaks an implementation decision across every request path.
2. Add a Node `ProxyAgent` and switch main requests by preference. It could become a future second transport, but it loses now because it creates separate TLS, DNS, redirect, cookie, proxy-auth, cancellation, and package lifecycle behavior while leaving renderer HLS fixed on Chromium. Its larger public scope hides less complexity from callers.
3. Use multiple Electron sessions for per-class Twitch proxy toggles. It loses because HLS renderer loads are tied to the window session and the controls would still not govern WebSockets. The session assignment would leak request-class policy across callers.
4. Keep global fetch and amend Settings copy. It loses because documentation does not prevent a real proxy-routing gap.

## Open questions and risks

- Which remaining direct `fetch` paths are product-required direct egress, rather than unintentional Node bypasses? The migration inventory must name each one before it is retained.
- Does Electron 43 `Session.fetch` preserve every request-init behavior used by the current Node paths, especially stream bodies and any Node-specific dispatcher option? The targeted migration tests must prove each affected call site.
- Should explicit direct partitions be shown in Proxy Settings as exclusions? The design recommends yes, because users otherwise cannot understand why a request is not proxied.
- A future second transport needs a written parity matrix and measured user problem before a selector ships. Without both, Chromium remains the only valid desktop behavior.

## Next implementation step

Add the tested `AppNetwork` factory and migrate `RobustHttpClient` to a required injected `FetchLike` before moving OAuth or platform callers.
