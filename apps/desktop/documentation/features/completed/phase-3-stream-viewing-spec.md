# Phase 3: Stream Viewing

**Document Name:** Stream Viewing Implementation Plan  
**Date:** December 7, 2025  
**Version:** 1.0  
**Status:** Planning  
**Priority:** High  
**Prerequisites:** Phase 2 Complete

---

## Executive Summary

This phase implements the core stream viewing experience for StreamFusion, including the unified video player, multi-stream viewing with up to 6 simultaneous streams, theater/fullscreen modes, picture-in-picture, and stream popout functionality. The focus is on performance optimization to ensure smooth playback while minimizing resource consumption.

---

## Architecture Overview

### Video Player Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                      StreamFusion Player                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    React Player UI                         │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │  │
│  │  │   Controls  │ │   Overlay   │ │    Quality/Audio    │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────▼───────────────────────────────┐  │
│  │                    Player Core                             │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │     HLS.js / Native HLS (Platform-based)            │  │  │
│  │  │     - Twitch: USHER CDN + HLS                       │  │  │
│  │  │     - Kick: HLS/DASH streams                        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────▼───────────────────────────────┐  │
│  │              <video> / iframe (fallback)                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Multi-Stream Layout System

```
┌─────────────────────────────────────────────────────────────────┐
│                     Multi-Stream Manager                         │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │ Layout Engine  │  │ Audio Router   │  │ Resource Manager │  │
│  │ - Grid layouts │  │ - Focus audio  │  │ - Quality adapt  │  │
│  │ - Custom drag  │  │ - Mix option   │  │ - CPU/GPU limit  │  │
│  └────────────────┘  └────────────────┘  └──────────────────┘  │
│                                                                  │
│  Stream Slots: [1] [2] [3] [4] [5] [6]                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Functional Requirements Covered

| Requirement | Description |
|-------------|-------------|
| FR-3.1 | Multi-Platform Player |
| FR-3.2 | Multi-Stream Viewing |
| FR-3.3 | Theater & Fullscreen Modes |
| FR-3.4 | VODs & Clips |
| FR-6.3 | Performance Optimization |

---

## Implementation Phases

### Phase 3.1: Video Player Core (4 days)

#### Tasks

- [ ] **3.1.1** Install video player dependencies
  ```bash
  npm install hls.js
  ```

- [ ] **3.1.2** Create base VideoPlayer component
  ```typescript
  // src/frontend/components/player/VideoPlayer.tsx
  interface VideoPlayerProps {
    streamUrl: string;
    platform: 'twitch' | 'kick';
    poster?: string;
    autoPlay?: boolean;
    muted?: boolean;
    quality?: QualityLevel;
    onReady?: () => void;
    onError?: (error: PlayerError) => void;
    onQualityChange?: (quality: QualityLevel) => void;
  }
  
  export function VideoPlayer(props: VideoPlayerProps) {
    const playerRef = useRef<Player>(null);
    const [isReady, setIsReady] = useState(false);
    const [currentQuality, setCurrentQuality] = useState<QualityLevel>('auto');
    
    // HLS.js integration
    // Quality selection
    // Error handling
    // Stats reporting
  }
  ```

- [ ] **3.1.3** Implement Twitch stream URL resolver
  ```typescript
  // src/backend/api/twitch/stream-resolver.ts
  export class TwitchStreamResolver {
    async getStreamPlaybackUrl(channelLogin: string): Promise<StreamPlayback> {
      // Get access token
      // Resolve M3U8 playlist URL
      // Parse available qualities
    }
    
    async getVodPlaybackUrl(vodId: string): Promise<StreamPlayback> {
      // Similar for VODs
    }
  }
  ```

- [ ] **3.1.4** Implement Kick stream URL resolver
  ```typescript
  // src/backend/api/kick/stream-resolver.ts
  export class KickStreamResolver {
    async getStreamPlaybackUrl(channelSlug: string): Promise<StreamPlayback> {
      // Resolve HLS URL
      // Parse available qualities
    }
  }
  ```

- [ ] **3.1.5** Create HLS.js wrapper
  ```typescript
  // src/frontend/components/player/HlsPlayer.tsx
  export function HlsPlayer({ src, ...props }: HlsPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    
    useEffect(() => {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
        });
        // Setup HLS
      }
    }, [src]);
    
    // Cleanup on unmount
    // Quality management
    // Event handling
  }
  ```

- [ ] **3.1.6** Implement quality selection
  ```typescript
  // src/frontend/components/player/QualitySelector.tsx
  interface QualityLevel {
    id: string;
    label: string; // "1080p60", "720p", "480p", etc.
    width: number;
    height: number;
    bitrate: number;
    frameRate?: number;
    isAuto?: boolean;
  }
  
  export function QualitySelector({ levels, current, onChange }: QualitySelectorProps) {
    // Dropdown with quality options
    // Auto option
    // Current selection indicator
  }
  ```

#### Verification

- [ ] Twitch streams play correctly
- [ ] Kick streams play correctly
- [ ] Quality switching works
- [ ] Loading and error states display

---

### Phase 3.2: Player Controls UI (3 days)

#### Tasks

- [ ] **3.2.1** Create PlayerControls component
  ```typescript
  // src/frontend/components/player/PlayerControls.tsx
  export function PlayerControls({ player }: { player: PlayerRef }) {
    return (
      <div className="player-controls">
        <ProgressBar />
        <ControlsBar>
          <PlayPauseButton />
          <VolumeControl />
          <TimeDisplay />
          <Spacer />
          <SettingsButton />
          <TheaterButton />
          <FullscreenButton />
        </ControlsBar>
      </div>
    );
  }
  ```

- [ ] **3.2.2** Create PlayPauseButton
  ```typescript
  // Play/Pause toggle
  // Loading indicator
  // Keyboard shortcut (Space)
  ```

- [ ] **3.2.3** Create VolumeControl
  ```typescript
  // src/frontend/components/player/VolumeControl.tsx
  export function VolumeControl() {
    // Volume slider
    // Mute toggle
    // Volume icon state (muted/low/medium/high)
    // Keyboard shortcuts (M for mute, up/down for volume)
  }
  ```

- [ ] **3.2.4** Create SettingsMenu
  ```typescript
  // src/frontend/components/player/SettingsMenu.tsx
  export function SettingsMenu() {
    return (
      <Popover>
        <MenuItem>
          <QualitySelector />
        </MenuItem>
        <MenuItem>
          <PlaybackSpeedSelector /> {/* For VODs */}
        </MenuItem>
        <MenuItem>
          <LatencyModeToggle /> {/* Low latency option */}
        </MenuItem>
        <MenuItem>
          <PipToggle />
        </MenuItem>
      </Popover>
    );
  }
  ```

- [ ] **3.2.5** Implement auto-hide controls
  ```typescript
  // Hide controls after 3 seconds of inactivity
  // Show on mouse movement or keyboard input
  // Always show when paused
  ```

- [ ] **3.2.6** Create keyboard shortcuts handler
  ```typescript
  // src/frontend/hooks/usePlayerKeyboard.ts
  const PLAYER_SHORTCUTS = {
    'Space': 'togglePlay',
    'k': 'togglePlay',
    'm': 'toggleMute',
    'f': 'toggleFullscreen',
    't': 'toggleTheater',
    'ArrowUp': 'volumeUp',
    'ArrowDown': 'volumeDown',
    'ArrowLeft': 'seekBack',    // VOD only
    'ArrowRight': 'seekForward', // VOD only
  };
  ```

#### Verification

- [ ] All controls function correctly
- [ ] Controls auto-hide
- [ ] Keyboard shortcuts work
- [ ] Touch-friendly controls

---

### Phase 3.3: Stream Page Layout (2 days)

#### Tasks

- [ ] **3.3.1** Create StreamPage component
  ```typescript
  // src/frontend/pages/Stream/StreamPage.tsx
  export function StreamPage() {
    const { platform, channel } = useParams();
    const stream = useStream(platform, channel);
    const [chatVisible, setChatVisible] = useState(true);
    
    return (
      <div className={cn('stream-page', { 'theater-mode': isTheater })}>
        <div className="stream-content">
          <VideoPlayer stream={stream} />
          <StreamInfo stream={stream} />
          <RelatedContent channel={channel} />
        </div>
        {chatVisible && <ChatPanel channel={channel} platform={platform} />}
      </div>
    );
  }
  ```

- [ ] **3.3.2** Create StreamInfo component
  ```typescript
  // src/frontend/components/stream/StreamInfo.tsx
  export function StreamInfo({ stream }: { stream: UnifiedStream }) {
    return (
      <div className="stream-info">
        <ChannelAvatar />
        <div>
          <h1>{stream.title}</h1>
          <ChannelName />
          <GameCategory />
          <Tags />
        </div>
        <div>
          <ViewerCount />
          <FollowButton />
          <ShareButton />
        </div>
      </div>
    );
  }
  ```

- [ ] **3.3.3** Implement resizable chat panel
  ```typescript
  // Draggable divider between player and chat
  // Persist width preference
  // Collapsible
  ```

- [ ] **3.3.4** Create RelatedContent section
  ```typescript
  // Similar streams
  // Other streams from same game
  // Streamer's VODs (if applicable)
  ```

#### Verification

- [ ] Stream page renders correctly
- [ ] Chat panel resizable
- [ ] Stream info displays correctly

---

### Phase 3.4: Theater & Fullscreen Modes (2 days)

#### Tasks

- [ ] **3.4.1** Implement theater mode
  ```typescript
  // src/frontend/hooks/useTheaterMode.ts
  export function useTheaterMode() {
    const [isTheater, setIsTheater] = useState(false);
    
    // Expand video to fill main content area
    // Collapse sidebars
    // Maintain chat visibility option
  }
  ```

- [ ] **3.4.2** Implement fullscreen mode
  ```typescript
  // src/frontend/hooks/useFullscreen.ts
  export function useFullscreen(elementRef: RefObject<HTMLElement>) {
    const [isFullscreen, setIsFullscreen] = useState(false);
    
    const enterFullscreen = async () => {
      await elementRef.current?.requestFullscreen();
      setIsFullscreen(true);
    };
    
    const exitFullscreen = async () => {
      await document.exitFullscreen();
      setIsFullscreen(false);
    };
    
    // Listen for fullscreen changes
    // Exit on Escape key
  }
  ```

- [ ] **3.4.3** Implement Picture-in-Picture
  ```typescript
  // src/frontend/hooks/usePictureInPicture.ts
  export function usePictureInPicture(videoRef: RefObject<HTMLVideoElement>) {
    const [isPip, setIsPip] = useState(false);
    
    const enterPip = async () => {
      if (document.pictureInPictureEnabled) {
        await videoRef.current?.requestPictureInPicture();
      }
    };
    
    // Handle PiP events
    // Exit when stream ends
  }
  ```

- [ ] **3.4.4** Implement stream popout window
  ```typescript
  // src/backend/core/popout-manager.ts
  export class PopoutManager {
    async createPopout(streamId: string): Promise<BrowserWindow> {
      const popout = new BrowserWindow({
        width: 640,
        height: 360,
        frame: false,
        alwaysOnTop: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
        },
      });
      
      popout.loadURL(`app://stream-popout/${streamId}`);
      return popout;
    }
  }
  ```

#### Verification

- [ ] Theater mode expands correctly
- [ ] Fullscreen works on all platforms
- [ ] PiP works
- [ ] Popout windows function correctly

---

### Phase 3.5: Multi-Stream Viewing (4 days)

#### Tasks

- [ ] **3.5.1** Create multi-stream store
  ```typescript
  // src/frontend/store/multistream-store.ts
  interface MultiStreamState {
    streams: StreamSlot[];
    layout: LayoutType;
    audioFocusId: string | null;
    maxStreams: number;
    
    addStream: (stream: StreamInfo) => void;
    removeStream: (slotId: string) => void;
    swapStreams: (slot1: number, slot2: number) => void;
    setLayout: (layout: LayoutType) => void;
    setAudioFocus: (streamId: string) => void;
  }
  
  interface StreamSlot {
    id: string;
    stream: UnifiedStream;
    quality: QualityLevel;
    muted: boolean;
    volume: number;
  }
  
  type LayoutType = 
    | '1x1' | '1x2' | '2x1' | '2x2' 
    | '1+2' | '1+3' | '2x3' | '3x2';
  ```

- [ ] **3.5.2** Create MultiStreamPage component
  ```typescript
  // src/frontend/pages/MultiStream/MultiStreamPage.tsx
  export function MultiStreamPage() {
    const { streams, layout, addStream, removeStream } = useMultiStreamStore();
    
    return (
      <div className="multistream-container">
        <MultiStreamGrid layout={layout}>
          {streams.map((slot) => (
            <StreamSlotComponent key={slot.id} slot={slot} />
          ))}
          {streams.length < 6 && <AddStreamSlot onClick={openAddDialog} />}
        </MultiStreamGrid>
        <MultiStreamControls />
      </div>
    );
  }
  ```

- [ ] **3.5.3** Implement layout grid system
  ```typescript
  // src/frontend/components/multistream/MultiStreamGrid.tsx
  const LAYOUTS = {
    '1x1': { rows: 1, cols: 1 },
    '1x2': { rows: 1, cols: 2 },
    '2x1': { rows: 2, cols: 1 },
    '2x2': { rows: 2, cols: 2 },
    '1+2': { template: 'main-side', mainSize: '67%' },
    '1+3': { template: 'main-side', mainSize: '50%' },
    '2x3': { rows: 2, cols: 3 },
    '3x2': { rows: 3, cols: 2 },
  };
  ```

- [ ] **3.5.4** Implement drag-and-drop reordering
  ```typescript
  // src/frontend/hooks/useDragAndDrop.ts
  // Drag streams between slots
  // Visual feedback during drag
  // Swap positions on drop
  ```

- [ ] **3.5.5** Create audio focus system
  ```typescript
  // src/frontend/components/multistream/AudioFocus.tsx
  // Only one stream plays audio by default
  // Click to focus audio on stream
  // Option for audio mixing mode
  // Individual volume controls per stream
  ```

- [ ] **3.5.6** Create add stream dialog
  ```typescript
  // src/frontend/components/multistream/AddStreamDialog.tsx
  // Search for channels
  // Quick add from following
  // Recent streams
  // URL input option
  ```

- [ ] **3.5.7** Implement layout presets
  ```typescript
  interface LayoutPreset {
    id: string;
    name: string;
    streams: StreamSlot[];
    layout: LayoutType;
  }
  
  // Save current layout as preset
  // Load preset
  // Default presets
  ```

#### Verification

- [ ] Can add up to 6 streams
- [ ] All layouts render correctly
- [ ] Drag and drop works
- [ ] Audio focus works
- [ ] Performance is acceptable

---

### Phase 3.6: VOD & Clip Playback (2 days)

#### Tasks

- [ ] **3.6.1** Create VOD player with seek support
  ```typescript
  // src/frontend/components/player/VodPlayer.tsx
  export function VodPlayer({ vod }: { vod: VodInfo }) {
    return (
      <VideoPlayer
        src={vod.playbackUrl}
        duration={vod.duration}
        startAt={resumePosition}
        features={['seek', 'speed', 'chapters']}
      />
    );
  }
  ```

- [ ] **3.6.2** Implement progress bar with hover preview
  ```typescript
  // src/frontend/components/player/SeekBar.tsx
  // Seek bar with time preview on hover
  // Chapter markers
  // Buffered range indicator
  ```

- [ ] **3.6.3** Create playback speed control
  ```typescript
  const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  ```

- [ ] **3.6.4** Implement resume watching
  ```typescript
  // Track watch progress
  // Resume from last position
  // "Continue watching" section
  ```

- [ ] **3.6.5** Create clip player
  ```typescript
  // Clip autoplay
  // Loop option
  // Share functionality
  ```

#### Verification

- [ ] VODs play with seeking
- [ ] Playback speed works
- [ ] Resume position is saved
- [ ] Clips play correctly

---

### Phase 3.7: Performance Optimization (3 days)

#### Tasks

- [ ] **3.7.1** Implement adaptive quality
  ```typescript
  // src/frontend/hooks/useAdaptiveQuality.ts
  export function useAdaptiveQuality() {
    // Monitor CPU usage
    // Monitor dropped frames
    // Auto-reduce quality when system is stressed
    // Consider multi-stream count
  }
  ```

- [ ] **3.7.2** Create resource manager
  ```typescript
  // src/frontend/services/resource-manager.ts
  export class ResourceManager {
    private activePlayers: Map<string, PlayerStats>;
    
    monitorPerformance(): void;
    getRecommendedQuality(streamCount: number): QualityLevel;
    shouldReduceQuality(): boolean;
    throttleBackgroundStreams(): void;
  }
  ```

- [ ] **3.7.3** Implement background stream throttling
  ```typescript
  // Reduce quality for non-focused streams
  // Lower frame rate for minimized windows
  // Pause audio for background streams
  ```

- [ ] **3.7.4** Add performance monitoring UI
  ```typescript
  // src/frontend/components/player/StatsOverlay.tsx
  // FPS counter
  // Dropped frames
  // Bitrate
  // Buffer health
  // CPU/GPU usage
  ```

- [ ] **3.7.5** Optimize video element lifecycle
  ```typescript
  // Reuse video elements when switching streams
  // Proper cleanup on unmount
  // Memory leak prevention
  ```

#### Verification

- [ ] Multi-stream stays under CPU/RAM limits
- [ ] Quality adapts to system load
- [ ] No memory leaks during long sessions

---

## Testing & Verification

### Unit Tests

- [ ] Player state management
- [ ] Quality selection logic
- [ ] Layout calculations
- [ ] Keyboard shortcuts

### Integration Tests

- [ ] Stream playback flow
- [ ] Multi-stream management
- [ ] Fullscreen/theater transitions

### Performance Tests

- [ ] Single stream CPU/RAM usage
- [ ] Multi-stream (6) CPU/RAM usage
- [ ] Memory stability over time
- [ ] Frame drop rate

### Platform Tests

- [ ] Windows (DirectX)
- [ ] macOS (Metal)
- [ ] Linux (Vaapi/VDPAU)

---

## Security Considerations

### Stream URLs

- Keep stream URLs confidential
- Regenerate tokens periodically
- Handle expired URLs gracefully

### Content Security

- CSP for video sources
- Validate stream sources
- Handle malicious content gracefully

---

## Dependencies

```json
{
  "dependencies": {
    "hls.js": "^1.x",
    "@dnd-kit/core": "^6.x",
    "@dnd-kit/sortable": "^8.x"
  }
}
```

---

## Success Criteria

Phase 3 is complete when:

1. ✅ Single streams play smoothly from both platforms
2. ✅ Quality selection works correctly
3. ✅ Multi-stream viewing works with up to 6 streams
4. ✅ Theater and fullscreen modes function
5. ✅ PiP and popout windows work
6. ✅ VOD playback with seek works
7. ✅ Performance stays within acceptable limits
8. ✅ All keyboard shortcuts work

---

## Next Phase

→ **[Phase 4: Chat Integration](./phase-4-chat-spec.md)**

