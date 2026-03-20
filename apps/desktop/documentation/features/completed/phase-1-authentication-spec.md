# Phase 1: Authentication & User Management

**Document Name:** Authentication Implementation Plan  
**Date:** December 7, 2025  
**Version:** 1.0  
**Status:** Planning  
**Priority:** High  
**Prerequisites:** Phase 0 Complete

---

## Executive Summary

This phase implements the authentication system for StreamFusion, enabling users to connect their Twitch and Kick accounts via OAuth. It also establishes the guest mode with local storage for preferences and followed channels, creating a flexible user experience that works with or without platform authentication.

---

## Architecture Overview

> **See [Architecture Guide](../architecture.md)** for the complete folder structure and conventions.

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        StreamFusion                               │
│  ┌───────────────┐    ┌────────────────┐    ┌───────────────┐  │
│  │ Guest Mode    │    │   Direct OAuth │    │ Authenticated │  │
│  │ - Local Store │ ──▶│   (PKCE)       │──▶ │    Mode       │  │
│  │ - Limited     │    │  - Twitch      │    │ - Full Access │  │
│  │   Features    │    │  - Kick        │    │ - Synced Data │  │
│  └───────────────┘    └────────────────┘    └───────────────┘  │
│                              │                                   │
│                              ▼                                   │
│                    ┌────────────────┐                           │
│                    │ Secure Token   │                           │
│                    │ Storage        │                           │
│                    │ (Encrypted)    │                           │
│                    └────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### Key File Locations

| Module | Path |
|--------|------|
| OAuth Config | `src/backend/auth/oauth-config.ts` |
| Protocol Handler | `src/backend/auth/protocol-handler.ts` |
| Auth Window | `src/backend/auth/auth-window.ts` |
| Token Exchange | `src/backend/auth/token-exchange.ts` |
| Storage Service | `src/backend/services/storage-service.ts` |
| Twitch Client | `src/backend/api/platforms/twitch/twitch-client.ts` |
| Kick Client | `src/backend/api/platforms/kick/kick-client.ts` |
| Auth Store | `src/store/auth-store.ts` |
| Auth Hooks | `src/hooks/useAuth.ts` |
| Auth UI | `src/components/auth/` |

---

## Functional Requirements Covered

| Requirement | Description |
|-------------|-------------|
| FR-1.1 | Guest Mode |
| FR-1.2 | Platform Authentication |
| FR-1.3 | User Profile Management |
| API-1.1 | Twitch OAuth Implementation |
| API-2.1 | Kick OAuth Implementation |
| API-3.1 | Better-Auth Integration |
| API-3.2 | Authentication Workflows |
| API-3.3 | Local Authentication |

---

## Implementation Phases

### Phase 1.1: Local Storage Foundation (2 days)

#### Tasks

- [ ] **1.1.1** Install and configure electron-store
  ```bash
  npm install electron-store
  ```

- [ ] **1.1.2** Create secure storage service
  ```typescript
  // src/backend/services/storage-service.ts
  import Store from 'electron-store';
  import { safeStorage } from 'electron';
  
  interface SecureStorageSchema {
    authTokens: {
      twitch?: EncryptedToken;
      kick?: EncryptedToken;
    };
    userPreferences: UserPreferences;
    localFollows: LocalFollow[];
  }
  
  class StorageService {
    private store: Store<SecureStorageSchema>;
    
    encryptToken(token: string): Buffer;
    decryptToken(encrypted: Buffer): string;
    saveToken(platform: Platform, token: AuthToken): void;
    getToken(platform: Platform): AuthToken | null;
  }
  ```

- [ ] **1.1.3** Implement local follows system
  ```typescript
  interface LocalFollow {
    id: string;
    platform: 'twitch' | 'kick';
    channelId: string;
    channelName: string;
    displayName: string;
    profileImage: string;
    followedAt: string;
    lastSeen?: string;
    isLive?: boolean;
  }
  ```

- [ ] **1.1.4** Create preferences store
  ```typescript
  interface UserPreferences {
    theme: 'light' | 'dark' | 'system';
    language: string;
    defaultQuality: 'auto' | '1080p' | '720p' | '480p' | '360p';
    autoPlay: boolean;
    notifications: NotificationPreferences;
    chat: ChatPreferences;
    playback: PlaybackPreferences;
  }
  ```

#### Verification

- [ ] Data persists between app restarts
- [ ] Sensitive data is encrypted
- [ ] Local follows CRUD operations work

---

### Phase 1.2: OAuth Infrastructure (3 days)

#### Tasks

- [ ] **1.2.1** Install Better-Auth
  ```bash
  # Not using better-auth - using direct OAuth with PKCE instead
  ```

- [ ] **1.2.2** Create OAuth configuration
  ```typescript
  // src/backend/auth/oauth-config.ts
  export const TWITCH_OAUTH_CONFIG: OAuthConfig = {
    platform: 'twitch',
    clientId: process.env.TWITCH_CLIENT_ID,
    redirectUri: 'streamfusion://auth/twitch/callback',
    scopes: ['user:read:follows', 'user:read:email'],
    usesPkce: true,
  };
  
  export const KICK_OAUTH_CONFIG: OAuthConfig = {
    platform: 'kick',
    clientId: process.env.KICK_CLIENT_ID,
    redirectUri: 'streamfusion://auth/kick/callback',
    scopes: ['user:read', 'channel:read'],
    usesPkce: true,
  };
  
  // PKCE helpers
  export function generatePkceChallenge(): PkceChallenge;
  export function buildAuthorizationUrl(params: AuthUrlParams): string;
  ```

- [ ] **1.2.3** Register custom protocol handler
  ```typescript
  // src/backend/auth/protocol-handler.ts
  export function registerProtocolHandler() {
    app.setAsDefaultProtocolClient('streamfusion');
    
    app.on('open-url', (event, url) => {
      handleAuthCallback(url);
    });
  }
  ```

- [ ] **1.2.4** Create auth window manager
  ```typescript
  // src/backend/auth/auth-window.ts
  export function openAuthWindow(platform: Platform): Promise<AuthResult> {
    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    
    // Navigate to OAuth URL
    // Handle callback
    // Return tokens
  }
  ```

#### Verification

- [ ] Custom protocol `streamfusion://` is registered
- [ ] Auth windows open correctly
- [ ] OAuth redirects are captured

---

### Phase 1.3: Twitch Authentication (2 days)

#### Tasks

- [ ] **1.3.1** Implement Twitch OAuth flow
  ```typescript
  // src/backend/auth/twitch-auth.ts
  export class TwitchAuthService {
    async initiateLogin(): Promise<void>;
    async handleCallback(code: string): Promise<TwitchTokens>;
    async refreshToken(refreshToken: string): Promise<TwitchTokens>;
    async validateToken(accessToken: string): Promise<boolean>;
    async revokeToken(accessToken: string): Promise<void>;
    async getUserInfo(accessToken: string): Promise<TwitchUser>;
  }
  ```

- [ ] **1.3.2** Create Twitch API client
  ```typescript
  // src/backend/api/platforms/twitch/twitch-client.ts
  export class TwitchClient implements IPlatformClient {
    readonly platform = 'twitch';
    
    async getCurrentUser(): Promise<ApiResponse<UnifiedUser>>;
    async getFollowedChannels(params?: PaginationParams): Promise<ApiResponse<SearchResults<UnifiedFollow>>>;
    async getTopStreams(params?: PaginationParams): Promise<ApiResponse<SearchResults<UnifiedStream>>>;
    // ... implements full IPlatformClient interface
  }
  ```

- [ ] **1.3.3** Implement token refresh logic
  ```typescript
  // Auto-refresh tokens before expiry
  // Handle 401 errors with refresh
  // Queue requests during token refresh
  ```

- [ ] **1.3.4** Create IPC handlers for auth
  ```typescript
  // IPC_CHANNELS.AUTH_TWITCH_LOGIN
  // IPC_CHANNELS.AUTH_TWITCH_LOGOUT
  // IPC_CHANNELS.AUTH_TWITCH_STATUS
  ```

#### Verification

- [ ] Can login with Twitch account
- [ ] User info is retrieved correctly
- [ ] Token refresh works automatically
- [ ] Logout clears all tokens

---

### Phase 1.4: Kick Authentication (2 days)

#### Tasks

- [ ] **1.4.1** Implement Kick OAuth flow
  ```typescript
  // src/backend/auth/kick-auth.ts
  export class KickAuthService {
    async initiateLogin(): Promise<void>;
    async handleCallback(code: string): Promise<KickTokens>;
    async refreshToken(refreshToken: string): Promise<KickTokens>;
    async validateToken(accessToken: string): Promise<boolean>;
    async getUserInfo(accessToken: string): Promise<KickUser>;
  }
  ```

- [ ] **1.4.2** Create Kick API client
  ```typescript
  // src/backend/api/platforms/kick/kick-client.ts
  export class KickClient implements IPlatformClient {
    readonly platform = 'kick';
    
    async getCurrentUser(): Promise<ApiResponse<UnifiedUser>>;
    async getFollowedChannels(params?: PaginationParams): Promise<ApiResponse<SearchResults<UnifiedFollow>>>;
    async getChannelByName(slug: string): Promise<ApiResponse<UnifiedChannel>>;
    // ... implements full IPlatformClient interface
  }
  ```

- [ ] **1.4.3** Handle Kick-specific OAuth requirements
  - PKCE flow implementation
  - State parameter validation
  - Scope handling

- [ ] **1.4.4** Create IPC handlers for Kick auth
  ```typescript
  // IPC_CHANNELS.AUTH_KICK_LOGIN
  // IPC_CHANNELS.AUTH_KICK_LOGOUT
  // IPC_CHANNELS.AUTH_KICK_STATUS
  ```

#### Verification

- [ ] Can login with Kick account
- [ ] User info is retrieved correctly
- [ ] Token management works
- [ ] Logout clears all tokens

---

### Phase 1.5: Auth State Management (2 days)

#### Tasks

- [ ] **1.5.1** Create auth store in Zustand
  ```typescript
  // src/frontend/store/auth-store.ts
  interface AuthState {
    // Twitch
    twitchUser: TwitchUser | null;
    twitchConnected: boolean;
    twitchLoading: boolean;
    
    // Kick
    kickUser: KickUser | null;
    kickConnected: boolean;
    kickLoading: boolean;
    
    // Guest mode
    isGuest: boolean;
    
    // Actions
    loginTwitch: () => Promise<void>;
    logoutTwitch: () => Promise<void>;
    loginKick: () => Promise<void>;
    logoutKick: () => Promise<void>;
    refreshAuthStatus: () => Promise<void>;
  }
  ```

- [ ] **1.5.2** Create auth hooks
  ```typescript
  // src/frontend/hooks/useAuth.ts
  export function useTwitchAuth() {
    const { twitchUser, twitchConnected, loginTwitch, logoutTwitch } = useAuthStore();
    // ...
  }
  
  export function useKickAuth() {
    const { kickUser, kickConnected, loginKick, logoutKick } = useAuthStore();
    // ...
  }
  
  export function useAuthStatus() {
    // Combined auth status
  }
  ```

- [ ] **1.5.3** Implement auth context persistence
  ```typescript
  // Restore auth state on app startup
  // Check token validity
  // Refresh tokens if needed
  ```

- [ ] **1.5.4** Create auth error handling
  ```typescript
  type AuthError = 
    | 'NETWORK_ERROR'
    | 'INVALID_TOKEN'
    | 'TOKEN_EXPIRED'
    | 'USER_CANCELLED'
    | 'PERMISSION_DENIED';
  ```

#### Verification

- [ ] Auth state persists across app restarts
- [ ] Multiple accounts can be connected
- [ ] Auth status updates reactively

---

### Phase 1.6: UI Components (2 days)

#### Tasks

- [ ] **1.6.1** Create AuthProvider component
  ```typescript
  // src/components/auth/AuthProvider.tsx
  export function AuthProvider({ children }: { children: React.ReactNode }) {
    // Initialize auth state on mount
    // Provide auth context
  }
  ```

- [ ] **1.6.2** Create account connection UI
  ```typescript
  // src/components/auth/AccountConnect.tsx
  export function AccountConnect() {
    // Platform connection cards with brand colors
    // Connect/Disconnect buttons
    // Account status display
  }
  ```

- [ ] **1.6.3** Create user profile dropdown
  ```typescript
  // src/components/auth/ProfileDropdown.tsx
  export function ProfileDropdown() {
    // User avatar and name
    // Connected accounts
    // Quick settings
    // Logout options
  }
  ```

- [ ] **1.6.4** Create login modal/dialog
  ```typescript
  // src/components/auth/LoginDialog.tsx
  export function LoginDialog() {
    // Platform selection with brand colors
    // Login buttons with platform branding
    // Guest mode option
  }
  ```

- [ ] **1.6.5** Create account settings page
  ```typescript
  // src/pages/Settings/AccountSettings.tsx
  export function AccountSettings() {
    // Connected accounts list
    // Connection management
    // Data sync options
  }
  ```

#### Verification

- [ ] Login flow is intuitive
- [ ] Connected accounts display correctly
- [ ] Profile dropdown works

---

### Phase 1.7: Guest Mode Polish (1 day)

#### Tasks

- [ ] **1.7.1** Implement guest mode indicators
  - Show "Guest" badge
  - Indicate limited features
  - Prompt for login when needed

- [ ] **1.7.2** Create feature limitations
  ```typescript
  export function requiresAuth(feature: Feature): boolean {
    const authRequired = [
      'chat:send',
      'follow:sync',
      'channel-points',
      'moderation',
    ];
    return authRequired.includes(feature);
  }
  ```

- [ ] **1.7.3** Sync local follows on login
  ```typescript
  // When user logs in, offer to:
  // - Import local follows to platform
  // - Replace local with platform follows
  // - Merge both
  ```

- [ ] **1.7.4** Create onboarding flow for guests

#### Verification

- [ ] Guest mode is fully functional
- [ ] Login prompts appear appropriately
- [ ] Local data syncs on authentication

---

## Testing & Verification

### Unit Tests

- [ ] Token encryption/decryption
- [ ] OAuth URL generation
- [ ] Token refresh logic
- [ ] Store operations

### Integration Tests

- [ ] Full OAuth flow (mock server)
- [ ] Token persistence
- [ ] Multi-account scenarios

### Manual Verification

- [ ] Twitch login works end-to-end
- [ ] Kick login works end-to-end
- [ ] Logout clears all data
- [ ] Token refresh happens automatically
- [ ] Guest mode is functional

---

## Security Considerations

### Token Security

1. **Storage**: Use `safeStorage` API for token encryption
2. **Memory**: Clear tokens from memory after use
3. **Transmission**: HTTPS only for all OAuth flows
4. **Validation**: Validate all tokens on app startup

### OAuth Security

1. **PKCE**: Implement for all OAuth flows
2. **State Parameter**: Validate to prevent CSRF
3. **Redirect URI**: Validate callback URLs
4. **Scopes**: Request minimum necessary

### Best Practices

```typescript
// Never log tokens
logger.debug('Auth completed', { userId, platform }); // NOT token

// Clear sensitive data
process.on('exit', () => {
  authTokens.clear();
});

// Use secure context
BrowserWindow.webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
};
```

---

## API Rate Limits

### Twitch

| Request Type | Limit |
|--------------|-------|
| Authenticated | 800 points/minute |
| App Token | 30 points/minute |

**Strategy**: Queue requests, implement exponential backoff

### Kick

| Request Type | Limit |
|--------------|-------|
| General | TBD (follow documentation) |

**Strategy**: Monitor and adapt

---

## Dependencies

```json
{
  "dependencies": {
    "electron-store": "^8.x"
  }
}
```

> **Note:** No external auth libraries are used - we use direct OAuth with PKCE for better control and simplicity in Electron apps.

---

## Success Criteria

Phase 1 is complete when:

1. ✅ Users can login with Twitch OAuth
2. ✅ Users can login with Kick OAuth
3. ✅ Guest mode works with local storage
4. ✅ Tokens are securely stored and refreshed
5. ✅ Auth state persists across sessions
6. ✅ Multiple accounts can be connected
7. ✅ Login/logout UI is polished

---

## Next Phase

→ **[Phase 2: Stream Discovery & Browsing](./phase-2-discovery-spec.md)**

