# Phase 10: Downloads & Media Management

**Document Name:** Downloads & Media Management Implementation Plan  
**Date:** December 9, 2025  
**Version:** 1.0  
**Status:** Planning  
**Priority:** Medium  
**Prerequisites:** Phase 3 Complete

---

## Executive Summary

This phase implements the functionality to download VODs (Videos on Demand) and Clips from Twitch and Kick. It introduces a dedicated Downloads page to manage and view downloaded content, and adds download controls to the video player interfaces.

---

## Architecture Overview

### Downloads Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       StreamFusion Downloads                      │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Downloads UI                           │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │  │
│  │  │ Downloads   │ │ Progress    │ │ Media Player        │  │  │
│  │  │ Page        │ │ Indicators  │ │ (Local Files)       │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────▼───────────────────────────────┐  │
│  │                    Downloads Service                       │  │
│  │           (Electron Main Process handles I/O)             │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              Download Manager                        │  │  │
│  │  │  - Queue Management  - Bandwidth Control             │  │  │
│  │  │  - File System                                       │  │  │
│  │  │  ┌─────────────────────────┐    ┌────────────────────────┐  │  │  │
│  │  │  │ VODs: yt-dlp + ffmpeg   │    │ Clips: Direct HTTP     │  │  │  │
│  │  │  │ (Exec Binaries)         │    │ (Axios / Electron-dl)  │  │  │  │
│  │  │  └─────────────────────────┘    └────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Functional Requirements

| Requirement | Description |
|-------------|-------------|
| FR-10.1 | Download VODs (Videos) from Twitch/Kick |
| FR-10.2 | Download Clips from Twitch/Kick |
| FR-10.3 | Dedicated Downloads Management Page |
| FR-10.4 | Playback of downloaded local files |
| FR-10.5 | Select Save Location for Downloads |

---

## Implementation Phases

### Phase 10.1: Download Manager Service (Back-end)

#### Tasks

- [ ] **10.1.1** Create Download Service in Electron Main Process
  - Handle file system access.
  - Manage active, paused, and completed downloads.
  - Implement **Hybrid Strategy**:
    - **VODs**: Use `yt-dlp` (via `yt-dlp-exec` wrapper).
    - **Clips**: Use direct HTTP download (`electron-dl` or `axios`).
  - **Save Dialog**:
    - Implement IPC handler to show `dialog.showSaveDialog`.
    - Allow user to select destination folder and filename.
- [ ] **10.1.2** Implement VOD Downloader (HLS/m3u8 with yt-dlp)
  - VODs (especially Kick) use HLS and have complex headers.
  - Bundle `yt-dlp` AND `ffmpeg` binaries with the application.
  - `yt-dlp` requires `ffmpeg` to merge video/audio streams and process HLS.
  - Use `yt-dlp` to handle segment downloading and merging.
  - Command example: `yt-dlp --ffmpeg-location [path_to_ffmpeg] -o "path/to/download.mp4" [url]`
  - Monitor `stdout` from `yt-dlp` for progress updates.
- [ ] **10.1.3** Implement Clip Downloader (Direct MP4)
  - Clips are usually direct standard video files.
  - Simple HTTP download using `axios` (for control) or `electron-dl`.

#### Verification
- [ ] Backend can download a file to a user-selected directory.
- [ ] HLS streams are correctly converted/merged to MP4.

---

### Phase 10.2: Downloads State Management (Front-end)

#### Tasks

- [ ] **10.2.1** Create `DownloadsStore` (Zustand)
  ```typescript
  interface DownloadItem {
    id: string;
    type: 'vod' | 'clip';
    title: string;
    thumbnail: string;
    progress: number; // 0-100
    status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error';
    filePath?: string;
    url: string;
  }
  
  interface DownloadsState {
    downloads: DownloadItem[];
    addDownload: (item: Omit<DownloadItem, 'id' | 'progress' | 'status'>) => void;
    pauseDownload: (id: string) => void;
    resumeDownload: (id: string) => void;
    cancelDownload: (id: string) => void;
    removeDownload: (id: string) => void;
  }
  ```
- [ ] **10.2.2** Sync Store with Electron Main Process
  - Listen for IPC events (`download:progress`, `download:complete`, `download:error`) to update store state.

---

### Phase 10.3: UI Implementation

#### Tasks

- [ ] **10.3.1** Create Downloads Page (`/downloads`)
  - Route: `/downloads`
  - Components: `DownloadList`, `DownloadItem`, `EmptyState`.
  - Tabs: "Active Downloads", "Completed".
- [ ] **10.3.2** Add "Download" Button to VOD Player/Page
  - Detect if VOD is downloadable.
  - On click, trigger `showSaveDialog` via IPC.
  - Pass selected path to `addDownload` action.
- [ ] **10.3.3** Add "Download" Button to Clip Player/Page
  - On click, trigger `showSaveDialog` via IPC.
  - Pass selected path to `addDownload` action.
- [ ] **10.3.4** Integrate Local Player for Completed Downloads
  - Allow user to click a completed item to play it within StreamFusion (or open in system default player).

#### Verification

- [ ] User can navigate to Downloads page.
- [ ] Download progress is visible and updates in real-time.
- [ ] Completed downloads can be played.

---

## Dependencies

```json
{
  "dependencies": {
    "electron-dl": "^x.x.x", 
    "yt-dlp-exec": "^x.x.x",
    "bin-version-check": "^x.x.x",
    "ffmpeg-static-electron": "^x.x.x"
    // note: yt-dlp binary handling needs to be cross-platform
    // note: ffmpeg must be bundled or static path provided to yt-dlp
  }
}
```

---

## Success Criteria

1. ✅ User can click "Download" on a Clip and have it save to disk.
2. ✅ User can click "Download" on a VOD and have it save to disk (merged MP4).
3. ✅ Progress is visualized on the Downloads page.
4. ✅ Completed downloads are accessible.
5. ✅ User can select custom save location for every download.

---

## Next Phase

→ **End of Planned Roadmap** (Subject to extensions)
