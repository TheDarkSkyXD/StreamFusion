/**
 * Twitch Chat Service
 *
 * Manages Twitch IRC chat connections using tmi.js.
 * Handles message receiving, sending, and connection lifecycle.
 */

import tmi from "tmi.js";
import type { TwitchUser } from "../../../shared/auth-types";
import { EventEmitter } from "../../../shared/browser-event-emitter";
import type {
  ChatConnectionState,
  ChatConnectionStatus,
  ChatServiceEvents,
  UserNotice,
} from "../../../shared/chat-types";

import { badgeResolver } from "./badge-resolver";
import { parseTwitchMessage, type TwitchTags } from "./twitch-parser";
import { roomStateTagsToPatch, type TmiRoomStateTags } from "./twitch-roomstate";

// ========== Types ==========

interface TwitchChatOptions {
  /** Connect anonymously (read-only) if true */
  anonymous?: boolean;
  /** Enable debug logging */
  debug?: boolean;
  /** Twitch OAuth Access Token (required if not anonymous) */
  accessToken?: string;
  /** Twitch Client ID (required for badges) */
  clientId?: string;
  /** Twitch User info (required for identity) */
  user?: TwitchUser;
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

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;
const MESSAGE_RATE_LIMIT = 20; // Messages per 30 seconds (normal user)
const MOD_MESSAGE_RATE_LIMIT = 100; // Messages per 30 seconds (mod/broadcaster)
const CONNECTION_TIMEOUT_MS = 30000; // 30 second timeout for initial connection

// ========== TwitchChatService Class ==========

export class TwitchChatService extends EventEmitter implements TypedEventEmitter {
  private client: tmi.Client | null = null;
  private channels: Set<string> = new Set();
  private connectionState: ChatConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private isAnonymous = false;
  private debugMode = false;
  private broadcasterId: Map<string, string> = new Map(); // channel -> broadcaster ID

  // Creds
  private accessToken: string | null = null;
  private clientId: string | null = null;
  private user: TwitchUser | null = null;

  // Rate limiting
  private messageTimestamps: number[] = [];
  private isModerator: Map<string, boolean> = new Map(); // channel -> isMod

  // Connection tracking for React Strict Mode race condition prevention
  private isConnecting = false;
  private currentConnectionId = 0;

  // Platform isolation: prevents zombie reconnections when service should be inactive
  // When false, ALL connection attempts and reconnections are blocked
  private isActive = false;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;

  // Reference counting for multiview support
  // Tracks how many components are actively using this service
  // Only performs full shutdown when count reaches 0
  private activeUsers = 0;

  // ========== Public API ==========

  /**
   * Connect to Twitch IRC
   * Uses connection ID tracking to handle React Strict Mode race conditions
   */
  async connect(options: TwitchChatOptions = {}): Promise<void> {
    // Mark service as active - allows connections and reconnections
    this.isActive = true;

    // If already connected, just return
    if (this.client && this.connectionState === "connected") {
      this.log("Already connected");
      return;
    }

    // If already connecting, wait for that connection or abort
    if (this.isConnecting) {
      this.log("Connection already in progress, waiting...");
      // Wait a bit and check if connection completed
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (this.connectionState === "connected") {
        this.log("Connection completed while waiting");
        return;
      }
    }

    // Check if service was deactivated while waiting
    if (!this.isActive) {
      this.log("Service deactivated, aborting connection");
      return;
    }

    // Generate a unique connection ID for this attempt
    const connectionId = ++this.currentConnectionId;
    this.isConnecting = true;

    this.debugMode = options.debug ?? false;
    this.isAnonymous = options.anonymous ?? false;

    if (!this.isAnonymous) {
      this.accessToken = options.accessToken || null;
      this.clientId = options.clientId || null;
      this.user = options.user || null;
    }

    this.setConnectionState("connecting");

    try {
      // Check if this connection attempt was aborted
      if (connectionId !== this.currentConnectionId) {
        this.log(`Connection ${connectionId} aborted (superseded by ${this.currentConnectionId})`);
        return;
      }

      // Load global badges if credentials are present
      if (this.accessToken && this.clientId) {
        await badgeResolver.loadGlobalBadges(this.accessToken, this.clientId);
      }

      // Check again after async operation
      if (connectionId !== this.currentConnectionId) {
        this.log(`Connection ${connectionId} aborted after badge load`);
        return;
      }

      // Create client
      this.client = this.createClient();

      // Set up event handlers
      this.setupEventHandlers();

      // Connect with proper await - wait for 'connected' event
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Twitch IRC connection timed out"));
        }, CONNECTION_TIMEOUT_MS);

        const onConnected = () => {
          clearTimeout(timeout);
          this.client?.removeListener("disconnected", onDisconnected);
          resolve();
        };

        const onDisconnected = (reason: string) => {
          clearTimeout(timeout);
          this.client?.removeListener("connected", onConnected);
          reject(new Error(`Connection failed: ${reason}`));
        };

        this.client?.once("connected", onConnected);
        this.client?.once("disconnected", onDisconnected);

        // Initiate connection
        this.client?.connect().catch((err) => {
          clearTimeout(timeout);
          this.client?.removeListener("connected", onConnected);
          this.client?.removeListener("disconnected", onDisconnected);
          reject(err);
        });
      });

      // Check if service was deactivated during connection
      if (!this.isActive) {
        this.log(`Connection ${connectionId} aborted - service deactivated`);
        try {
          await this.client?.disconnect();
        } catch {
          // Ignore
        }
        this.client = null;
        return;
      }

      // Final check before declaring success
      if (connectionId !== this.currentConnectionId) {
        this.log(`Connection ${connectionId} aborted after IRC connect`);
        // Clean up the client we just connected
        try {
          await this.client?.disconnect();
        } catch {
          // Ignore
        }
        this.client = null;
        return;
      }

      this.reconnectAttempts = 0;
      this.setConnectionState("connected");
      this.log("Connected to Twitch IRC");
    } catch (error) {
      // Only handle error if this is still the active connection attempt
      if (connectionId === this.currentConnectionId) {
        this.handleConnectionError(error);
        throw error;
      }
      // Otherwise, silently ignore - this connection was superseded
      this.log(`Connection ${connectionId} error ignored (superseded)`);
    } finally {
      // Only clear isConnecting if this is the current connection
      if (connectionId === this.currentConnectionId) {
        this.isConnecting = false;
      }
    }
  }

  /**
   * Disconnect from Twitch IRC
   * Increments connection ID to abort any in-progress connections
   * Note: This is a soft disconnect - service remains active for reconnection
   */
  async disconnect(): Promise<void> {
    // Increment connection ID to abort any in-progress connection attempts
    this.currentConnectionId++;
    this.isConnecting = false;

    // Cancel any pending reconnect
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (!this.client) {
      this.setConnectionState("disconnected");
      return;
    }

    // Prevent reconnect logic from triggering during intentional disconnect
    this.client.removeAllListeners("disconnected");

    try {
      await this.client.disconnect();
    } catch {
      // Ignore disconnect errors
    }

    this.client = null;
    this.channels.clear();
    this.setConnectionState("disconnected");
    this.log("Disconnected from Twitch IRC");
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
    this.log("Force shutting down Twitch chat service...");

    // Mark service as inactive FIRST - this blocks all reconnection attempts
    this.isActive = false;
    this.activeUsers = 0;

    // Increment connection ID to abort any in-progress connection attempts
    this.currentConnectionId++;
    this.isConnecting = false;
    this.reconnectAttempts = 0;

    // Cancel any pending reconnect timeout
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (!this.client) {
      this.setConnectionState("disconnected");
      return;
    }

    // Remove ALL listeners to prevent any callbacks from firing
    this.client.removeAllListeners();

    try {
      await this.client.disconnect();
    } catch {
      // Ignore disconnect errors
    }

    this.client = null;
    this.channels.clear();
    this.broadcasterId.clear();
    this.isModerator.clear();
    this.setConnectionState("disconnected");
    this.log("Twitch chat service shutdown complete");
  }

  /**
   * Check if the service is currently active
   */
  isServiceActive(): boolean {
    return this.isActive;
  }

  /**
   * Join a channel's chat
   */
  async joinChannel(channel: string, broadcasterId?: string): Promise<void> {
    const normalizedChannel = this.normalizeChannel(channel);

    if (this.channels.has(normalizedChannel)) {
      this.log(`Already in channel: ${normalizedChannel}`);
      return;
    }

    if (!this.client || this.connectionState !== "connected") {
      throw new Error("Not connected to Twitch IRC");
    }

    try {
      await this.client.join(normalizedChannel);
      this.channels.add(normalizedChannel);

      // Store broadcaster ID for badge resolution
      if (broadcasterId) {
        this.broadcasterId.set(normalizedChannel, broadcasterId);
        if (this.accessToken && this.clientId) {
          await badgeResolver.loadChannelBadges(broadcasterId, this.accessToken, this.clientId);
        }
      }

      this.emitConnectionStatus();
      this.log(`Joined channel: ${normalizedChannel}`);
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

    if (!this.channels.has(normalizedChannel)) {
      return;
    }

    if (!this.client) {
      this.channels.delete(normalizedChannel);
      return;
    }

    try {
      await this.client.part(normalizedChannel);
      this.channels.delete(normalizedChannel);
      this.broadcasterId.delete(normalizedChannel);
      this.isModerator.delete(normalizedChannel);
      this.emitConnectionStatus();
      this.log(`Left channel: ${normalizedChannel}`);
    } catch (error) {
      console.error(`Failed to leave channel ${normalizedChannel}:`, error);
    }
  }

  /**
   * Send a message to a channel
   */
  async sendMessage(channel: string, message: string): Promise<void> {
    if (this.isAnonymous) {
      throw new Error("Cannot send messages in anonymous mode");
    }

    if (!this.client || this.connectionState !== "connected") {
      throw new Error("Not connected to Twitch IRC");
    }

    const normalizedChannel = this.normalizeChannel(channel);

    if (!this.channels.has(normalizedChannel)) {
      throw new Error(`Not in channel: ${normalizedChannel}`);
    }

    // Rate limiting
    if (!this.checkRateLimit(normalizedChannel)) {
      throw new Error("Message rate limit exceeded");
    }

    try {
      await this.client.say(normalizedChannel, message);
      this.recordMessageSent();
    } catch (error) {
      console.error(`Failed to send message to ${normalizedChannel}:`, error);
      throw error;
    }
  }

  /**
   * Send a /me action message
   */
  async sendAction(channel: string, message: string): Promise<void> {
    if (this.isAnonymous) {
      throw new Error("Cannot send messages in anonymous mode");
    }

    if (!this.client || this.connectionState !== "connected") {
      throw new Error("Not connected to Twitch IRC");
    }

    const normalizedChannel = this.normalizeChannel(channel);

    if (!this.checkRateLimit(normalizedChannel)) {
      throw new Error("Message rate limit exceeded");
    }

    try {
      await this.client.action(normalizedChannel, message);
      this.recordMessageSent();
    } catch (error) {
      console.error(`Failed to send action to ${normalizedChannel}:`, error);
      throw error;
    }
  }

  /**
   * Send a reply to a message
   */
  async sendReply(channel: string, parentMessageId: string, message: string): Promise<void> {
    if (!this.client || this.connectionState !== "connected") {
      throw new Error("Not connected to Twitch IRC");
    }

    const normalizedChannel = this.normalizeChannel(channel);

    if (!this.checkRateLimit(normalizedChannel)) {
      throw new Error("Message rate limit exceeded");
    }

    try {
      // tmi.js doesn't have native reply support, use raw command
      await this.client.raw(
        `@reply-parent-msg-id=${parentMessageId} PRIVMSG #${normalizedChannel} :${message}`
      );
      this.recordMessageSent();
    } catch (error) {
      console.error(`Failed to send reply in ${normalizedChannel}:`, error);
      throw error;
    }
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): ChatConnectionStatus {
    return {
      platform: "twitch",
      state: this.connectionState,
      channels: Array.from(this.channels),
      isAuthenticated: !this.isAnonymous && this.connectionState === "connected",
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

  // ========== Private Methods ==========

  /**
   * Create tmi.js client with appropriate options
   */
  /**
   * Create tmi.js client with appropriate options
   */
  private createClient(): tmi.Client {
    const options: tmi.Options = {
      options: {
        debug: this.debugMode,
        skipUpdatingEmotesets: true,
      },
      logger: {
        info: (msg: string) => {
          // if (this.debugMode) console.info(`[TMI] ${msg}`);
        },
        warn: (msg: string) => {
          // if (this.debugMode) console.warn(`[TMI] ${msg}`);
        },
        error: (msg: string) => {
          console.error(`[TMI] ${msg}`);
        },
      },
      connection: {
        // IMPORTANT: Disable tmi.js auto-reconnect - we handle reconnection manually
        // This gives us full control and prevents zombie connections when service is inactive
        reconnect: false,
        secure: true,
      },
    };

    // Authenticated or anonymous connection
    if (!this.isAnonymous && this.accessToken && this.user) {
      options.identity = {
        username: this.user.login,
        password: `oauth:${this.accessToken}`,
      };
    }

    return new tmi.Client(options);
  }

  /**
   * Set up event handlers for the tmi.js client
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    // Connection events
    this.client.on("connected", () => {
      this.setConnectionState("connected");
      this.reconnectAttempts = 0;
    });

    this.client.on("disconnected", (reason) => {
      this.log(`Disconnected: ${reason}`);
      this.handleDisconnect();
    });

    this.client.on("reconnect", () => {
      this.setConnectionState("reconnecting");
    });

    // Message events
    this.client.on("message", (channel, tags, message, self) => {
      this.handleMessage(channel, tags as TwitchTags, message, self);
    });

    this.client.on("action", (_channel, _tags, _message, _self) => {
      // Action messages are handled by the 'message' event with message-type: action
      // This is redundant but we can use it for logging
    });

    // User notice events (subs, raids, etc.)
    this.client.on("resub", (channel, _username, _months, message, tags, _methods) => {
      this.handleUserNotice("resub", channel, tags as TwitchTags, message);
    });

    this.client.on("subscription", (channel, _username, _methods, message, tags) => {
      this.handleUserNotice("sub", channel, tags as TwitchTags, message);
    });

    this.client.on("subgift", (channel, _username, _streakMonths, _recipient, _methods, tags) => {
      this.handleUserNotice("subgift", channel, tags as TwitchTags, undefined);
    });

    this.client.on("raided", (channel, username, viewers) => {
      // Note: raided event doesn't provide tags, create minimal notice
      const notice: UserNotice = {
        id: crypto.randomUUID(),
        platform: "twitch",
        channel: this.normalizeChannel(channel),
        type: "raid",
        userId: "",
        username: username.toLowerCase(),
        displayName: username,
        message: undefined,
        systemMessage: `${username} is raiding with ${viewers} viewers!`,
        timestamp: new Date(),
        viewerCount: viewers,
      };
      this.emit("userNotice", notice);
    });

    // Moderation events
    this.client.on("clearchat", (channel) => {
      this.emit("clearChat", {
        platform: "twitch",
        channel: this.normalizeChannel(channel),
        isClearAll: true,
        timestamp: new Date(),
      });
    });

    this.client.on("timeout", (channel, username, _reason, duration, tags) => {
      const typedTags = tags as Record<string, unknown>;
      this.emit("clearChat", {
        platform: "twitch",
        channel: this.normalizeChannel(channel),
        targetUserId: typedTags["target-user-id"] as string | undefined,
        targetUsername: username,
        duration,
        isClearAll: false,
        timestamp: new Date(),
      });
    });

    this.client.on("ban", (channel, username, _reason, tags) => {
      const typedTags = tags as Record<string, unknown>;
      this.emit("clearChat", {
        platform: "twitch",
        channel: this.normalizeChannel(channel),
        targetUserId: typedTags["target-user-id"] as string | undefined,
        targetUsername: username,
        isClearAll: false,
        timestamp: new Date(),
      });
    });

    this.client.on("messagedeleted", (channel, _username, _deletedMessage, tags) => {
      const typedTags = tags as Record<string, unknown>;
      this.emit("messageDeleted", {
        platform: "twitch",
        channel: this.normalizeChannel(channel),
        messageId: (typedTags["target-msg-id"] as string) ?? "",
        timestamp: new Date(),
      });
    });

    // Mod status
    this.client.on("mod", (channel, username) => {
      if (this.user && username.toLowerCase() === this.user.login.toLowerCase()) {
        this.isModerator.set(this.normalizeChannel(channel), true);
      }
    });

    this.client.on("unmod", (channel, username) => {
      if (this.user && username.toLowerCase() === this.user.login.toLowerCase()) {
        this.isModerator.set(this.normalizeChannel(channel), false);
      }
    });

    // ROOMSTATE — chat-settings tags (followers-only, slow, r9k, emote-only, subs-only)
    // tmi.js emits this on initial join and on every settings change. The
    // pure translator lives in twitch-roomstate.ts so it can be unit-tested
    // without the tmi.js client.
    this.client.on("roomstate", (channel, state) => {
      const patch = roomStateTagsToPatch(state as TmiRoomStateTags);
      const channelLogin = this.normalizeChannel(channel);
      const channelId = state["room-id"] ?? this.broadcasterId.get(channelLogin) ?? "";
      if (!channelId) return; // no id → nothing useful for the store keying
      this.emit("roomState", {
        platform: "twitch",
        channel: channelLogin,
        channelId,
        patch,
        reason: "ws",
      });
    });
  }

  /**
   * Handle incoming chat message
   */
  private handleMessage(channel: string, tags: TwitchTags, message: string, self: boolean): void {
    const parsedMessage = parseTwitchMessage(channel, tags, message, self);

    // Resolve badges with channel-specific ones
    const broadcasterId = this.broadcasterId.get(this.normalizeChannel(channel));
    if (broadcasterId) {
      parsedMessage.badges = badgeResolver.resolveBadges(parsedMessage.badges, broadcasterId);
    }

    this.emit("message", parsedMessage);
  }

  /**
   * Handle user notice events (subs, raids, etc.)
   */
  private handleUserNotice(
    type: "sub" | "resub" | "subgift" | "raid",
    channel: string,
    tags: TwitchTags,
    message: string | undefined
  ): void {
    const typedTags = tags as Record<string, unknown>;
    const notice: UserNotice = {
      id: (typedTags.id as string) ?? crypto.randomUUID(),
      platform: "twitch",
      channel: this.normalizeChannel(channel),
      type,
      userId: (typedTags["user-id"] as string) ?? "",
      username: ((typedTags["display-name"] as string) ?? "").toLowerCase(),
      displayName: (typedTags["display-name"] as string) ?? "",
      message,
      systemMessage: (typedTags["system-msg"] as string) ?? "",
      timestamp: new Date(),
    };

    this.emit("userNotice", notice);
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
          await this.connect({ anonymous: this.isAnonymous, debug: this.debugMode });

          // Rejoin channels (only if still active)
          if (this.isActive) {
            for (const channel of this.channels) {
              await this.joinChannel(channel);
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
    console.error("Twitch chat connection error:", error);
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
   * Normalize channel name (lowercase, no #)
   */
  private normalizeChannel(channel: string): string {
    return channel.toLowerCase().replace("#", "");
  }

  /**
   * Check if we can send a message (rate limiting)
   */
  private checkRateLimit(channel: string): boolean {
    const now = Date.now();
    const thirtySecondsAgo = now - 30000;

    // Clean old timestamps
    this.messageTimestamps = this.messageTimestamps.filter((ts) => ts > thirtySecondsAgo);

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
      console.debug(`[TwitchChat] ${message}`);
    }
  }
}

// ========== Export Singleton ==========

export const twitchChatService = new TwitchChatService();
