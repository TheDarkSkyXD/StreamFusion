# Slice 02 proof — truthful Kick User Info

Date: 2026-07-30

## Electron MCP proof

The observed acceptance proof used the normal Electron-only development route.
It did not use a browser window, a profile fixture, or a synthetic chat user.

### Real loaded data

- Route: `#/stream/kick/xqc?tab=home`
- Selected real chatter: `AntithesisOfSpace` / `@antithesisofspace`
- The identity-first dialog retained the chat-known identity immediately and
  rendered real recent messages from the active Kick chat.
- The avatar DOM source used StreamFusion's `kick-image://` proxy around the
  real Kick CDN source
  `https://files.kick.com/images/user/51367617/...-medium.webp`.
- `Account created` rendered `Unavailable · Retry`; no account date was
  inferred from the message, session, or another timestamp.
- `Following since` used the exact schema-validated first-party fallback value
  `2025-01-03T06:33:30.000000Z`, displayed as `Jan 3, 2025`.
- The external action had the accessible name
  `Open antithesisofspace on Kick` and remained enabled while the separate
  internal Channel action was unavailable with Retry.
- Artifact:
  [slice02-kick-real-dialog-fixed.png](../../../images/slice02-kick-real-dialog-fixed.png)

### Retry remains truthful

The `Account created` `Unavailable · Retry` action was exercised on the same
real user. After Retry, the real identity, avatar, and recent messages remained
visible, and the unsupported account date remained `Unavailable · Retry`.

- Artifact:
  [slice02-kick-retry-remains-truthful.png](../../../images/slice02-kick-retry-remains-truthful.png)

## Route, user, and source notes

- The proof route was the normal Kick `xqc` stream route, with no development
  fixture query.
- `AntithesisOfSpace` was selected from real live chat. The canonical external
  route uses the normalized chat-known username:
  `https://kick.com/antithesisofspace`.
- Documented Kick user and chat-event data are preferred for identity and
  avatar. The real avatar was rendered through the app's required image proxy.
- The official user response does not prove account creation time, so that
  field remains unavailable.
- The exact follow timestamp came from the isolated first-party website
  fallback only after schema validation. It is not described as an official
  Public API guarantee.
- Internal Channel enrichment is an independent field. Its unavailable/Retry
  state does not disable the truthful external Kick profile action.

## Official source references

- [Kick Users API](https://docs.kick.com/apis/users)
- [Kick event types](https://docs.kick.com/events/event-types)
- [Subscribe to Kick events](https://docs.kick.com/events/subscribe-to-events)
- [Kick OAuth scopes](https://docs.kick.com/scopes/scopes)
- [Kick OAuth token flow](https://docs.kick.com/getting-started/generating-tokens-oauth2-flow)
- [Kick's official public documentation repository](https://github.com/KickEngineering/KickDevDocs)

The first-party website fallback is intentionally excluded from the official
source list because it is undocumented and isolated behind StreamFusion's
schema-validating Platform adapter.

## Supporting automated evidence

- Exact staged-snapshot Slice 02 suite: 205 tests passed across 14 test files.
- Full staged-snapshot source Biome check: 622 files passed.
- Contract coverage includes documented user/event responses, valid fallback
  data, schema drift, missing dates, explicit unavailable states, canonical
  scope validation, and initial/direct token-persistence behavior.
- UI coverage proves that Kick channel enrichment failure does not disable the
  normalized external profile action and does not change Twitch behavior.

## Browser-development boundary

The browser relay contract was exercised separately during broader development
harness verification. The relay foundation and its tests are intentionally not
part of this Issue 02 index. They are also not the runtime acceptance proof for
this slice; the acceptance artifacts above were captured from Electron only.

## Closure gate

The exact staged snapshot passed type-check, the full 622-file source Biome
check, all 205 focused tests across 14 files, and the production build. A
staged-only React Doctor scan completed with zero blocking errors and seven
advisory warnings, all on pre-existing lines outside the Issue 02 hunks. The
40-path staged slice is closure-ready, and the local tracker entry is marked
done.
