# Phase 4: Chat Integration

**Document Name:** Chat Integration Implementation Plan  
**Date:** December 7, 2025  
**Version:** 1.0  
**Status:** Planning  
**Priority:** High  
**Prerequisites:** Phase 3 Complete

---

## Executive Summary

This phase implements the unified chat system for StreamFusion, enabling users to view and interact with chat from both Twitch and Kick streams. It includes chat rendering, message sending (for authenticated users), emote support, moderation tools, and chat customization options.

---

## Architecture Overview

### Chat System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       StreamFusion Chat                           │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Chat UI Layer                           │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │  │
│  │  │ Message List│ │ Input Field │ │ Emote Picker        │  │  │
│  │  │ (Virtual)   │ │ + Commands  │ │ Platform + Third   │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────▼───────────────────────────────┐  │
│  │                    Chat Service                            │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              Message Processor                       │  │  │
│  │  │  - Parse emotes      - Format badges                 │  │  │
│  │  │  - Detect mentions   - Apply filters                 │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│       ┌──────────────────────┼──────────────────────┐           │
│       │                      │                      │           │
│  ┌────▼────────┐       ┌─────▼──────┐        ┌──────▼─────┐    │
│  │ Twitch IRC  │       │  Kick WS   │        │ Third-Party│    │
│  │ Connection  │       │ Connection │        │ Emotes     │    │
│  └─────────────┘       └────────────┘        └────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Message Flow

```
Incoming Message
      │
      ▼
┌─────────────────┐
│ Parse Raw Data  │
│ (IRC/WebSocket) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Extract Metadata │
│ User, Badges,   │
│ Emotes, Mentions│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Apply Filters   │
│ Blocked users,  │
│ Keyword filters │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Render Message  │
│ Virtual List    │
└─────────────────┘
```

---

## Functional Requirements Covered

| Requirement | Description |
|-------------|-------------|
| FR-4.1 | Unified Chat Interface |
| FR-4.2 | Chat Interaction |
| FR-4.3 | Moderation Tools |
| FR-4.4 | Chat Settings |
| API-1.4 | Twitch Chat Integration |
| API-2.4 | Kick Chat Integration |

---

## Implementation Phases

### Phase 4.1: Twitch IRC Connection (3 days)

#### Tasks

- [ ] **4.1.1** Install IRC library
  ```bash
  npm install tmi.js
  # or implement raw WebSocket IRC
  ```

- [ ] **4.1.2** Create Twitch chat service
  ```typescript
  // src/backend/services/chat/twitch-chat.ts
  export class TwitchChatService extends EventEmitter {
    private client: tmi.Client | null = null;
    private channels: Set<string> = new Set();
    
    async connect(token?: string): Promise<void>;
    async joinChannel(channel: string): Promise<void>;
    async leaveChannel(channel: string): Promise<void>;
    async sendMessage(channel: string, message: string): Promise<void>;
    disconnect(): void;
    
    // Event handlers
    onMessage(callback: (msg: ChatMessage) => void): void;
    onUserNotice(callback: (notice: UserNotice) => void): void;
    onClearChat(callback: (clear: ClearChat) => void): void;
  }
  ```

- [ ] **4.1.3** Implement message parsing
  ```typescript
  // src/backend/services/chat/twitch-parser.ts
  interface TwitchChatMessage {
    id: string;
    userId: string;
    username: string;
    displayName: string;
    color: string;
    badges: Badge[];
    emotes: EmotePosition[];
    message: string;
    timestamp: Date;
    isAction: boolean;
    isHighlighted: boolean;
    replyTo?: ReplyInfo;
  }
  
  export function parseTwitchMessage(rawMessage: string): TwitchChatMessage;
  ```

- [ ] **4.1.4** Create badge resolver
  ```typescript
  // src/backend/services/chat/badge-resolver.ts
  export class BadgeResolver {
    private globalBadges: Map<string, Badge>;
    private channelBadges: Map<string, Map<string, Badge>>;
    
    async loadGlobalBadges(): Promise<void>;
    async loadChannelBadges(channelId: string): Promise<void>;
    resolveBadges(badgeList: string[], channelId: string): Badge[];
  }
  ```

- [ ] **4.1.5** Handle connection lifecycle
  ```typescript
  // Reconnection logic
  // Connection state management
  // Rate limiting
  // Error handling
  ```

#### Verification

- [ ] Can connect to Twitch IRC
- [ ] Messages are received correctly
- [ ] Can send messages when authenticated
- [ ] Reconnection works

---

### Phase 4.2: Kick WebSocket Connection (3 days)

#### Tasks

- [ ] **4.2.1** Create Kick chat service
  ```typescript
  // src/backend/services/chat/kick-chat.ts
  export class KickChatService extends EventEmitter {
    private ws: WebSocket | null = null;
    private channelId: string | null = null;
    
    async connect(channelId: string): Promise<void>;
    async sendMessage(message: string): Promise<void>;
    disconnect(): void;
    
    onMessage(callback: (msg: KickChatMessage) => void): void;
    onEvent(callback: (event: KickChatEvent) => void): void;
  }
  ```

- [ ] **4.2.2** Implement Kick message parsing
  ```typescript
  // src/backend/services/chat/kick-parser.ts
  interface KickChatMessage {
    id: string;
    userId: string;
    username: string;
    color: string;
    badges: Badge[];
    content: string;
    timestamp: Date;
    emotes: EmoteData[];
  }
  
  export function parseKickMessage(data: any): KickChatMessage;
  ```

- [ ] **4.2.3** Handle Kick-specific events
  ```typescript
  // Subscriptions
  // Gifts
  // Follows
  // Host/Raid
  ```

- [ ] **4.2.4** Implement chat commands
  ```typescript
  // /clear, /ban, /timeout, etc.
  // Platform-specific commands
  ```

#### Verification

- [ ] Can connect to Kick chat
- [ ] Messages are received correctly
- [ ] Can send messages when authenticated
- [ ] Events are handled correctly

---

### Phase 4.3: Unified Chat Interface (3 days)

#### Tasks

- [ ] **4.3.1** Create unified message type
  ```typescript
  // src/shared/types/chat.ts
  interface UnifiedChatMessage {
    id: string;
    platform: 'twitch' | 'kick';
    type: 'message' | 'action' | 'system' | 'notice';
    userId: string;
    username: string;
    displayName: string;
    color: string;
    badges: UnifiedBadge[];
    content: ContentFragment[];
    rawContent: string;
    timestamp: Date;
    isDeleted: boolean;
    isHighlighted: boolean;
    replyTo?: ReplyInfo;
  }
  
  type ContentFragment = 
    | { type: 'text'; content: string }
    | { type: 'emote'; id: string; name: string; url: string }
    | { type: 'mention'; username: string }
    | { type: 'link'; url: string; text: string };
  ```

- [ ] **4.3.2** Create ChatPanel component
  ```typescript
  // src/frontend/components/chat/ChatPanel.tsx
  export function ChatPanel({ channel, platform }: ChatPanelProps) {
    return (
      <div className="chat-panel">
        <ChatHeader channel={channel} platform={platform} />
        <ChatMessageList messages={messages} />
        <ChatInput 
          onSend={handleSend} 
          disabled={!isAuthenticated}
          placeholder={isAuthenticated ? "Send a message" : "Log in to chat"}
        />
      </div>
    );
  }
  ```

- [ ] **4.3.3** Implement virtual message list
  ```typescript
  // src/frontend/components/chat/ChatMessageList.tsx
  import { useVirtualizer } from '@tanstack/react-virtual';
  
  export function ChatMessageList({ messages }: { messages: ChatMessage[] }) {
    const parentRef = useRef<HTMLDivElement>(null);
    
    const virtualizer = useVirtualizer({
      count: messages.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 35, // Estimated message height
      overscan: 10,
    });
    
    // Auto-scroll to bottom
    // Pause scroll on user interaction
    // "New messages" indicator
  }
  ```

- [ ] **4.3.4** Create ChatMessage component
  ```typescript
  // src/frontend/components/chat/ChatMessage.tsx
  export function ChatMessage({ message }: { message: UnifiedChatMessage }) {
    return (
      <div className={cn('chat-message', { 'highlighted': message.isHighlighted })}>
        <Badges badges={message.badges} />
        <Username name={message.displayName} color={message.color} />
        <MessageContent content={message.content} />
        {showActions && <MessageActions message={message} />}
      </div>
    );
  }
  ```

- [ ] **4.3.5** Create Username component with user card
  ```typescript
  // Click on username shows user card
  // User card: avatar, follow status, mod actions
  ```

#### Verification

- [ ] Messages display correctly
- [ ] Virtual scrolling is smooth
- [ ] Auto-scroll works
- [ ] User cards open correctly

---

### Phase 4.4: Emote System (3 days)

#### Tasks

- [ ] **4.4.1** Create emote provider system
  ```typescript
  // src/backend/services/emotes/emote-manager.ts
  export class EmoteManager {
    private providers: EmoteProvider[];
    
    async loadGlobalEmotes(): Promise<void>;
    async loadChannelEmotes(channelId: string, platform: Platform): Promise<void>;
    getEmote(name: string, context: EmoteContext): Emote | null;
    searchEmotes(query: string): Emote[];
  }
  
  interface EmoteProvider {
    name: string;
    priority: number;
    loadGlobal(): Promise<Emote[]>;
    loadChannel(channelId: string): Promise<Emote[]>;
  }
  ```

- [ ] **4.4.2** Implement Twitch emote provider
  ```typescript
  // src/backend/services/emotes/twitch-emotes.ts
  export class TwitchEmoteProvider implements EmoteProvider {
    async loadGlobal(): Promise<Emote[]> {
      // Global emotes
      // Bits emotes
    }
    
    async loadChannel(channelId: string): Promise<Emote[]> {
      // Subscriber emotes
      // Follower emotes
    }

    // Requirements:
    // - Global emotes
    // - Channel-specific emotes
    // - User-specific emotes (personal emotes)
    // - Zero-width emotes (overlays)
    // - Animated emotes (GIF/WEBP)
  }
  ```

- [ ] **4.4.3** Implement Kick emote provider
  ```typescript
  // src/backend/services/emotes/kick-emotes.ts
  export class KickEmoteProvider implements EmoteProvider {
    async loadGlobal(): Promise<Emote[]> {
      // Fetch from Kick internal API (e.g. /emotes/global)
      // Parse 7TV-based emotes used by Kick
    }
    
    async loadChannel(channelId: string): Promise<Emote[]> {
      // Fetch channel data
      // Extract subscriber_badges and emotes
    }
  }
  ```

- [ ] **4.4.4** Implement third-party emote providers
  ```typescript
  // src/backend/services/emotes/bttv-emotes.ts
  export class BTTVEmoteProvider implements EmoteProvider {}
  
  // src/backend/services/emotes/ffz-emotes.ts
  export class FFZEmoteProvider implements EmoteProvider {}
  
  // src/backend/services/emotes/7tv-emotes.ts
  export class SevenTVEmoteProvider implements EmoteProvider {}
  ```

- [ ] **4.4.5** Create EmotePicker component
  ```typescript
  // src/frontend/components/chat/EmotePicker.tsx
  export function EmotePicker({ onSelect }: EmotePickerProps) {
    return (
      <Popover>
        <Tabs>
          <TabPanel value="favorites">
            <FavoriteEmotes onSelect={onSelect} />
          </TabPanel>
          <TabPanel value="channel">
            <ChannelEmotes onSelect={onSelect} />
          </TabPanel>
          <TabPanel value="global">
            <GlobalEmotes onSelect={onSelect} />
          </TabPanel>
          <TabPanel value="kick">
             <KickEmotes onSelect={onSelect} />
          </TabPanel>
          <TabPanel value="7tv">
            <SevenTVEmotes onSelect={onSelect} />
          </TabPanel>
        </Tabs>
        <EmoteSearch />
      </Popover>
    );
  }
  ```

- [ ] **4.4.6** Implement emote autocomplete
  ```typescript
  // Type :emote to trigger autocomplete
  // Show matching emotes
  // Keyboard navigation
  ```

- [ ] **4.4.7** Handle emote rendering
  ```typescript
  // src/frontend/components/chat/EmoteImage.tsx
  export function EmoteImage({ emote, size }: EmoteImageProps) {
    // Lazy loading
    // Multiple sizes (1x, 2x, 4x)
    // Animated emotes (GIF/WEBP)
    // Tooltip with name
    // Kick emote support (parsing custom image URLs)
  }
  ```

#### Verification

- [ ] All emote providers load
- [ ] Emotes display in messages
- [ ] Emote picker works
- [ ] Autocomplete functions

---

### Phase 4.5: Chat Input & Sending (2 days)

#### Tasks

- [ ] **4.5.1** Create ChatInput component
  ```typescript
  // src/frontend/components/chat/ChatInput.tsx
  export function ChatInput({ 
    onSend, 
    disabled, 
    channel, 
    platform 
  }: ChatInputProps) {
    const [message, setMessage] = useState('');
    
    return (
      <div className="chat-input">
        <Textarea
          value={message}
          onChange={setMessage}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
        />
        <EmotePickerButton />
        <SendButton onClick={() => onSend(message)} />
      </div>
    );
  }
  ```

- [ ] **4.5.2** Implement reply functionality
  ```typescript
  // Reply to specific message
  // Show reply preview
  // Clear reply context
  ```

- [ ] **4.5.3** Add mention autocomplete
  ```typescript
  // @mention autocomplete
  // Recent chatters
  // Mods/VIPs highlighted
  ```

- [ ] **4.5.4** Handle chat commands
  ```typescript
  const CHAT_COMMANDS = {
    '/me': 'action',
    '/clear': 'clear', // mod only
    '/timeout': 'timeout', // mod only
    '/ban': 'ban', // mod only
    '/unban': 'unban', // mod only
    '/slow': 'slow', // mod only
    '/followers': 'followers', // mod only
  };
  ```

#### Verification

- [ ] Can send messages
- [ ] Reply works
- [ ] Mentions autocomplete
- [ ] Commands function

---

### Phase 4.6: Moderation Tools (2 days)

#### Tasks

- [ ] **4.6.1** Create moderation store
  ```typescript
  // src/frontend/store/mod-store.ts
  interface ModState {
    isModerator: Record<string, boolean>; // channel -> isMod
    modActions: ModAction[];
    
    timeout: (userId: string, duration: number, reason?: string) => void;
    ban: (userId: string, reason?: string) => void;
    unban: (userId: string) => void;
    deleteMessage: (messageId: string) => void;
    clearChat: () => void;
  }
  ```

- [ ] **4.6.2** Create mod action buttons
  ```typescript
  // src/frontend/components/chat/ModActions.tsx
  export function ModActions({ user, message }: ModActionsProps) {
    const { isMod } = useModStatus();
    
    if (!isMod) return null;
    
    return (
      <div className="mod-actions">
        <Button onClick={() => deleteMessage(message.id)}>
          <TrashIcon />
        </Button>
        <TimeoutMenu user={user} />
        <BanButton user={user} />
      </div>
    );
  }
  ```

- [ ] **4.6.3** Create timeout menu
  ```typescript
  // Preset durations: 10s, 1m, 10m, 1h, 24h
  // Custom duration input
  // Reason input
  ```

- [ ] **4.6.4** Implement message deletion
  ```typescript
  // Delete single message
  // Clear all user messages
  // Show [deleted] placeholder
  ```

- [ ] **4.6.5** Handle mod events
  ```typescript
  // Timeout events
  // Ban events
  // Clear chat events
  // Mod status changes
  ```

#### Verification

- [ ] Mod actions appear when moderator
- [ ] Timeout/ban works
- [ ] Message deletion works
- [ ] Clear chat works

---

### Phase 4.7: Chat Settings & Customization (2 days)

#### Tasks

- [ ] **4.7.1** Create chat settings store
  ```typescript
  // src/frontend/store/chat-settings-store.ts
  interface ChatSettingsState {
    fontSize: 'small' | 'medium' | 'large';
    fontFamily: string;
    showTimestamps: boolean;
    showBadges: boolean;
    showEmotes: boolean;
    emoteSize: 'small' | 'medium' | 'large';
    readableColors: boolean;
    showDeletedMessages: boolean;
    messageSpacing: 'compact' | 'normal' | 'comfortable';
    
    // Filters
    blockedUsers: string[];
    blockedKeywords: string[];
    mentionHighlight: boolean;
    firstMessageHighlight: boolean;
  }
  ```

- [ ] **4.7.2** Create ChatSettingsPanel component
  ```typescript
  // src/frontend/components/chat/ChatSettings.tsx
  // Appearance settings
  // Filter settings
  // Behavior settings
  ```

- [ ] **4.7.3** Implement keyword filters
  ```typescript
  // Block messages containing keywords
  // Regex support
  // Hide vs blur options
  ```

- [ ] **4.7.4** Implement user blocking
  ```typescript
  // Block user from context menu
  // Manage blocked users in settings
  // Cross-channel blocking
  ```

- [ ] **4.7.5** Add readable colors option
  ```typescript
  // Adjust low-contrast colors
  // Ensure WCAG compliance
  // Optional color normalization
  ```

#### Verification

- [ ] Settings persist
- [ ] Font size changes apply
- [ ] Filters work correctly
- [ ] User blocking works

---

### Phase 4.8: Chat Panel Features (2 days)

#### Tasks

- [ ] **4.8.1** Create detachable chat window
  ```typescript
  // Pop out chat to separate window
  // Sync with main window
  // Independent settings
  ```

- [ ] **4.8.2** Implement chat overlay mode
  ```typescript
  // Transparent overlay on video
  // Adjustable opacity
  // Position customization
  ```

- [ ] **4.8.3** Create user list panel
  ```typescript
  // src/frontend/components/chat/UserList.tsx
  // Chatters count
  // Mods/VIPs section
  // Searchable
  ```

- [ ] **4.8.4** Add chat stats display
  ```typescript
  // Messages per minute
  // Active chatters
  // Emote usage
  ```

#### Verification

- [ ] Chat popout works
- [ ] Overlay mode works
- [ ] User list loads correctly

---

## Testing & Verification

### Unit Tests

- [ ] Message parsing (Twitch)
- [ ] Message parsing (Kick)
- [ ] Emote resolution
- [ ] Filter logic

### Integration Tests

- [ ] Twitch IRC connection
- [ ] Kick WebSocket connection
- [ ] Message send/receive
- [ ] Moderation actions

### Performance Tests

- [ ] Message rendering at high volume
- [ ] Virtual list performance
- [ ] Emote loading performance

---

## Security Considerations

### Input Sanitization

- Sanitize all message content
- Prevent XSS in usernames/messages
- Validate emote URLs

### Rate Limiting

- Respect platform rate limits
- Client-side throttling
- Spam prevention

### Authentication

- Secure token handling
- Scope validation
- Session management

---

## Dependencies

```json
{
  "dependencies": {
    "tmi.js": "^1.x",
    "html-entities": "^2.x"
  }
}
```

---

## Success Criteria

Phase 4 is complete when:

1. ✅ Twitch chat connects and displays messages
2. ✅ Kick chat connects and displays messages
3. ✅ Can send messages when authenticated
4. ✅ Emotes (all providers) render correctly
5. ✅ Moderation tools work for mods
6. ✅ Chat settings persist and apply
7. ✅ Performance is smooth at high message volumes

---

## Next Phase

→ **[Phase 5: Notifications & Alerts](./phase-5-notifications-spec.md)**

