# Other-runtime migration decision

## A. Flat runtime layers

Keep `src/capabilities`, `src/adapters`, `src/persistence`, and `src/features` as peer directories. This preserves the current import shapes but makes feature ownership implicit: a Shell change, its deep-link port, Expo adapter, parser, and tests live in five unrelated folders.

## B. Runtime-local feature roots with stable bootstraps and exports

Put each implemented runtime capability under `src/features/<feature>/` with the nine responsibility directories. Retain Expo route declarations and the Mobile composition root, retain Wrangler's thin `src/index.ts` entry, and retain every public `@streamfusion/core/<subpath>` facade. Composition wires feature ports to concrete adapters; feature internals are not public runtime/package APIs.

## Selection

Select B. It makes ownership and tests local while preserving required framework/package entrypoints. The Worker is additionally split because its old single entry mixes transport, grant validation, rate-limit binding use, Kick HTTP, response translation, and construction.
