# StreamFusion Architecture Guide

**Document Name:** Project Architecture Reference  
**Date:** December 7, 2025  
**Version:** 1.0  
**Status:** Active

---

## Overview

StreamFusion uses a **feature-based architecture** with **platform abstraction** to support multiple streaming platforms (Twitch, Kick, and future platforms) without code duplication.

---

## Directory Structure

```
src/
├── main.ts                          # Electron main process entry
├── renderer.tsx                     # React renderer entry
├── App.tsx                          # Root React component
├── index.css                        # Global styles
│
├── backend/                         # Main Process (Electron)
│   ├── api/                         # Platform API Layer
│   │   ├── index.ts                 # Central API exports
│   │   ├── unified/                 # Platform-agnostic interfaces
│   │   │   ├── index.ts
│   │   │   ├── platform-types.ts    # UnifiedStream, UnifiedChannel, etc.
│   │   │   └── platform-client.ts   # IPlatformClient interface
│   │   └── platforms/               # Platform-specific implementations
│   │       ├── twitch/
│   │       │   ├── index.ts
│   │       │   ├── twitch-types.ts      # Raw Twitch API types
│   │       │   ├── twitch-transformers.ts # → Unified types
│   │       │   └── twitch-client.ts     # TwitchClient (Phase 1.3)
│   │       └── kick/
│   │           ├── index.ts
│   │           ├── kick-types.ts        # Raw Kick API types
│   │           ├── kick-transformers.ts # → Unified types
│   │           └── kick-client.ts       # KickClient (Phase 1.4)
│   │
│   ├── auth/                        # Authentication Module
│   │   ├── index.ts
│   │   ├── oauth-config.ts          # OAuth configs + PKCE helpers
│   │   ├── protocol-handler.ts      # streamfusion:// protocol
│   │   ├── auth-window.ts           # BrowserWindow for OAuth
│   │   ├── token-exchange.ts        # Code → Token exchange
│   │   ├── twitch-auth.ts           # Twitch auth service (Phase 1.3)
│   │   └── kick-auth.ts             # Kick auth service (Phase 1.4)
│   │
│   ├── services/                    # Backend Services
│   │   └── storage-service.ts       # Secure storage (electron-store)
│   │
│   ├── ipc-handlers.ts              # All IPC handlers
│   └── window-manager.ts            # Window management
│
├── preload/                         # Preload Scripts
│   └── index.ts                     # electronAPI bridge
│
├── shared/                          # Shared Between Processes
│   ├── auth-types.ts                # Auth types (tokens, users, etc.)
│   └── ipc-channels.ts              # IPC channel constants + types
│
├── components/                      # React Components (Feature-based)
│   ├── layout/                      # Layout components
│   │   ├── Sidebar.tsx
│   │   ├── TitleBar.tsx
│   │   └── AppLayout.tsx
│   ├── ui/                          # shadcn/ui primitives
│   │   ├── button.tsx
│   │   └── ...
│   ├── auth/                        # Auth UI Components
│   │   ├── AuthProvider.tsx
│   │   ├── LoginDialog.tsx
│   │   ├── AccountConnect.tsx
│   │   └── ProfileDropdown.tsx
│   ├── channel/                     # Channel Components (unified)
│   │   ├── ChannelCard.tsx
│   │   ├── ChannelList.tsx
│   │   ├── StreamCard.tsx
│   │   └── StreamGrid.tsx
│   ├── player/                      # Video Player Components
│   │   ├── VideoPlayer.tsx
│   │   ├── PlayerControls.tsx
│   │   └── QualitySelector.tsx
│   └── chat/                        # Chat Components
│       ├── ChatPanel.tsx
│       ├── ChatMessage.tsx
│       └── ChatInput.tsx
│
├── pages/                           # Page Components
│   ├── Home/
│   ├── Categories/
│   ├── Search/
│   ├── Following/
│   ├── Channel/
│   ├── Settings/
│   └── Watch/
│
├── hooks/                           # React Hooks
│   ├── index.ts
│   ├── useAuth.ts                   # Auth hooks
│   └── queries/                     # TanStack Query hooks
│       ├── useStreams.ts
│       ├── useChannels.ts
│       └── useCategories.ts
│
├── store/                           # Zustand Stores
│   ├── auth-store.ts
│   └── settings-store.ts
│
├── routes/                          # TanStack Router
│   └── index.tsx
│
├── providers/                       # React Providers
│   └── index.tsx
│
├── lib/                             # Utilities
│   └── utils.ts
│
└── assets/                          # Static Assets
    └── platforms/                   # Platform Branding
        ├── index.ts                 # Helper functions
        ├── twitch/
        │   └── index.ts             # TWITCH_COLORS, etc.
        └── kick/
            └── index.ts             # KICK_COLORS, etc.
```

---

## Key Architectural Patterns

### 1. Platform Abstraction

All platform-specific code is isolated in `src/backend/api/platforms/{platform}/`. The unified layer (`src/backend/api/unified/`) defines common interfaces.

```typescript
// Unified interface - platform agnostic
interface UnifiedStream {
  id: string;
  platform: 'twitch' | 'kick';
  title: string;
  viewerCount: number;
  // ... common properties
}

// Platform client interface
interface IPlatformClient {
  getTopStreams(): Promise<SearchResults<UnifiedStream>>;
  getChannel(id: string): Promise<UnifiedChannel>;
  // ... common methods
}
```

**Benefits:**
- UI components only work with unified types
- Easy to add new platforms (YouTube, Rumble, etc.)
- Consistent data across the app

### 2. Feature-Based Component Organization

Components are organized by **feature**, not by type:

```
❌ Don't do this:
components/
├── buttons/
├── cards/
├── modals/

✅ Do this:
components/
├── auth/         # All auth-related components
├── channel/      # Channel cards, lists, grids
├── player/       # Video player components
├── chat/         # Chat components
```

### 3. Separation of Concerns

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Main Process** | `src/backend/` | Native APIs, auth, storage |
| **Preload** | `src/preload/` | Secure IPC bridge |
| **Renderer** | `src/components/`, `src/pages/` | React UI |
| **Shared** | `src/shared/` | Types, constants |

### 4. Data Flow

```
[Renderer]  →  [IPC Channel]  →  [Main Process]
     ↑                                   ↓
useQuery()                        Platform API
     ↑                                   ↓
 zustand store      ←      storage-service.ts
```

---

## Platform-Specific Files

### Backend API

| Path | Description |
|------|-------------|
| `backend/api/platforms/twitch/twitch-types.ts` | Raw Twitch Helix API types |
| `backend/api/platforms/twitch/twitch-transformers.ts` | Twitch → Unified transformers |
| `backend/api/platforms/twitch/twitch-client.ts` | TwitchClient implementing IPlatformClient |
| `backend/api/platforms/kick/kick-types.ts` | Raw Kick API types |
| `backend/api/platforms/kick/kick-transformers.ts` | Kick → Unified transformers |
| `backend/api/platforms/kick/kick-client.ts` | KickClient implementing IPlatformClient |

### Auth Services

| Path | Description |
|------|-------------|
| `backend/auth/twitch-auth.ts` | Twitch-specific OAuth handling |
| `backend/auth/kick-auth.ts` | Kick-specific OAuth handling |

### Frontend Assets

| Path | Description |
|------|-------------|
| `assets/platforms/twitch/index.ts` | Twitch brand colors, logos |
| `assets/platforms/kick/index.ts` | Kick brand colors, logos |

---

## Adding a New Platform

To add a new platform (e.g., YouTube):

1. **Create platform folder:**
   ```
   src/backend/api/platforms/youtube/
   ├── youtube-types.ts
   ├── youtube-transformers.ts
   ├── youtube-client.ts
   └── index.ts
   ```

2. **Implement transformers** to convert YouTube API responses to `UnifiedStream`, `UnifiedChannel`, etc.

3. **Create YouTubeClient** implementing `IPlatformClient`.

4. **Add auth service** at `src/backend/auth/youtube-auth.ts`.

5. **Add branding** at `src/assets/platforms/youtube/`.

6. **Update shared types:**
   ```typescript
   export type Platform = 'twitch' | 'kick' | 'youtube';
   ```

---

## Brand Colors Reference

### Twitch
- Primary: `#9146FF` (Purple)
- Background: `#0E0E10`
- Live: `#EB0400`

### Kick
- Primary: `#53FC18` (Green)
- Background: `#0B0E0F`
- Live: `#FF0000`

Use the helper functions:
```typescript
import { getPlatformColor, getPlatformName } from '@/assets/platforms';

const color = getPlatformColor('twitch'); // '#9146FF'
```

---

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| React Components | PascalCase | `StreamCard.tsx` |
| Hooks | camelCase with `use` prefix | `useAuth.ts` |
| Stores | kebab-case with `-store` suffix | `auth-store.ts` |
| Types | PascalCase | `TwitchApiStream` |
| Platform files | kebab-case with platform prefix | `twitch-client.ts` |
| Transformers | kebab-case with `-transformers` suffix | `twitch-transformers.ts` |

---

## References

- [Phase 1 Progress](./features/active/phase-1-authentication-progress.md)
- [Phase 2 Spec](./features/planned/phase-2-discovery-spec.md)
- [PRD](../PRD.md)
