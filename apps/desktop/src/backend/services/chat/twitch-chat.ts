/**
 * Twitch Chat Service
 *
 * Manages Twitch IRC chat connections using tmi.js.
 * Handles message receiving, sending, and connection lifecycle.
 */

import tmi from "tmi.js";
// Cross-logger: imported by renderer chat components — avoids dragging
// electron-log into the renderer bundle.
import { logger } from "@/lib/cross-logger";
import { sleep } from "@/lib/sleep";
import type { TwitchUser } from "../../../shared/auth-types";
import { EventEmitter } from "../../../shared/browser-event-emitter";
import type {
  ChatConnectionState,
  ChatConnectionStatus,
  ChatMessage,
  ChatServiceEvents,
  ContentFragment,
  UserNotice,
} from "../../../shared/chat-types";
import { buildChannelKey, useChatStore } from "../../../store/chat-store";
import { badgeResolver } from "./badge-resolver";
import {
  getDefaultColor,
  parseBadgeTags,
  parseTwitchMessage,
  type TwitchTags,
} from "./twitch-parser";
import {
  noticeMsgIdToRoomStatePatch,
  roomStateTagsToPatch,
  type TmiRoomStateTags,
} from "./twitch-roomstate";

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
  /**
   * Called before each reconnect to obtain a fresh access token. Twitch IRC
   * closes the WSS connection when the underlying OAuth token expires, and
   * the cached token captured at original connect time is then stale — the
   * reconnect will re-fail with "Login unsuccessful" unless we refresh.
   * Returns null to fall back to anonymous reconnection.
   */
  tokenFetcher?: () => Promise<string | null>;
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
  private tokenFetcher: (() => Promise<string | null>) | null = null;

  // Rate limiting
  private messageTimestamps: number[] = [];
  private isModerator: Map<string, boolean> = new Map(); // channel -> isMod

  // Connection tracking for React Strict Mode race condition prevention
  private currentConnectionId = 0;
  // Single-flight: a concurrent connect() awaits the in-flight attempt instead
  // of racing a second one. Mirrors the `_inFlight` pattern in follow-endpoints.
  private connectingPromise: Promise<void> | null = null;

  // Platform isolation: prevents zombie reconnections when service should be inactive
  // When false, ALL connection attempts and reconnections are blocked
  private isActive = false;

  // Reference counting for multiview support
  // Tracks how many components are actively using this service
  // Only performs full shutdown when count reaches 0
  private activeUsers = 0;
  private channelUsers: Map<string, number> = new Map();

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

    // If a connection attempt is already in flight, ride it rather than guessing
    // a delay or racing a second attempt. A failed in-flight attempt (.catch)
    // falls through to a fresh connect below.
    if (this.connectingPromise) {
      this.log("Connection already in progress, awaiting it...");
      await this.connectingPromise.catch(() => {});
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

    const attempt = this._doConnect(options);
    this.connectingPromise = attempt;
    try {
      await attempt;
    } finally {
      // Only clear if a newer attempt hasn't replaced this one.
      if (this.connectingPromise === attempt) this.connectingPromise = null;
    }
  }

  /**
   * Run a single Twitch IRC connection attempt. Wrapped by `connect()` so that
   * concurrent callers share one in-flight attempt (see `connectingPromise`).
   */
  private async _doConnect(options: TwitchChatOptions): Promise<void> {
    // Generate a unique connection ID for this attempt
    const connectionId = ++this.currentConnectionId;

    this.debugMode = options.debug ?? false;
    this.isAnonymous = options.anonymous ?? false;

    if (!this.isAnonymous) {
      // Only overwrite when the option was explicitly provided. On reconnect
      // the caller passes `{anonymous, debug}` without creds — preserving the
      // existing identity keeps the chat authenticated across token rotations.
      if (options.accessToken !== undefined) this.accessToken = options.accessToken;
      if (options.clientId !== undefined) this.clientId = options.clientId;
      if (options.user !== undefined) this.user = options.user;
      if (options.tokenFetcher !== undefined) this.tokenFetcher = options.tokenFetcher;
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
        // timer-allowlist: IRC connection-timeout watchdog inside _doConnect connected-event waiter (SP1/SP3 out-of-scope)
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
    this.connectingPromise = null;

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
  acquire(channel?: string): void {
    this.activeUsers++;
    if (channel) {
      const normalizedChannel = this.normalizeChannel(channel);
      this.channelUsers.set(normalizedChannel, (this.channelUsers.get(normalizedChannel) ?? 0) + 1);
    }
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
    let shouldLeaveChannel = false;
    if (channel) {
      const normalizedChannel = this.normalizeChannel(channel);
      const channelUserCount = this.channelUsers.get(normalizedChannel);
      if (channelUserCount === undefined || channelUserCount <= 1) {
        this.channelUsers.delete(normalizedChannel);
        shouldLeaveChannel = true;
      } else {
        this.channelUsers.set(normalizedChannel, channelUserCount - 1);
      }
    }

    // Leave and evict the specific channel only after its final panel releases.
    if (channel && shouldLeaveChannel) {
      await this.leaveChannel(channel);
      useChatStore
        .getState()
        .dropChannel(buildChannelKey("twitch", this.normalizeChannel(channel)));
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
    this.connectingPromise = null;
    this.reconnectAttempts = 0;

    const { dropChannel } = useChatStore.getState();
    for (const channel of this.channels) {
      dropChannel(buildChannelKey("twitch", channel));
    }
    this.channelUsers.clear();

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
      logger.error("Chat:Twitch", "Failed to join channel", {
        channel: normalizedChannel,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
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
      logger.error("Chat:Twitch", "Failed to leave channel", {
        channel: normalizedChannel,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }

  /**
   * Send a message to a channel.
   *
   * @param localFragments  Pre-rendered fragments for the optimistic local
   *   echo, mirroring the Kick send-path. Without this the viewer's OWN
   *   sent emote renders as the raw NAME inside the app: tmi.js does fire
   *   a synthetic self-`message` event after `say()`, but our client opts
   *   into `skipUpdatingEmotesets: true` (see `createClient`), so tmi.js
   *   can't stamp emote tags onto that self-echo. Without tags the parser
   *   produces a single text fragment and the renderer shows the bare
   *   emote name. The rich fragments here are built upstream from the
   *   input's emote slots and cover BOTH native Twitch emotes (whose names
   *   tmi.js can't resolve here) and third-party 7TV / BTTV / FFZ.
   */
  async sendMessage(
    channel: string,
    message: string,
    localFragments?: ContentFragment[]
  ): Promise<void> {
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
      this.emitSelfEcho(normalizedChannel, message, localFragments, false);
    } catch (error) {
      logger.error("Chat:Twitch", "Failed to send message", {
        channel: normalizedChannel,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  /**
   * Emit a synthetic `message` event for the viewer's own outbound message
   * so it shows up immediately in their chat panel with proper emote images.
   * tmi.js's self-`message` event STILL fires later (without emote tags
   * because `skipUpdatingEmotesets` is on) — it lands as a separate stored
   * row whose text fragment containing only the emote name is fine to
   * tolerate as a brief duplicate; the chat-store dedup prefers the
   * emote-richer copy when ids happen to align.
   */
  private emitSelfEcho(
    channel: string,
    message: string,
    localFragments: ContentFragment[] | undefined,
    isAction: boolean
  ): void {
    if (!this.user) return;
    const fragments: ContentFragment[] =
      localFragments && localFragments.length > 0
        ? localFragments
        : [{ type: "text", content: message }];
    // tmi.js stores the viewer's USERSTATE per channel (color, badges,
    // display-name) — accumulated from the USERSTATE IRC frame Twitch emits
    // on join and after every successful send. Pull color + badges from
    // there so the echo matches the appearance of the same user's messages
    // arriving from other clients. Fall back to globaluserstate (set on
    // GLOBALUSERSTATE at login) for the rare race where channel state isn't
    // populated yet, then to a sensible default per the parser convention.
    // tmi.js uses `#channel` keys internally.
    const tmiChannelKey = channel.startsWith("#") ? channel : `#${channel}`;
    const tmiClient = this.client as unknown as {
      userstate?: Record<string, Record<string, unknown> | undefined>;
      globaluserstate?: Record<string, unknown>;
    } | null;
    const channelState = tmiClient?.userstate?.[tmiChannelKey];
    const globalState = tmiClient?.globaluserstate;
    const color =
      (channelState?.color as string | undefined) ||
      (globalState?.color as string | undefined) ||
      getDefaultColor(this.user.login);
    const badgesTag =
      (channelState?.badges as Record<string, string> | undefined) ||
      (globalState?.badges as Record<string, string> | undefined);
    const broadcasterId = this.broadcasterId.get(this.normalizeChannel(channel));
    const echo: ChatMessage = {
      id: crypto.randomUUID(),
      platform: "twitch",
      type: "message",
      channel,
      userId: this.user.id,
      username: this.user.login.toLowerCase(),
      displayName: this.user.displayName ?? this.user.login,
      color,
      badges: broadcasterId
        ? badgeResolver.resolveBadges(parseBadgeTags(badgesTag), broadcasterId)
        : parseBadgeTags(badgesTag),
      content: fragments,
      rawContent: message,
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction,
    };
    this.emit("message", echo);
  }

  /**
   * Send a /me action message
   */
  async sendAction(
    channel: string,
    message: string,
    localFragments?: ContentFragment[]
  ): Promise<void> {
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
      this.emitSelfEcho(normalizedChannel, message, localFragments, true);
    } catch (error) {
      logger.error("Chat:Twitch", "Failed to send action", {
        channel: normalizedChannel,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  /**
   * Send a reply to a message
   */
  async sendReply(
    channel: string,
    parentMessageId: string,
    message: string,
    localFragments?: ContentFragment[]
  ): Promise<void> {
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
      this.emitSelfEcho(normalizedChannel, message, localFragments, false);
    } catch (error) {
      logger.error("Chat:Twitch", "Failed to send reply", {
        channel: normalizedChannel,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
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
          logger.error("Chat:Twitch", msg);
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

    this.client.on("notice", (channel, msgId) => {
      const patch = noticeMsgIdToRoomStatePatch(msgId);
      if (Object.keys(patch).length === 0) return;
      const channelLogin = this.normalizeChannel(channel);
      const channelId = this.broadcasterId.get(channelLogin) ?? "";
      if (!channelId) return;
      this.emit("roomState", {
        platform: "twitch",
        channel: channelLogin,
        channelId,
        patch,
        reason: "ws",
      });
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
    // Drop tmi.js's synthetic self-echo: every authenticated send path
    // (sendMessage / sendAction / sendReply) already emits its own optimistic
    // echo via `emitSelfEcho`, which carries the rich `localFragments` built
    // from the input's emote slots. Letting tmi.js's later text-only echo
    // through duplicates the message — once as the proper emote image, once
    // as the bare name — because the two events carry different random ids
    // and dedup-by-id can't collapse them.
    if (self) return;
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

      // Capture connection ID so a disconnect() during the delay aborts the reconnect
      const capturedConnectionId = this.currentConnectionId;
      void sleep(delay).then(async () => {
        // Double-check service is still active before reconnecting
        if (!this.isActive) {
          this.log("Service deactivated during reconnect delay, aborting");
          return;
        }
        // Abort if disconnect() was called during the delay (bumps currentConnectionId)
        if (this.currentConnectionId !== capturedConnectionId) {
          this.log("Disconnect called during reconnect delay, aborting");
          return;
        }

        // Refresh the access token before reconnecting. The cached token
        // captured at original connect time may have expired (Twitch IRC
        // closes the WSS when the OAuth token expires), and reusing the
        // stale token would just re-fail with "Login unsuccessful".
        if (!this.isAnonymous && this.tokenFetcher) {
          try {
            const fresh = await this.tokenFetcher();
            if (fresh) {
              this.accessToken = fresh;
            }
          } catch (err) {
            logger.warn("Chat:Twitch", "Token refresh before reconnect failed", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
          }
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
          logger.error("Chat:Twitch", "Reconnection failed", {
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
        }
      });
    } else {
      this.log("Max reconnection attempts reached");
      this.emit("error", new Error("Max reconnection attempts reached"));
    }
  }

  /**
   * Handle connection error
   */
  private handleConnectionError(error: unknown): void {
    logger.error("Chat:Twitch", "Connection error", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
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
      logger.debug("Chat:Twitch", message);
    }
  }
}

// ========== Export Singleton ==========

export const twitchChatService = new TwitchChatService();
