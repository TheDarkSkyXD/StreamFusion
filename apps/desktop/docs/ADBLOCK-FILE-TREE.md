# StreamFusion Ad-Blocking System - File Tree

> Complete listing of all files and paths related to the Twitch ad-blocking system.

## Directory Structure

```
StreamFusion/
│
├── docs/                                         # Documentation
│   ├── TWITCH-ADBLOCK-SYSTEM.md                 # Main documentation
│   └── ADBLOCK-FILE-TREE.md                     # File tree reference (you are here)
│
├── src/
│   │
│   ├── main.ts                                   # [ENTRY] Electron main process
│   │   └── Lines 19-21: Import ad-block services
│   │   └── Lines 70-117: setupRequestInterceptors()
│   │   └── Lines 78-80: twitchManifestProxy.registerInterceptor()
│   │   └── Lines 83-99: networkAdBlockService integration
│   │   └── Lines 147-148: cosmeticInjectionService.initialize()
│   │
│   ├── backend/                                  # Main Process Backend
│   │   │
│   │   ├── services/                             # Core Services
│   │   │   │
│   │   │   ├── network-adblock-service.ts        # [LAYER 1] URL-based blocking
│   │   │   │   ├── NetworkAdBlockService class
│   │   │   │   ├── BlockRule interface
│   │   │   │   ├── BlockStats interface
│   │   │   │   ├── shouldBlock(url) method
│   │   │   │   └── Blocked patterns:
│   │   │   │       ├── edge.ads.twitch.tv
│   │   │   │       ├── spade.twitch.tv
│   │   │   │       ├── countess.twitch.tv
│   │   │   │       ├── science.twitch.tv
│   │   │   │       ├── imasdk.googleapis.com
│   │   │   │       ├── pubads.g.doubleclick.net
│   │   │   │       ├── pagead2.googlesyndication.com
│   │   │   │       ├── *.amazon-adsystem.com
│   │   │   │       ├── client-event-reporter.twitch.tv
│   │   │   │       └── trowel.twitch.tv
│   │   │   │
│   │   │   ├── twitch-manifest-proxy.ts          # [LAYER 2] HLS playlist interception
│   │   │   │   ├── TwitchManifestProxyService class
│   │   │   │   ├── ProxyStreamInfo interface
│   │   │   │   ├── ProxyStats interface
│   │   │   │   ├── ResolutionInfo interface
│   │   │   │   ├── registerInterceptor() - Session-level m3u8 intercept
│   │   │   │   ├── processManifest() - Main processing pipeline
│   │   │   │   ├── processMasterPlaylist() - Parse resolutions
│   │   │   │   ├── processMediaPlaylist() - Detect/remove ads
│   │   │   │   ├── detectAds() - Multi-heuristic detection
│   │   │   │   ├── tryGetBackupStream() - ULW implementation
│   │   │   │   ├── getAccessToken() - GQL token fetch
│   │   │   │   ├── replaceAdSegments() - 160p replacement
│   │   │   │   ├── stripAdSegmentsMinimal() - Segment removal
│   │   │   │   ├── neutralizeTrackingUrls() - Tracking URL removal
│   │   │   │   └── Constants:
│   │   │   │       ├── BACKUP_PLAYER_TYPES
│   │   │   │       ├── GQL_CLIENT_ID
│   │   │   │       └── ACCESS_TOKEN_HASH
│   │   │   │
│   │   │   └── cosmetic-injection-service.ts     # DOM-based ad hiding
│   │   │       ├── CosmeticInjectionService class
│   │   │       ├── initialize() - Setup CSS injection
│   │   │       ├── injectIntoWindow() - Apply to BrowserWindow
│   │   │       └── IPC handler: 'adblock:inject-cosmetics'
│   │   │
│   │   ├── ipc/
│   │   │   └── handlers/
│   │   │       └── adblock-handlers.ts           # IPC bridge
│   │   │           ├── registerAdBlockHandlers()
│   │   │           └── Handlers:
│   │   │               ├── ADBLOCK_GET_STATUS
│   │   │               ├── ADBLOCK_TOGGLE
│   │   │               ├── ADBLOCK_GET_STATS
│   │   │               └── ADBLOCK_PROXY_STATUS
│   │   │
│   │   └── ipc-handlers.ts                       # Handler registration
│   │       └── Line 18: import { registerAdBlockHandlers }
│   │
│   ├── components/
│   │   └── player/
│   │       └── twitch/                           # Twitch Player Components
│   │           │
│   │           ├── index.ts                      # Barrel exports
│   │           │
│   │           ├── twitch-adblock-service.ts     # [LAYER 3] Client-side processing
│   │           │   ├── Module-level state:
│   │           │   │   ├── adSegmentCache - Map<url, timestamp>
│   │           │   │   ├── streamInfos - Map<channel, StreamInfo>
│   │           │   │   ├── streamInfosByUrl - Map<url, StreamInfo>
│   │           │   │   ├── config - AdBlockConfig
│   │           │   │   ├── gqlDeviceId, authorizationHeader, etc.
│   │           │   │   └── isMainProcessProxyActive
│   │           │   │
│   │           │   ├── Public API:
│   │           │   │   ├── initAdBlockService(config)
│   │           │   │   ├── updateAdBlockConfig(updates)
│   │           │   │   ├── setStatusChangeCallback(cb)
│   │           │   │   ├── setAuthHeaders(deviceId, auth, integrity)
│   │           │   │   ├── setClientHeaders(version, session)
│   │           │   │   ├── isAdBlockEnabled()
│   │           │   │   ├── setMainProcessProxyActive(active)
│   │           │   │   ├── isMainProcessProxyEnabled()
│   │           │   │   ├── getAdBlockStatus(channelName)
│   │           │   │   ├── isAdSegment(url)
│   │           │   │   ├── getBlankVideoDataUrl()
│   │           │   │   ├── clearStreamInfo(channelName)
│   │           │   │   ├── processMasterPlaylist(url, text, channel)
│   │           │   │   ├── processMediaPlaylist(url, text)
│   │           │   │   └── setPlayerCallbacks(reload, pauseResume)
│   │           │   │
│   │           │   ├── Internal functions:
│   │           │   │   ├── neutralizeTrackingUrls(text)
│   │           │   │   ├── detectAds(text, streamInfo)
│   │           │   │   ├── updateBitrateBaseline(text, streamInfo)
│   │           │   │   ├── tryGetBackupStream(streamInfo, resolution)
│   │           │   │   ├── getAccessToken(channel, playerType)
│   │           │   │   ├── gqlRequest(body)
│   │           │   │   ├── buildUsherUrl(channel, token, params)
│   │           │   │   ├── stripAdSegments(text, stripAll, streamInfo)
│   │           │   │   ├── consumeAdSegment(text, streamInfo)
│   │           │   │   ├── parseResolutionsFromPlaylist(text, streamInfo)
│   │           │   │   ├── parseAttributes(str)
│   │           │   │   ├── getStreamUrlForResolution(m3u8, target)
│   │           │   │   ├── getServerTimeFromM3u8(text)
│   │           │   │   ├── replaceServerTimeInM3u8(text, time)
│   │           │   │   ├── shouldCreateModifiedPlaylist(streamInfo)
│   │           │   │   ├── createModifiedPlaylist(text, streamInfo)
│   │           │   │   ├── notifyStatusChange(streamInfo)
│   │           │   │   ├── notifyPlayerReload()
│   │           │   │   └── notifyPauseResume()
│   │           │   │
│   │           │   └── Size: 976 lines
│   │           │
│   │           ├── twitch-adblock-loader.ts      # HLS.js custom loaders
│   │           │   ├── extractChannelName(url)
│   │           │   ├── isMasterPlaylist(url)
│   │           │   ├── isMediaPlaylist(url)
│   │           │   ├── isTwitchSegment(url)
│   │           │   ├── createAdBlockPlaylistLoader(channelName)
│   │           │   │   └── AdBlockLoader class (extends DefaultLoader)
│   │           │   ├── createAdBlockFragmentLoader()
│   │           │   │   └── AdBlockFragmentLoader class
│   │           │   ├── AdBlockHlsConfig interface
│   │           │   ├── getAdBlockHlsConfig(channelName)
│   │           │   └── Size: 225 lines
│   │           │
│   │           ├── twitch-hls-player.tsx         # HLS Player with ad-block
│   │           │   ├── TwitchHlsPlayerProps interface
│   │           │   ├── TwitchHlsPlayer component (forwardRef)
│   │           │   ├── Ad-block initialization in useEffect
│   │           │   ├── handlePlayerReload callback
│   │           │   ├── handlePauseResume callback
│   │           │   ├── HLS.js config with ad-block loaders
│   │           │   └── Size: 458 lines
│   │           │
│   │           ├── twitch-live-player.tsx        # Live stream wrapper
│   │           │   ├── Uses TwitchHlsPlayer
│   │           │   ├── Uses useAdBlockStore
│   │           │   ├── Ad element observer (DOM hiding)
│   │           │   ├── AdBlockFallbackOverlay (disabled)
│   │           │   └── Ad status display in UI
│   │           │
│   │           ├── twitch-live-player-controls.tsx
│   │           │   └── AdBlockStatus prop for UI display
│   │           │
│   │           └── ad-block-fallback-overlay.tsx # Fallback UI (DISABLED)
│   │               ├── AdBlockFallbackOverlay component
│   │               ├── Shows "Blocking ads" message
│   │               └── Currently hidden for seamless experience
│   │
│   ├── shared/                                   # Cross-process Types
│   │   │
│   │   ├── adblock-types.ts                      # Type definitions
│   │   │   ├── ResolutionInfo interface
│   │   │   ├── StreamInfo interface
│   │   │   │   ├── channelName, isShowingAd, isMidroll
│   │   │   │   ├── encodingsM3U8, modifiedM3U8
│   │   │   │   ├── urls: Map<string, ResolutionInfo>
│   │   │   │   ├── resolutionList: ResolutionInfo[]
│   │   │   │   ├── backupEncodingsCache: Map<string, string>
│   │   │   │   ├── activeBackupPlayerType
│   │   │   │   ├── requestedAds: Set<string>
│   │   │   │   ├── isStrippingAdSegments, numStrippedAdSegments
│   │   │   │   ├── isUsingFallbackMode, adStartTime
│   │   │   │   └── lastKnownBitrate
│   │   │   ├── AdBlockConfig interface
│   │   │   │   ├── enabled, adSignifier, clientId
│   │   │   │   ├── backupPlayerTypes, fallbackPlayerType
│   │   │   │   ├── skipPlayerReloadOnHevc, alwaysReloadPlayerOnAd
│   │   │   │   ├── reloadPlayerAfterAd, playerReloadMinimalRequestsTime
│   │   │   │   ├── isAdStrippingEnabled, playerBufferingFix
│   │   │   │   ├── useDateRangeDetection, useBitrateDropDetection
│   │   │   │   ├── bitrateDropThreshold, use160pReplacement
│   │   │   │   └── ...more options
│   │   │   ├── PlayerType (union type)
│   │   │   │   └── 'site' | 'embed' | 'popout' | 'autoplay' | 'picture-by-picture' | 'thunderdome'
│   │   │   ├── AdBlockStatus interface
│   │   │   │   ├── isActive, isShowingAd, isMidroll
│   │   │   │   ├── isStrippingSegments, numStrippedSegments
│   │   │   │   ├── activePlayerType, channelName
│   │   │   │   ├── isUsingFallbackMode, adStartTime
│   │   │   │   └── (Used for UI display)
│   │   │   ├── AccessTokenResponse interface
│   │   │   ├── DEFAULT_ADBLOCK_CONFIG constant
│   │   │   ├── createStreamInfo(channelName, usherParams)
│   │   │   └── Size: 208 lines
│   │   │
│   │   └── ipc-channels.ts                       # IPC Channel Constants
│   │       └── Lines 132-138:
│   │           ├── ADBLOCK_GET_STATUS: 'adblock:get-status'
│   │           ├── ADBLOCK_TOGGLE: 'adblock:toggle'
│   │           ├── ADBLOCK_GET_STATS: 'adblock:get-stats'
│   │           ├── ADBLOCK_PROXY_STATUS: 'adblock:proxy-status'
│   │           └── ADBLOCK_INJECT_COSMETICS: 'adblock:inject-cosmetics'
│   │
│   ├── store/                                    # Zustand State
│   │   └── adblock-store.ts                      # Persistence store
│   │       ├── AdBlockState interface
│   │       │   ├── enableAdBlock: boolean
│   │       │   ├── setEnableAdBlock(enabled)
│   │       │   └── toggleAdBlock()
│   │       ├── useAdBlockStore hook
│   │       ├── Persisted to: 'streamfusion-adblock'
│   │       └── Size: 28 lines
│   │
│   ├── hooks/                                    # React Hooks
│   │   │
│   │   ├── use-adblock.ts                        # IPC hook for main process
│   │   │   ├── AdBlockState interface (local)
│   │   │   ├── useAdBlock() hook
│   │   │   ├── refresh() - Fetch status/stats
│   │   │   ├── toggle(options) - Enable/disable
│   │   │   └── Size: 56 lines
│   │   │
│   │   └── use-ad-element-observer.ts            # DOM observer
│   │       └── Observes and hides ad DOM elements
│   │
│   ├── preload/
│   │   └── index.ts                              # Preload bridge
│   │       └── Line 384: adblock API exposure
│   │           ├── getStatus()
│   │           ├── toggle(options)
│   │           ├── getStats()
│   │           └── injectCosmetics()
│   │
│   └── pages/
│       └── Settings/
│           └── index.tsx                         # Settings page
│               └── Lines 17, 149: Ad-block toggle UI
│
└── package.json                                  # Dependencies
    └── hls.js - HLS playback library
```

## Component Relationships

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ELECTRON MAIN PROCESS                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │ network-adblock-    │  │ twitch-manifest-    │  │ cosmetic-injection- │ │
│  │ service.ts          │  │ proxy.ts            │  │ service.ts          │ │
│  │                     │  │                     │  │                     │ │
│  │ • URL blocking      │  │ • m3u8 interception │  │ • CSS injection     │ │
│  │ • Stats tracking    │  │ • Backup fetching   │  │ • DOM hiding        │ │
│  └────────┬────────────┘  └─────────┬───────────┘  └──────────┬──────────┘ │
│           │                         │                          │            │
│           └─────────────────────────┼──────────────────────────┘            │
│                                     │                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │                      adblock-handlers.ts                              │  │
│  │                      (IPC bridge to renderer)                         │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
│                                     │                                       │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │ IPC
┌─────────────────────────────────────┼───────────────────────────────────────┐
│                                     │                                       │
│                            ELECTRON RENDERER                                │
│                                     │                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │                         preload/index.ts                              │  │
│  │                         (contextBridge)                               │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
│                                     │                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │                                                                       │  │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │  │
│  │  │ use-adblock.ts  │    │ adblock-store   │    │ Settings page   │   │  │
│  │  │ (IPC hook)      │←───│ (Zustand)       │←───│ (Toggle UI)     │   │  │
│  │  └────────┬────────┘    └─────────────────┘    └─────────────────┘   │  │
│  │           │                                                           │  │
│  │           └──────────────────────┐                                    │  │
│  │                                  │                                    │  │
│  │  ┌───────────────────────────────┴────────────────────────────────┐  │  │
│  │  │                    twitch-live-player.tsx                       │  │  │
│  │  │                    (Stream wrapper)                             │  │  │
│  │  └───────────────────────────────┬────────────────────────────────┘  │  │
│  │                                  │                                    │  │
│  │  ┌───────────────────────────────┴────────────────────────────────┐  │  │
│  │  │                    twitch-hls-player.tsx                        │  │  │
│  │  │                    (HLS.js wrapper)                             │  │  │
│  │  └───────────────────────────────┬────────────────────────────────┘  │  │
│  │                                  │                                    │  │
│  │           ┌──────────────────────┼──────────────────────┐            │  │
│  │           │                      │                      │            │  │
│  │  ┌────────┴────────┐   ┌─────────┴─────────┐   ┌───────┴────────┐   │  │
│  │  │ twitch-adblock- │   │ twitch-adblock-   │   │ adblock-types  │   │  │
│  │  │ loader.ts       │   │ service.ts        │   │ (shared)       │   │  │
│  │  │                 │   │                   │   │                │   │  │
│  │  │ • pLoader       │───│ • processMaster   │   │ • Interfaces   │   │  │
│  │  │ • fLoader       │   │ • processMedia    │   │ • Constants    │   │  │
│  │  └─────────────────┘   │ • getBackup       │   │ • Types        │   │  │
│  │                        │ • stripSegments   │   └────────────────┘   │  │
│  │                        └───────────────────┘                         │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Sizes and Complexity

| File | Lines | Complexity | Description |
|------|-------|------------|-------------|
| `twitch-adblock-service.ts` | 976 | High | Core client-side logic |
| `twitch-manifest-proxy.ts` | 590 | High | Main process interceptor |
| `twitch-hls-player.tsx` | 458 | Medium | HLS player integration |
| `twitch-adblock-loader.ts` | 225 | Medium | HLS.js custom loaders |
| `adblock-types.ts` | 208 | Low | Type definitions |
| `network-adblock-service.ts` | 73 | Low | URL blocking |
| `adblock-handlers.ts` | 57 | Low | IPC handlers |
| `use-adblock.ts` | 56 | Low | React hook |
| `adblock-store.ts` | 28 | Low | Zustand store |

## Key External Dependencies

| Package | Version | Usage |
|---------|---------|-------|
| `hls.js` | Latest | HLS playback, custom loaders |
| `electron` | Latest | Session API, webRequest |
| `zustand` | 5.x | State persistence |

## Related Documentation

- [AGENTS.md](../AGENTS.md) - Project knowledge base
- [src/backend/AGENTS.md](../src/backend/AGENTS.md) - Backend architecture
- [src/components/player/AGENTS.md](../src/components/player/AGENTS.md) - Player architecture
