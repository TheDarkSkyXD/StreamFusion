# StreamFusion Internal API Reference

> Internal documentation for the platform-API integrations that power StreamFusion.
> Source code: [`apps/desktop/src/backend/api/`](../../src/backend/api/)

This wiki documents the **Kick** and **Twitch** REST/GraphQL surfaces consumed by the
desktop app — every endpoint we call, where it's called from, what auth it needs,
and the rate-limit / retry / fallback behaviour we wrap it in.

## 📚 Platforms

| Platform | Docs | Source folder |
|---|---|---|
| **Kick** | [`./kick/`](./kick/README.md) | [`platforms/kick/`](../../src/backend/api/platforms/kick/) |
| **Twitch** | [`./twitch/`](./twitch/README.md) | [`platforms/twitch/`](../../src/backend/api/platforms/twitch/) |

## Other references

- [`kick-api-endpoints.md`](./kick-api-endpoints.md) — flat-list reference of every known Kick endpoint (official + reverse-engineered). The structured wiki under [`./kick/`](./kick/README.md) is the curated subset we actually call; the flat list stays for greppability and as a research artifact.
- Official Kick docs: <https://docs.kick.com/>
- Official Twitch Helix docs: <https://dev.twitch.tv/docs/api/>
- Twitch GraphQL is undocumented; persisted-query hashes live in the [`twitch-gql-queries`](https://www.npmjs.com/package/twitch-gql-queries) npm package.

## How to use this wiki

- Each platform folder has a `README.md` with a table of contents.
- Endpoint pages link back to the source file with `file:line` references — these are stable for a given commit but may drift as code moves. The fastest way to find a current usage is to grep the function name.
- The Unified data types (`UnifiedChannel`, `UnifiedStream`, …) are defined in [`platform-types.ts`](../../src/backend/api/unified/platform-types.ts) and are the same across both platforms.
