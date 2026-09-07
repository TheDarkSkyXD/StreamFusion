# PLAYER COMPONENTS

**Read this file before modifying code in this directory.**

## Purpose

Owns player presentation: platform wrappers, controls, quality selection, PiP, and theater mode. HLS engine sessions and provider loaders live in `../../adapters/browser/`; playback source resolution uses `../../capabilities/playback-source.ts`. Chat UI and backend URL resolution have separate feature owners.

## OVERVIEW

Video playback system: HLS.js core, platform wrappers, performance optimizations.

## STRUCTURE

```
player/
├── hls-player.tsx            # HLS presentation wrapper
├── video-player.tsx          # Generic orchestrator
├── performance-enhanced-player.tsx  # Adaptive quality + throttling
├── player-controls.tsx       # Shared control layout
├── volume-control.tsx
├── progress-bar.tsx
├── settings-menu.tsx
├── quality-selector.tsx
├── kick/
│   ├── kick-live-player.tsx  # Live stream wrapper
│   ├── kick-vod-player.tsx   # VOD wrapper
│   ├── kick-player-controls.tsx
│   └── kick-progress-bar.tsx
├── twitch/
│   ├── twitch-live-player.tsx
│   ├── twitch-vod-player.tsx
│   ├── twitch-player-controls.tsx
│   └── video-stats-overlay.tsx
├── hooks/
│   ├── use-video-lifecycle.ts   # Memory cleanup, lazy loading
│   ├── use-adaptive-quality.ts  # Network-aware quality caps
│   ├── use-background-throttle.ts
│   ├── use-volume.ts            # Persist across sessions
│   ├── use-player-keyboard.ts   # Hotkeys (F, Space, M)
│   ├── use-fullscreen.ts
│   └── use-picture-in-picture.ts
```

## WHERE TO LOOK

| Task                  | Location                        |
| --------------------- | ------------------------------- |
| HLS config tuning     | `../../adapters/browser/hls-playback-session.ts` and `hls-buffer-config.ts` |
| Add keyboard shortcut | `hooks/use-player-keyboard.ts`  |
| Memory leaks          | `hooks/use-video-lifecycle.ts`  |
| Quality switching     | `hooks/use-adaptive-quality.ts` |
| New platform player   | Create `[platform]/` subdir     |

## CONVENTIONS

### Architecture Layers

1. **Engine**: browser HLS session adapters own loading, media events, recovery, and cleanup.
2. **Orchestrator**: `video-player.tsx` - state coordination
3. **Platform**: `kick/*.tsx`, `twitch/*.tsx` - branded controls
4. **Optimization**: `PerformanceEnhancedPlayer` - HOC wrapper

### Ref-First Pattern

Use `useRef` for video element access; avoid state for high-frequency updates.

### forwardRef + useImperativeHandle

`HlsPlayer` exposes video element ref to parents.

## ANTI-PATTERNS

- Keep source-session setup and teardown in the HLS adapter rather than growing a component effect.
- Manual heartbeat interval for stream death detection

## NOTES

- **DO NOT** call `recoverMediaError()` for non-MEDIA_ERROR - causes buffer loops
- Heartbeat checks fragment loading every 15s to detect silent stream end
- Low latency mode enabled by default
- Platform colors: Kick green (`#53fc18`), Twitch purple (`#9146ff`)

## DUAL-WATCHDOG PATTERN (hls-player.tsx)

The player keeps **two** independent freshness watchdogs. Do not merge them; they catch different failure modes.

- **Input watchdog (`heartbeatDelay`, 5s tick):** updates `lastFragLoadedTimeRef` on every `FRAG_LOADED`. Detects "fragments stopped arriving" → STREAM_OFFLINE / NO_FRAGMENTS.
- **Output watchdog (`stallWatchdogDelay`, 2s tick, prefix `[HLS-stall-w7d3]`):** updates `lastTimeAdvancedAtRef` on every `currentTime` advance. Detects "decoder hung even though fragments still flow" (Chromium media stack quirk, common on long Kick sessions). After 8s of no advance, escalates: `nudge → startLoad(-1) → recoverMediaError() → fatal DECODER_STALL` (the last rung routes through `KickLivePlayer`'s `shouldRefresh` auto-retry → fresh playback URL + remount).

If you add a new player wrapper, both watchdogs come for free via `HlsPlayer`. If you swap out the engine, **port both patterns** — input-only detection masks decoder hangs and the user just sees a frozen frame with no error. Regression-tested in `../../tests/components/player/hls-player-stall-watchdog.test.tsx`. Shared player types live in `../../capabilities/media-types.ts`.
