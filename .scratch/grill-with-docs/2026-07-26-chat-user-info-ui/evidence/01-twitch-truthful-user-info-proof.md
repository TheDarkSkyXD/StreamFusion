# Slice 01 proof — truthful Twitch User Info

Date: 2026-07-29

## Electron MCP proof

The app was started in Electron-only development mode and inspected through the
registered `streamfusion-monorepo` Electron MCP target on port `9236`. No browser
window was opened during this proof.

### Real loaded data

- URL: `http://localhost:5173/#/stream/twitch/xqc?tab=home`
- Opened by clicking a live Twitch chat username.
- Selected chatter: `chadegist`.
- The dialog rendered the real Twitch avatar URL and verified absolute dates:
  `Account created — Mar 20, 2013` and `Following since — Apr 29, 2019`.
- No loaded fixture or synthetic profile data was enabled.
- Artifact:
  [slice01-electron-loaded-real-final.png](../../../images/slice01-electron-loaded-real-final.png)

### Explicit unavailable and Retry state

- URL:
  `http://localhost:5173/?userProfileFixture=unavailable#/stream/twitch/xqc?tab=home`
- Opened by clicking a live Twitch chat username.
- The dialog rendered `Couldn’t verify · Retry`, `Unavailable · Retry`, and
  `Channel unavailable · Retry`.
- `userProfileFixture=unavailable` is development-only and contains no positive
  profile data. `userProfileFixture=loaded` is unsupported and passes through to
  the real Platform readers.
- Artifact:
  [slice01-electron-unavailable-retry-final.png](../../../images/slice01-electron-unavailable-retry-final.png)

## Browser-development parity

The browser harness mounts the same renderer and `UserPopout` component. The
normal URL relays all four typed `userProfiles` methods to Electron; only the
explicit `unavailable` query is intercepted. Production output contains
`index.html` and the slot renderer only—there is no `browser.html` entry.

## Scope-path note

The StreamFusion Twitch OAuth, reconnect, primary device-code, validation, and
refresh paths all consume `TWITCH_APP_SCOPES`. The separate untracked
follow-write credential uses a different Twitch client ID and a least-privilege
legacy credential for follow mutations; it is not a StreamFusion Platform
connection and must not receive StreamFusion moderator scopes.

## Quality gates

- Focused Slice 01 suite: 17 files, 163 tests passed.
- Exact Biome: 33 scoped files passed.
- Late profile-field hydration focus stability: explicitly covered; deferred
  follow data becomes visible while the already-focused account date retains
  focus.
- React Doctor: temporary-index staged scan of all six Slice 01 React files,
  zero issues.
- Workspace type-check: passed.
- Production build: passed; existing chunk-size/dynamic-import warnings only.
