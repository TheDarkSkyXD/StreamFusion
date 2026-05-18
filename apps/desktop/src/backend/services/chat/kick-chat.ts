/**
 * Kick Chat Service
 *
 * Manages Kick chat connections using Pusher WebSocket.
 * Handles message receiving, sending, and connection lifecycle.
 */

import Pusher from "pusher-js";
import { EventEmitter } from "../../../shared/browser-event-emitter";

// ... imports
import type {
  ChatConnectionState,
  ChatConnectionStatus,
  ChatMessage,
  ChatServiceEvents,
  KickPinnedMessage,
  KickPoll,
  NormalizedPinnedMessage,
} from "../../../shared/chat-types";

/**
 * U21 — Opt-in pre-emit hook. Renderer code that wants to apply a custom
 * AutoMod filter installs an interceptor; if it returns `true`, the message
 * is treated as held and is NOT emitted on the `message` event (so it never
 * reaches `chat-store`). Default behavior with no interceptor is unchanged.
 */
export type KickAutomodInterceptor = (message: ChatMessage) => boolean;
// Removed storageService import

// ... imports
import {
  type KickChatClearedEvent,
  type KickChatMessageEvent,
  type KickGiftedSubEvent,
  type KickHostRaidEvent,
  type KickMessageDeletedEvent,
  type KickSubscriptionEvent,
  type KickUserBannedEvent,
  parseKickBadges,
  parseKickChatCleared,
  parseKickChatMessage,
  parseKickGiftedSub,
  parseKickHostRaid,
  parseKickMessageDeleted,
  parseKickSubscription,
  parseKickUserBanned,
  type SubscriberBadge,
} from "./kick-parser";

/**
 * Convert a raw Kick pinned-message Pusher payload into the platform-agnostic
 * NormalizedPinnedMessage shape used by the shared PinnedMessageBanner.
 *
 * Kick's pinned-message body is plain text (no emote/mention parsing on the
 * Pusher event), so content is emitted as a single text fragment. If Kick ever
 * adds rich content to the pin payload, parse it here before constructing the
 * fragment list.
 */
export function kickPinToNormalized(pin: KickPinnedMessage): NormalizedPinnedMessage {
  // Kick's pin Pusher payload carries badges inside `sender.identity.badges`
  // and `pinned_by.identity.badges` — same shape as live chat messages. Map
  // through the same parser the rest of the Kick chat code uses, so the
  // shared PinnedMessageBanner gets the broadcaster / moderator / sub / VIP
  // / verified / OG / founder badges that twitch-style users expect.
  // No `subscriberBadges` argument is passed: the Pusher event doesn't
  // include channel-specific subscriber-tier data, so we fall back to the
  // global bundled assets for subscriber tiers.
  return {
    platform: "kick",
    messageId: pin.message.id,
    // Kick doesn't separate pin record id from chat message id — they're
    // the same thing on Kick's side. Use the message id for both.
    pinRecordId: pin.message.id,
    author: {
      username: pin.message.sender.username,
      displayName: pin.message.sender.username,
      color: pin.message.sender.identity.color,
      badges: parseKickBadges(pin.message.sender.identity.badges ?? []),
    },
    content: [{ type: "text", content: pin.message.content }],
    pinnedBy: pin.pinned_by
      ? {
          username: pin.pinned_by.username,
          color: pin.pinned_by.identity.color,
          badges: parseKickBadges(pin.pinned_by.identity.badges ?? []),
        }
      : null,
    pinnedAt: pin.message.created_at,
    // Kick doesn't separate "pinned at" from "message sent at" — use the
    // same `created_at` for both so the expanded card can still render
    // a sender-attribution timestamp.
    sentAt: pin.message.created_at,
    expiresAt: pin.finish_at ?? null,
  };
}

// NOTE: getPublicChannel was removed because it imports Electron-only modules (BrowserWindow)
// Subscriber badges must now be provided by the caller via setChannelBadges()

// ========== Types ==========

interface KickChatOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Kick OAuth Access Token (required for sending messages) */
  accessToken?: string;
}

interface ChannelInfo {
  /** Channel slug (username) */
  slug: string;
  /** Chatroom ID for WebSocket subscription */
  chatroomId: number;
  /** Pusher channel subscription (using ReturnType to avoid type conflicts) */
  pusherChannel?: ReturnType<Pusher["subscribe"]>;
}

type TypedEventEmitter = {
  on<K extends keyof ChatServiceEvents>(event: K, listener: ChatServiceEvents[K]): void;
  off<K extends keyof ChatServiceEvents>(event: K, listener: ChatServiceEvents[K]): void;
  emit<K extends keyof ChatServiceEvents>(
    event: K,
    ...args: Parameters<ChatServiceEvents[K]>
  ): boolean;
};

// ========== Constants ==========

const PUSHER_APP_KEY = "32cbd69e4b950bf97679";
const PUSHER_CLUSTER = "us2";
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;
const MESSAGE_RATE_LIMIT = 10; // Messages per 10 seconds (conservative)
const MOD_MESSAGE_RATE_LIMIT = 50; // Messages per 10 seconds for mods
const CONNECTION_TIMEOUT_MS = 30000; // 30 second timeout for initial connection

// WebSocket close codes that are transient and should not trigger error emissions
// 1006 = Abnormal closure (network issue, will auto-retry)
// 1001 = Going away (page unload, etc.)
const TRANSIENT_WS_CODES = new Set([1006, 1001]);

// ========== KickChatService Class ==========

export class KickChatService extends EventEmitter implements TypedEventEmitter {
  private pusher: Pusher | null = null;
  private channels: Map<string, ChannelInfo> = new Map(); // slug -> ChannelInfo
  private connectionState: ChatConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private debugMode = false;
  private accessToken: string | null = null;

  // Rate limiting
  private messageTimestamps: number[] = [];
  private isModerator: Map<string, boolean> = new Map(); // channel -> isMod
  private channelBadges: Map<string, SubscriberBadge[]> = new Map(); // channel -> badges

  // Platform isolation: prevents zombie reconnections when service should be inactive
  // When false, ALL connection attempts and reconnections are blocked
  private isActive = false;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;

  // Reference counting for multiview support
  // Tracks how many components are actively using this service
  // Only performs full shutdown when count reaches 0
  private activeUsers = 0;

  // U21 — Optional pre-emit interceptor. Default null = unchanged behavior.
  private automodInterceptor: KickAutomodInterceptor | null = null;

  // ========== Public API ==========

  /**
   * Connect to Kick Pusher WebSocket
   */
  async connect(options: KickChatOptions = {}): Promise<void> {
    // Mark service as active - allows connections and reconnections
    this.isActive = true;

    // If already connected, return immediately
    if (this.pusher && this.connectionState === "connected") {
      this.log("Already connected");
      return;
    }

    // If currently connecting, wait for the connection to complete
    if (this.pusher && this.connectionState === "connecting") {
      this.log("Connection already in progress, waiting...");
      return this.waitForConnection();
    }

    // Check if service was deactivated
    if (!this.isActive) {
      this.log("Service deactivated, aborting connection");
      return;
    }

    this.debugMode = options.debug ?? false;
    this.accessToken = options.accessToken || null;
    this.setConnectionState("connecting");

    try {
      // Create Pusher client
      this.pusher = this.createPusherClient();

      // Set up connection event handlers
      this.setupConnectionHandlers();

      this.log("Connecting to Kick Pusher WebSocket...");

      // Wait for the connection to actually be established
      await this.waitForConnection();

      // Check if service was deactivated during connection
      if (!this.isActive) {
        this.log("Service deactivated during connection, cleaning up");
        try {
          this.pusher?.disconnect();
        } catch {
          // Ignore
        }
        this.pusher = null;
        return;
      }
    } catch (error) {
      this.handleConnectionError(error);
      throw error;
    }
  }

  /**
   * Wait for Pusher connection to be established.
   *
   * Best practices applied:
   * - 30s timeout to allow for network variability
   * - Only timeout if Pusher has actually stopped trying (failed state)
   * - Don't reject while Pusher is in 'connecting' or 'unavailable' states (actively retrying)
   * - Allow Pusher's internal exponential backoff to work
   */
  private waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.pusher) {
        reject(new Error("Pusher client not initialized"));
        return;
      }

      // If already connected, resolve immediately
      if (this.pusher.connection.state === "connected") {
        resolve();
        return;
      }

      let timeoutId: NodeJS.Timeout | null = null;
      let hasResolved = false;

      const onConnected = () => {
        if (hasResolved) return;
        hasResolved = true;
        cleanup();
        resolve();
      };

      const onFailed = () => {
        if (hasResolved) return;
        hasResolved = true;
        cleanup();
        reject(new Error("Pusher connection failed permanently"));
      };

      const onTimeout = () => {
        if (hasResolved) return;

        // Check Pusher's actual state before timing out
        const currentState = this.pusher?.connection.state;

        // If Pusher is still actively trying, extend the timeout
        if (currentState === "connecting" || currentState === "unavailable") {
          this.log(`Connection still in progress (state: ${currentState}), extending timeout...`);
          // Give it another 15 seconds
          timeoutId = setTimeout(onTimeout, 15000);
          return;
        }

        // If we're already connected (race condition), resolve
        if (currentState === "connected") {
          onConnected();
          return;
        }

        // Otherwise, truly timed out
        hasResolved = true;
        cleanup();
        reject(new Error(`Pusher connection timed out (state: ${currentState})`));
      };

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        this.pusher?.connection.unbind("connected", onConnected);
        this.pusher?.connection.unbind("failed", onFailed);
      };

      // Set up initial timeout
      timeoutId = setTimeout(onTimeout, CONNECTION_TIMEOUT_MS);

      // Set up one-time listeners for connection result
      this.pusher.connection.bind("connected", onConnected);
      this.pusher.connection.bind("failed", onFailed);
      // Note: We don't bind to 'error' here because Pusher errors are often
      // transient and Pusher will automatically retry the connection.
    });
  }

  /**
   * Disconnect from Kick Pusher WebSocket
   * Note: This is a soft disconnect - service remains active for reconnection
   */
  async disconnect(): Promise<void> {
    // Cancel any pending reconnect
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (!this.pusher) return;

    try {
      // Unsubscribe from all channels
      for (const [_slug, info] of this.channels) {
        if (info.pusherChannel) {
          this.pusher.unsubscribe(`chatrooms.${info.chatroomId}.v2`);
        }
      }

      this.pusher.disconnect();
    } catch {
      // Ignore disconnect errors
    }

    this.pusher = null;
    this.channels.clear();
    this.setConnectionState("disconnected");
    this.log("Disconnected from Kick Pusher");
  }

  /**
   * Acquire a reference to this service (increment user count)
   * Call this when a component starts using the service
   * Must be paired with release() when the component unmounts
   */
  acquire(): void {
    this.activeUsers++;
    this.log(`Service acquired (active users: ${this.activeUsers})`);
  }

  /**
   * Release a reference to this service (decrement user count)
   * Call this when a component stops using the service
   * When the last user releases, the service will fully shutdown
   *
   * @param channel - Optional channel to leave before releasing
   * @returns Promise that resolves when cleanup is complete
   */
  async release(channel?: string): Promise<void> {
    // Leave the specific channel if provided
    if (channel) {
      await this.leaveChannel(channel);
    }

    this.activeUsers = Math.max(0, this.activeUsers - 1);
    this.log(`Service released (active users: ${this.activeUsers})`);

    // If no more users, perform full shutdown
    if (this.activeUsers === 0) {
      await this.shutdown();
    }
  }

  /**
   * Get the current number of active users
   */
  getActiveUserCount(): number {
    return this.activeUsers;
  }

  /**
   * Completely shutdown the service
   * This is a HARD shutdown - prevents ALL reconnection attempts
   *
   * In single-view mode: Called directly when switching platforms
   * In multi-view mode: Called automatically when last user releases
   *
   * You can also call forceShutdown() to bypass reference counting
   */
  async shutdown(): Promise<void> {
    // Check if other users are still active
    if (this.activeUsers > 0) {
      this.log(`Shutdown requested but ${this.activeUsers} users still active, skipping`);
      return;
    }

    await this.forceShutdown();
  }

  /**
   * Force shutdown regardless of active users
   * Use with caution - this will disconnect ALL users
   */
  async forceShutdown(): Promise<void> {
    this.log("Force shutting down Kick chat service...");

    // Mark service as inactive FIRST - this blocks all reconnection attempts
    this.isActive = false;
    this.activeUsers = 0;
    this.reconnectAttempts = 0;

    // Cancel any pending reconnect timeout
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (!this.pusher) {
      this.setConnectionState("disconnected");
      return;
    }

    try {
      // Unbind ALL connection handlers
      this.pusher.connection.unbind_all();

      // Unsubscribe from all channels (and drop their per-channel handlers
      // so closures don't outlive the Pusher socket).
      for (const [_slug, info] of this.channels) {
        if (info.pusherChannel) {
          info.pusherChannel.unbind_all();
          this.pusher.unsubscribe(`chatrooms.${info.chatroomId}.v2`);
          this.pusher.unsubscribe(`chatrooms.${info.chatroomId}`);
        }
      }

      this.pusher.disconnect();
    } catch {
      // Ignore disconnect errors
    }

    this.pusher = null;
    this.channels.clear();
    this.isModerator.clear();
    this.channelBadges.clear();
    this.setConnectionState("disconnected");
    this.log("Kick chat service shutdown complete");
  }

  /**
   * Check if the service is currently active
   */
  isServiceActive(): boolean {
    return this.isActive;
  }

  /**
   * Join a channel's chat
   * @param channel - Channel slug
   * @param chatroomId - Chatroom ID from Kick API
   */
  async joinChannel(channel: string, chatroomId: number): Promise<void> {
    const normalizedChannel = this.normalizeChannel(channel);

    if (this.channels.has(normalizedChannel)) {
      this.log(`Already in channel: ${normalizedChannel}`);
      return;
    }

    if (!this.pusher || this.connectionState !== "connected") {
      throw new Error("Not connected to Kick Pusher");
    }

    // Verify Pusher is actually connected (internal state can differ from ours)
    const pusherState = this.pusher.connection.state;
    if (pusherState !== "connected") {
      this.log(`Pusher not ready (state: ${pusherState}), waiting...`);
      // Wait for connection to be ready
      await this.waitForConnection();
    }

    try {
      // KickTalk subscribes to multiple channel patterns for better event coverage
      // We subscribe to both v2 (primary) and the base channel (fallback)
      const v2ChannelName = `chatrooms.${chatroomId}.v2`;
      const baseChannelName = `chatrooms.${chatroomId}`;

      this.log(`Subscribing to chatroom ${chatroomId}...`);

      // Subscribe to v2 channel (primary - has most events)
      const pusherChannel = this.pusher.subscribe(v2ChannelName);

      // Also subscribe to base channel for additional event coverage
      this.pusher.subscribe(baseChannelName);

      // Store channel info
      this.channels.set(normalizedChannel, {
        slug: normalizedChannel,
        chatroomId,
        pusherChannel,
      });

      // Set up event handlers for this channel
      this.setupChannelEventHandlers(pusherChannel, normalizedChannel);

      // NOTE: Channel badges should be set by caller via setChannelBadges()

      this.emitConnectionStatus();
      this.log(`Joined channel: ${normalizedChannel} (chatroom: ${chatroomId})`);
    } catch (error) {
      console.error(`Failed to join channel ${normalizedChannel}:`, error);
      throw error;
    }
  }

  /**
   * Leave a channel's chat
   */
  async leaveChannel(channel: string): Promise<void> {
    const normalizedChannel = this.normalizeChannel(channel);
    const channelInfo = this.channels.get(normalizedChannel);

    if (!channelInfo) {
      return;
    }

    if (this.pusher && channelInfo.pusherChannel) {
      // setupChannelEventHandlers() binds 14 event handlers on the Pusher
      // channel object. unsubscribe() removes the subscription but Pusher
      // retains the callbacks in its internal registry, leaking closures
      // (with references to this, channelSlug, the emitter) on every
      // channel switch. unbind_all() drops them.
      channelInfo.pusherChannel.unbind_all();

      const v2ChannelName = `chatrooms.${channelInfo.chatroomId}.v2`;
      const baseChannelName = `chatrooms.${channelInfo.chatroomId}`;
      this.pusher.unsubscribe(v2ChannelName);
      this.pusher.unsubscribe(baseChannelName);
    }

    this.channels.delete(normalizedChannel);
    this.isModerator.delete(normalizedChannel);
    this.emitConnectionStatus();
    this.log(`Left channel: ${normalizedChannel}`);
  }

  /**
   * Send a message to a channel
   * Note: Kick requires using the official API to send messages
   */
  async sendMessage(channel: string, message: string): Promise<void> {
    const normalizedChannel = this.normalizeChannel(channel);
    const channelInfo = this.channels.get(normalizedChannel);

    if (!channelInfo) {
      throw new Error(`Not in channel: ${normalizedChannel}`);
    }

    // Rate limiting
    if (!this.checkRateLimit(normalizedChannel)) {
      throw new Error("Message rate limit exceeded");
    }

    if (!this.accessToken) {
      throw new Error("Not authenticated with Kick");
    }

    try {
      // Use the Kick API to send the message
      const response = await fetch("https://api.kick.com/public/v1/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          broadcaster_user_id: channelInfo.chatroomId,
          content: message,
          type: "user",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send message: ${response.status} ${errorText}`);
      }

      this.recordMessageSent();
    } catch (error) {
      console.error(`Failed to send message to ${normalizedChannel}:`, error);
      throw error;
    }
  }

  // ... sendReply

  /**
   * Get current connection status
   */
  getConnectionStatus(): ChatConnectionStatus {
    return {
      platform: "kick",
      state: this.connectionState,
      channels: Array.from(this.channels.keys()),
      isAuthenticated: !!this.accessToken && this.connectionState === "connected",
    };
  }

  /**
   * Check if connected to a specific channel
   */
  isInChannel(channel: string): boolean {
    return this.channels.has(this.normalizeChannel(channel));
  }

  /**
   * Check if we are a moderator in a channel
   */
  isModeratorIn(channel: string): boolean {
    return this.isModerator.get(this.normalizeChannel(channel)) ?? false;
  }

  /**
   * Get chatroom ID for a channel (if joined)
   */
  getChatroomId(channel: string): number | null {
    const info = this.channels.get(this.normalizeChannel(channel));
    return info?.chatroomId ?? null;
  }

  // ========== Private Methods ==========

  /**
   * Set subscriber badges for a channel
   * Call this before or after joining a channel to enable proper badge rendering
   * @param channelSlug - Channel name/slug
   * @param badges - Array of subscriber badge data from the channel API
   */
  setChannelBadges(channelSlug: string, badges: SubscriberBadge[]): void {
    const normalizedChannel = this.normalizeChannel(channelSlug);
    this.channelBadges.set(normalizedChannel, badges);
    this.log(`Set ${badges.length} subscriber badges for ${normalizedChannel}`);
  }

  /**
   * Create Pusher client with appropriate options
   */
  private createPusherClient(): Pusher {
    return new Pusher(PUSHER_APP_KEY, {
      cluster: PUSHER_CLUSTER,
      forceTLS: true,
      enabledTransports: ["ws", "wss"],
    });
  }

  /**
   * Set up connection event handlers for the Pusher client
   */
  private setupConnectionHandlers(): void {
    if (!this.pusher) return;

    this.pusher.connection.bind("connected", () => {
      this.log("Pusher connected");
      this.setConnectionState("connected");
      this.reconnectAttempts = 0;
    });

    this.pusher.connection.bind("disconnected", () => {
      this.log("Pusher disconnected");
      this.handleDisconnect();
    });

    this.pusher.connection.bind("error", (error: unknown) => {
      // Pusher errors come in different formats
      // PusherError objects have type and data properties
      const errorObj = error as {
        type?: string;
        data?: { code?: number; message?: string };
        error?: { type?: string; data?: { code?: number } };
      };

      // Extract error code from various possible locations
      const code = errorObj.data?.code ?? errorObj.error?.data?.code;

      if (errorObj?.type === "PusherError" || errorObj?.error?.type === "PusherError") {
        // Check if this is a transient WebSocket error that Pusher will auto-retry
        if (code && TRANSIENT_WS_CODES.has(code)) {
          // Transient error - Pusher will auto-retry, just log at debug level
          this.log(`Transient Pusher error (code ${code}), auto-retrying...`);
          return;
        }

        // Log non-transient Pusher errors
        console.warn("Pusher error:", {
          type: errorObj.type,
          code,
          message: errorObj.data?.message,
        });

        // Only emit as error if it's a fatal code (4000-4099 are application errors)
        if (code && code >= 4000 && code < 4100) {
          this.emit(
            "error",
            new Error(`Pusher error ${code}: ${errorObj.data?.message || "Unknown error"}`)
          );
        }
        // Otherwise, let Pusher handle reconnection
      } else {
        // Unknown error format - log but don't emit unless it looks fatal
        console.warn("Pusher connection issue:", error);
        // Don't emit transient errors to avoid alarming the UI
      }
    });

    this.pusher.connection.bind("connecting", () => {
      this.log("Pusher connecting...");
      this.setConnectionState("connecting");
    });

    this.pusher.connection.bind("unavailable", () => {
      this.log("Pusher unavailable");
      this.setConnectionState("reconnecting");
    });

    this.pusher.connection.bind("failed", () => {
      this.log("Pusher connection failed");
      this.handleConnectionError(new Error("Pusher connection failed"));
    });
  }

  /**
   * Set up event handlers for a channel subscription
   */
  private setupChannelEventHandlers(
    pusherChannel: ReturnType<Pusher["subscribe"]>,
    channelSlug: string
  ): void {
    // Chat message event
    pusherChannel.bind("App\\Events\\ChatMessageEvent", (data: KickChatMessageEvent) => {
      this.handleChatMessage(data, channelSlug);
    });

    // Message deleted event
    pusherChannel.bind("App\\Events\\MessageDeletedEvent", (data: KickMessageDeletedEvent) => {
      const deletion = parseKickMessageDeleted(data, channelSlug);
      this.emit("messageDeleted", deletion);
    });

    // User banned event (timeout/ban)
    pusherChannel.bind("App\\Events\\UserBannedEvent", (data: KickUserBannedEvent) => {
      const clearChat = parseKickUserBanned(data, channelSlug);
      this.emit("clearChat", clearChat);
    });

    // Chat cleared event
    pusherChannel.bind("App\\Events\\ChatroomClearEvent", (data: KickChatClearedEvent) => {
      const clearChat = parseKickChatCleared(data, channelSlug);
      this.emit("clearChat", clearChat);
    });

    // Subscription event
    pusherChannel.bind("App\\Events\\SubscriptionEvent", (data: KickSubscriptionEvent) => {
      const notice = parseKickSubscription(data, channelSlug);
      this.emit("userNotice", notice);
    });

    // Gifted subscriptions event
    pusherChannel.bind("App\\Events\\GiftedSubscriptionsEvent", (data: KickGiftedSubEvent) => {
      const notice = parseKickGiftedSub(data, channelSlug);
      this.emit("userNotice", notice);
    });

    // Host/Raid event
    pusherChannel.bind("App\\Events\\StreamHostEvent", (data: KickHostRaidEvent) => {
      const notice = parseKickHostRaid(data, channelSlug);
      this.emit("userNotice", notice);
    });

    // Pinned message events
    pusherChannel.bind("App\\Events\\PinnedMessageCreatedEvent", (data: unknown) => {
      this.log(`Pinned message created in ${channelSlug}`);
      const pin = data as KickPinnedMessage;
      if (pin?.message) {
        this.emit("pinnedMessage", kickPinToNormalized(pin));
      }
    });

    pusherChannel.bind("App\\Events\\PinnedMessageDeletedEvent", (_data: unknown) => {
      this.log(`Pinned message deleted in ${channelSlug}`);
      this.emit("pinnedMessageCleared");
    });

    // Poll update event
    pusherChannel.bind("App\\Events\\PollUpdateEvent", (data: unknown) => {
      this.log(`Poll updated in ${channelSlug}`);
      const poll = data as KickPoll;
      if (poll?.title) {
        this.emit("pollUpdate", poll);
      }
    });

    // Subscription states
    pusherChannel.bind("pusher:subscription_succeeded", () => {
      this.log(`Subscription succeeded for ${channelSlug}`);
    });

    pusherChannel.bind("pusher:subscription_error", (error: unknown) => {
      console.error(`Subscription error for ${channelSlug}:`, error);
    });
  }

  /**
   * U21 — Install (or clear with `null`) a pre-emit interceptor that
   * decides whether a chat message should be held (filtered out of the live
   * chat stream). When the interceptor returns true, the parsed message is
   * NOT emitted on `"message"`, so it never reaches `chat-store`. The
   * interceptor is opt-in; absence of one preserves prior behavior exactly.
   */
  setAutomodInterceptor(fn: KickAutomodInterceptor | null): void {
    this.automodInterceptor = fn;
  }

  /**
   * Handle incoming chat message
   */
  private handleChatMessage(data: KickChatMessageEvent, channelSlug: string): void {
    const subscriberBadges = this.channelBadges.get(channelSlug);
    const message = parseKickChatMessage(data, channelSlug, subscriberBadges);
    // U21 — Pre-emit AutoMod filter. If installed and it returns true, the
    // message is treated as held: skip the `message` emit so chat-store
    // never sees it. The renderer-side AutoMod tab is responsible for
    // surfacing the held message via its own queue store.
    if (this.automodInterceptor) {
      try {
        if (this.automodInterceptor(message)) {
          return;
        }
      } catch (err) {
        // Never let a broken interceptor swallow chat. Log and continue.
        this.log(`AutoMod interceptor threw: ${(err as Error)?.message}`);
      }
    }
    this.emit("message", message);
  }

  /**
   * Handle disconnection and attempt reconnection
   * Only reconnects if service is still active (not shutdown)
   */
  private handleDisconnect(): void {
    this.setConnectionState("disconnected");

    // CRITICAL: Only attempt reconnection if service is still active
    // This prevents zombie reconnections when user has switched to a different platform
    if (!this.isActive) {
      this.log("Service inactive, skipping reconnection");
      return;
    }

    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      this.setConnectionState("reconnecting");

      const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;
      this.log(
        `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
      );

      // Store timeout ID so we can cancel it on shutdown
      this.reconnectTimeoutId = setTimeout(async () => {
        this.reconnectTimeoutId = null;

        // Double-check service is still active before reconnecting
        if (!this.isActive) {
          this.log("Service deactivated during reconnect delay, aborting");
          return;
        }

        try {
          await this.connect({ debug: this.debugMode });

          // Rejoin channels (only if still active)
          if (this.isActive) {
            for (const [slug, info] of this.channels) {
              // We need to resubscribe with the stored chatroomId
              await this.joinChannel(slug, info.chatroomId);
            }
          }
        } catch (error) {
          console.error("Reconnection failed:", error);
        }
      }, delay);
    } else {
      this.log("Max reconnection attempts reached");
      this.emit("error", new Error("Max reconnection attempts reached"));
    }
  }

  /**
   * Handle connection error
   */
  private handleConnectionError(error: unknown): void {
    console.error("Kick chat connection error:", error);
    this.setConnectionState("disconnected");
    this.emit("error", error instanceof Error ? error : new Error(String(error)));
  }

  /**
   * Update and emit connection state
   */
  private setConnectionState(state: ChatConnectionState): void {
    this.connectionState = state;
    this.emitConnectionStatus();
  }

  /**
   * Emit current connection status
   */
  private emitConnectionStatus(): void {
    this.emit("connectionStateChange", this.getConnectionStatus());
  }

  /**
   * Normalize channel name (lowercase)
   */
  private normalizeChannel(channel: string): string {
    return channel.toLowerCase();
  }

  /**
   * Check if we can send a message (rate limiting)
   */
  private checkRateLimit(channel: string): boolean {
    const now = Date.now();
    const tenSecondsAgo = now - 10000;

    // Clean old timestamps
    this.messageTimestamps = this.messageTimestamps.filter((ts) => ts > tenSecondsAgo);

    const limit = this.isModerator.get(channel) ? MOD_MESSAGE_RATE_LIMIT : MESSAGE_RATE_LIMIT;

    return this.messageTimestamps.length < limit;
  }

  /**
   * Record a sent message for rate limiting
   */
  private recordMessageSent(): void {
    this.messageTimestamps.push(Date.now());
  }

  /**
   * Log message (respects debug mode)
   */
  private log(message: string): void {
    if (this.debugMode) {
      console.debug(`[KickChat] ${message}`);
    }
  }
}

// ========== Export Singleton ==========

export const kickChatService = new KickChatService();
