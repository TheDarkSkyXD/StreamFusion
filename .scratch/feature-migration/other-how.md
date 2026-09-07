# Other-runtime feature migration inventory

## Scope and ownership

| Runtime | Source | Tests | Implemented feature roots | Bootstrap/shared infrastructure |
| --- | ---: | ---: | --- | --- |
| Mobile | 30 | 8 | `shell`, `activity`, `diagnostics`, `storage` | Expo routes, mobile composition root, design tokens, tooling, vendor compatibility |
| Worker | 1 | 1 | `kick-oauth` | Wrangler entry facade/configuration and smoke tooling |
| Integration Relay | 2 | 2 | none | Environment-isolated Worker baseline and Relay protocol boundary |
| Core package | 21 | 10 | `activity`, `auth`, `chat`, `content`, `discovery`, `follows`, `reliability` | `platform`, `relay`, foundations, test support, public export facades |

The target roots in the manifest are runtime-local: `apps/mobile/src/features/<feature>/`, `apps/worker/src/features/<feature>/`, and `packages/core/src/features/<feature>/`. `packages/core` remains a shared public-contract package. Its feature roots must be reached through the declared `@streamfusion/core/<subpath>` exports; runtime features must not import Core feature internals.

The Integration Relay has deliberately not received feature roots. Its context describes future reads, webhooks, chat, notifications, manifests, and health, but current source only validates the deployment environment then emits a versioned `not_found` or `unavailable` envelope. The tests explicitly prove those product endpoints do not exist. Creating a `discovery`, `webhooks`, `chat`, or `notifications` feature here would manufacture planned scope.

## Traced flows

### Mobile shell and deep links

Expo enters at `app/index.tsx`, which delegates to `src/composition/mobile-runtime.tsx`. The composition root creates an Expo Linking source, encrypted storage runtime, and diagnostics controllers, then renders `AppShell`. `AppShell` subscribes through the `AppLinkSource` capability. The Expo adapter obtains URLs, the allowlisted parser accepts only `streamfusion:`/`streamfusion-development:` Activity and Watch destinations, and shell lifecycle policy applies the initial URL before queued user navigation. Shell navigation keeps one capped history per destination, serializes only allowlisted locations, and restores from the Product Store through `ShellRestorationRepository`.

The shell feature therefore owns the presentation, deep-link port, Expo adapter, parser, lifecycle controller, and navigation policy. Routes remain in `app/`, because Expo Router requires them. The global composition root remains outside a feature because it wires Shell, Storage, and Diagnostics together.

### Mobile activity and storage

`AppShell` renders Activity with the `ActivityRepository` supplied by the storage runtime. The Activity controller reads items and invokes the retry-safe Activity domain operations. `ProductStore` implements the repository, records and deduplicates Activity items, stores shell restoration, and runs against the encrypted Product database.

Storage initializes independent Product and Cache stores. Its composition wires Expo SecureStore and Expo Crypto adapters to the SQLite/SQLCipher driver. Product migrations, integrity checks, encrypted backup, quarantine, and recovery run inside the storage feature; Cache entries are independently migrated and evicted. The storage capability is intentionally exported for Shell, Activity, and Diagnostics. That is a feature-to-feature port, not a reason to place database implementation in Shell or Activity.

### Mobile diagnostics

The diagnostics controller reads Expo app metadata and checks runtime probes. The runtime composition creates the metadata adapter, fetch probe, and volatile-persistence probe. The diagnostics persistence controller turns `MobilePersistenceRuntime` state and the isolated native proof into a UI model. This is an implemented device-health and storage-recovery surface even though the old directory calls it `development`.

### Worker Kick OAuth

Wrangler invokes `src/index.ts`. A thin replacement should delegate to `kick-oauth` composition. The route accepts only POST token and refresh paths, applies IP rate limiting, validates JSON grants, hashes authorization-code/refresh-token subjects for a second limiter, then calls Kick's token endpoint with the Worker-held client secret. The adapter uses a ten-second abort deadline and validates a narrow upstream success/error schema. The route maps only allowed OAuth errors and stable availability/timeout/invalid-response errors with `Cache-Control: no-store`.

This is one implemented feature. The current single file needs a responsibility split before or while moving; the manifest records the required destinations. The Worker never proxies product reads or chat.

### Integration Relay baseline

Wrangler invokes `src/composition/worker.ts`. The worker generates a request ID, rejects an absent/unrecognized `RELAY_ENVIRONMENT` with a shared `unavailable` envelope, and otherwise returns a shared `not_found` envelope. `wrangler.jsonc` keeps development and production names/configuration distinct. Its verifier asserts both environments have no resource declarations before a product ticket, and the secret-boundary verifier scans relay and shared Relay code.

Keep this baseline thin. A future feature may add a root only after its endpoint, contracts, adapters, data model, and tests actually land.

### Shared Core package

Core provides provider-neutral contracts and workflows used by runtimes: OAuth lifecycle, chat send policy, content values, bounded discovery, follows/live notification policy, Activity values, and reliability. `platform`, serialization foundations, test support, and the versioned Relay envelope are shared infrastructure. Existing public subpaths such as `@streamfusion/core/discovery` must remain stable façades after internal implementation moves into feature roots.

## Required tooling changes

Mobile and Core ESLint boundary settings classify flat legacy directories, and their architecture-proof scripts create temporary files in those directories. Both need feature-layer element definitions and proof cases for the nine target folders. Mobile's Vitest include currently matches only `tests/**/*.test.ts`; move it to feature test roots while retaining explicit integration/tooling tests if kept outside features. Mobile TypeScript's `src/**/*.ts(x)` globs already cover nested feature code.

Worker has no ESLint configuration or lint script. Its TypeScript `src/**/*.ts` glob already covers nested roots, but `vitest.config.mts` must discover `src/features/**/tests/**/*.test.ts`. Keep Wrangler's `main` on a thin `src/index.ts` facade.

Relay needs no relocation, ESLint, test-discovery, or Wrangler-main change at this stage. Its current checks intentionally protect the no-product-endpoint baseline.

Core needs feature-aware ESLint boundaries, rewritten architecture proofs, and a combined Node test pattern for `src/features/*/tests/*.test.mjs` plus retained package-boundary tests. Preserve every declared package export as a façade and keep Core's runtime-import prohibitions unchanged.
