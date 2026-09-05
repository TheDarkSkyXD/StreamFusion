/**
 * Twitch Chat Service
 *
 * Manages Twitch IRC chat connections using tmi.js.
 * Handles message receiving, sending, and connection lifecycle.
 */

import tmi from "tmi.js";
import type { ChatConnection as CoreChatConnection } from "@streamfusion/core/chat";
// Cross-logger: imported by renderer chat components — avoids dragging
// electron-log into the renderer bundle.
import { logger } from "@shared/utils/cross-logger";
import { createCancellableSleep, type CancellableSleep } from "@shared/utils/sleep";
import type { TwitchUser } from "../../../shared/auth-types";
import { EventEmitter } from "../../../shared/browser-event-emitter";
import type {
  ChatConnectionState,
  ChatConnectionStatus,
  ChatMessage,
  ChatServiceEvents,
  ModeratorStateEvent,
  UserNotice,
} from "../../../shared/chat-types";
import { ChatBadge, ContentFragment } from "@streamfusion/core/chat";
import { buildChannelKey, useChatStore } from "../../../frontend/store/chat-store";
import { badgeResolver } from "./badge-resolver";
import {
  getDefaultColor,
  parseBadgeTags,
  parseTwitchMessage,
  type TwitchTags,
} from "./twitch-parser";
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

const RECONNECT_DELAYS_MS = [5000, 10000, 15000, 30000] as const;
const MESSAGE_RATE_LIMIT = 20; // Messages per 30 seconds (normal user)
const MOD_MESSAGE_RATE_LIMIT = 100; // Messages per 30 seconds (mod/broadcaster)
const CONNECTION_TIMEOUT_MS = 30000; // 30 second timeout for initial connection

// ========== TwitchChatService Class ==========

export class TwitchChatService
  extends EventEmitter
  implements
    TypedEventEmitter,
    CoreChatConnection<
      ChatServiceEvents,
      [options?: TwitchChatOptions],
      [channel: string, broadcasterId?: string],
      [channel: string, message: string, localFragments?: ContentFragment[]],
      [channel: string]
    >
{
  private client: tmi.Client | null = null;
  private channels: Set<string> = new Set();
  private connectionState: ChatConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: CancellableSleep | null = null;
  private reconnectGeneration = 0;
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
  private pendingMessageReservations: Set<symbol> = new Set();
  private isModerator: Map<string, boolean> = new Map(); // channel -> isMod

  // Connection tracking for React Strict Mode race condition prevention
  private currentConnectionId = 0;
  // Single-flight: a concurrent connect() awaits the in-flight attempt instead
  // of racing a second one. Mirrors the `_inFlight` pattern in follow-endpoints.
  private connectingPromise: Promise<void> | null = null;
  private teardownPromise: Promise<void> | null = null;

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
    this.clearReconnectTimer();
    // Mark service as active - allows connections and reconnections
    this.isActive = true;
    this.storeAuthOptions(options);

    const teardownPromise = this.teardownPromise;
    if (teardownPromise) await teardownPromise;

    if (!this.isActive) {
      this.log("Service deactivated, aborting connection");
      return;
    }

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

    this.storeAuthOptions(options);

    this.setConnectionState("connecting");

    let attemptClient: tmi.Client | null = null;
    try {
      // Check if this connection attempt was aborted
      if (connectionId !== this.currentConnectionId) {
        this.log(`Connection ${connectionId} aborted (superseded by ${this.currentConnectionId})`);
        return;
      }

      // Create client
      attemptClient = this.createClient();
      this.client = attemptClient;

      // Set up event handlers
      this.setupEventHandlers();

      // Connect with proper await - wait for 'connected' event
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          attemptClient?.removeListener("connected", onConnected);
          attemptClient?.removeListener("disconnected", onDisconnected);
        };
        // timer-allowlist: IRC connection-timeout watchdog inside _doConnect connected-event waiter (SP1/SP3 out-of-scope)
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Twitch IRC connection timed out"));
        }, CONNECTION_TIMEOUT_MS);

        const onConnected = () => {
          cleanup();
          resolve();
        };

        const onDisconnected = (reason: string) => {
          cleanup();
          reject(new Error(`Connection failed: ${reason}`));
        };

        attemptClient?.once("connected", onConnected);
        attemptClient?.once("disconnected", onDisconnected);

        // Initiate connection
        attemptClient?.connect().catch((err) => {
          cleanup();
          reject(err);
        });
      });

      // Check if service was deactivated during connection
      if (!this.isActive) {
        this.log(`Connection ${connectionId} aborted - service deactivated`);
        await this.disposeConnectionAttempt(attemptClient);
        return;
      }

      // Final check before declaring success
      if (connectionId !== this.currentConnectionId) {
        this.log(`Connection ${connectionId} aborted after IRC connect`);
        await this.disposeConnectionAttempt(attemptClient);
        return;
      }

      this.reconnectAttempts = 0;
      this.setConnectionState("connected");
      this.log("Connected to Twitch IRC");
    } catch (error) {
      if (attemptClient) await this.disposeConnectionAttempt(attemptClient);
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
    this.clearReconnectTimer();
    this.reconnectGeneration += 1;
    // Increment connection ID to abort any in-progress connection attempts
    this.currentConnectionId++;
    this.connectingPromise = null;

    if (this.teardownPromise) {
      await this.teardownPromise;
      return;
    }

    const client = this.client;
    if (!client) {
      this.setConnectionState("disconnected");
      return;
    }

    // Prevent reconnect logic from triggering during intentional disconnect
    client.removeAllListeners("disconnected");

    const teardownPromise = (async () => {
      await this.disconnectClient(client);

      if (this.client === client) {
        this.client = null;
        this.channels.clear();
        this.setConnectionState("disconnected");
        this.log("Disconnected from Twitch IRC");
      }
    })();
    this.teardownPromise = teardownPromise;

    try {
      await teardownPromise;
    } finally {
      if (this.teardownPromise === teardownPromise) this.teardownPromise = null;
    }
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
   * Load the watched channel's Twitch badge catalog before messages are parsed.
   * The catalog includes every channel-specific subscriber badge version.
   */
  async loadChannelBadges(
    channel: string,
    broadcasterId?: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<boolean> {
    if (!broadcasterId) return false;

    const normalizedChannel = this.normalizeChannel(channel);
    this.broadcasterId.set(normalizedChannel, broadcasterId);

    const bridge = window.electronAPI?.chat.getTwitchBadgeCatalog;
    if (!bridge) return false;

    try {
      const result = await bridge({
        broadcasterId,
        channelLogin: normalizedChannel,
        forceRefresh: options.forceRefresh ?? false,
      });
      if (!result.success || !result.data) return false;

      badgeResolver.hydrateBadgeCatalog(broadcasterId, result.data);
      return true;
    } catch (error) {
      logger.warn("Chat:Badges", "Twitch badge catalog bridge failed", {
        channel: normalizedChannel,
        broadcasterId,
        error:
          error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
      return false;
    }
  }

  resolveChannelBadges(channel: string, badges: ChatBadge[]): ChatBadge[] {
    const broadcasterId = this.broadcasterId.get(this.normalizeChannel(channel));
    return badgeResolver.resolveBadges(badges, broadcasterId);
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

    this.activeUsers = Math.max(0, this.activeUsers - 1);
    this.log(`Service released (active users: ${this.activeUsers})`);

    // A final release disconnects the socket, so waiting for a separate IRC
    // PART first is redundant and can block teardown until tmi.js reports
    // "No response from Twitch". Evict the requested bucket immediately and
    // let the hard shutdown close the transport once.
    if (this.activeUsers === 0) {
      if (channel && shouldLeaveChannel) {
        useChatStore
          .getState()
          .dropChannel(buildChannelKey("twitch", this.normalizeChannel(channel)));
      }
      await this.shutdown();
      return;
    }

    // When other panels still use the shared connection, PART only the channel
    // whose final panel was released and keep the transport alive.
    if (channel && shouldLeaveChannel) {
      await this.leaveChannel(channel);
      useChatStore
        .getState()
        .dropChannel(buildChannelKey("twitch", this.normalizeChannel(channel)));
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
    this.clearReconnectTimer();
    this.reconnectGeneration += 1;
    this.reconnectAttempts = 0;

    const { dropChannel } = useChatStore.getState();
    for (const channel of this.channels) {
      dropChannel(buildChannelKey("twitch", channel));
    }
    this.channelUsers.clear();
    this.channels.clear();
    this.broadcasterId.clear();
    this.isModerator.clear();

    if (this.teardownPromise) {
      await this.teardownPromise;
      return;
    }

    const client = this.client;
    if (!client) {
      this.setConnectionState("disconnected");
      return;
    }

    // Remove ALL listeners to prevent any callbacks from firing
    client.removeAllListeners();

    const teardownPromise = (async () => {
      await this.disconnectClient(client);

      if (this.client === client) {
        this.client = null;
        this.setConnectionState("disconnected");
        this.log("Twitch chat service shutdown complete");
      }
    })();
    this.teardownPromise = teardownPromise;

    try {
      await teardownPromise;
    } finally {
      if (this.teardownPromise === teardownPromise) this.teardownPromise = null;
    }
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
      // Badge images can be hydrated after messages arrive. Keep the catalog
      // request best-effort and off the critical IRC subscription path.
      void this.loadChannelBadges(normalizedChannel, broadcasterId);

      await this.client.join(normalizedChannel);
      this.channels.add(normalizedChannel);

      this.refreshOwnModeratorState(normalizedChannel);

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

  private async rejoinTrackedChannel(channel: string): Promise<void> {
    if (!this.client || this.connectionState !== "connected") {
      throw new Error("Not connected to Twitch IRC");
    }

    await this.client.join(channel);
    this.refreshOwnModeratorState(channel);
    this.emitConnectionStatus();
    this.log(`Rejoined channel: ${channel}`);
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
      this.log(`Left channel: ${normalizedChannel}`);
    } catch (error) {
      logger.warn("Chat:Twitch", "Twitch did not acknowledge channel leave", {
        channel: normalizedChannel,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    } finally {
      this.channels.delete(normalizedChannel);
      this.broadcasterId.delete(normalizedChannel);
      this.isModerator.delete(normalizedChannel);
      this.emitConnectionStatus();
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

    const rateLimitReservation = this.reserveMessageSend(normalizedChannel);
    if (!rateLimitReservation) {
      throw new Error("Message rate limit exceeded");
    }

    try {
      await this.client.say(normalizedChannel, message);
      this.pendingMessageReservations.delete(rateLimitReservation);
      this.recordMessageSent();
      this.emitSelfEcho(normalizedChannel, message, localFragments, false);
    } catch (error) {
      this.pendingMessageReservations.delete(rateLimitReservation);
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
    const badgesTag = this.withCurrentModeratorBadge(
      channel,
      (channelState?.badges as Record<string, string> | undefined) ||
        (globalState?.badges as Record<string, string> | undefined)
    );
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

  private emitCommandResult(channel: string, message: string): void {
    this.emit("message", {
      id: crypto.randomUUID(),
      platform: "twitch",
      type: "system",
      channel,
      userId: "system",
      username: "System",
      displayName: "System",
      color: "#808080",
      badges: [],
      content: [{ type: "text", content: message }],
      rawContent: message,
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    });
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

    const rateLimitReservation = this.reserveMessageSend(normalizedChannel);
    if (!rateLimitReservation) {
      throw new Error("Message rate limit exceeded");
    }

    try {
      await this.client.action(normalizedChannel, message);
      this.pendingMessageReservations.delete(rateLimitReservation);
      this.recordMessageSent();
      this.emitSelfEcho(normalizedChannel, message, localFragments, true);
    } catch (error) {
      this.pendingMessageReservations.delete(rateLimitReservation);
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

    const rateLimitReservation = this.reserveMessageSend(normalizedChannel);
    if (!rateLimitReservation) {
      throw new Error("Message rate limit exceeded");
    }

    try {
      // tmi.js doesn't have native reply support, use raw command
      await this.client.raw(
        `@reply-parent-msg-id=${parentMessageId} PRIVMSG #${normalizedChannel} :${message}`
      );
      this.pendingMessageReservations.delete(rateLimitReservation);
      this.recordMessageSent();
      this.emitSelfEcho(normalizedChannel, message, localFragments, false);
    } catch (error) {
      this.pendingMessageReservations.delete(rateLimitReservation);
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

  private storeAuthOptions(options: TwitchChatOptions): void {
    if (options.accessToken !== undefined) this.accessToken = options.accessToken;
    if (options.clientId !== undefined) this.clientId = options.clientId;
    if (options.user !== undefined) this.user = options.user;
    if (options.tokenFetcher !== undefined) this.tokenFetcher = options.tokenFetcher;
  }

  private async disposeConnectionAttempt(client: tmi.Client): Promise<void> {
    client.removeAllListeners();
    await this.disconnectClient(client);
    if (this.client === client) this.client = null;
  }

  private async disconnectClient(client: tmi.Client): Promise<void> {
    if (client.readyState?.() === "CLOSED") return;
    await client.disconnect().catch(() => undefined);
  }

  private refreshOwnModeratorState(channel: string): void {
    if (!this.client || !this.user) return;
    const client = this.client as tmi.Client & {
      isMod?: (channel: string, username: string) => boolean;
    };
    const isModerator = client.isMod?.(channel, this.user.login) ?? false;
    this.setOwnModeratorState(channel, isModerator, { emitUnchanged: true });
  }

  private setOwnModeratorState(
    channel: string,
    isModerator: boolean,
    options: { emitUnchanged?: boolean } = {}
  ): void {
    const normalizedChannel = this.normalizeChannel(channel);
    const previous = this.isModerator.get(normalizedChannel);
    this.isModerator.set(normalizedChannel, isModerator);
    if (!options.emitUnchanged && previous === isModerator) return;

    const channelId = this.broadcasterId.get(normalizedChannel);
    if (!channelId) return;

    const event: ModeratorStateEvent = {
      platform: "twitch",
      channel: normalizedChannel,
      channelId,
      isModerator,
      reason: "ws",
    };
    this.emit("moderatorState", event);
  }

  private withCurrentModeratorBadge(
    channel: string,
    badgesTag: Record<string, string> | undefined
  ): Record<string, string> | undefined {
    const isModerator = this.isModerator.get(this.normalizeChannel(channel)) ?? false;
    if (isModerator) {
      return { ...(badgesTag ?? {}), moderator: "1" };
    }
    if (!badgesTag?.moderator) return badgesTag;
    const next = { ...badgesTag };
    delete next.moderator;
    return next;
  }

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
      const noticeMsgId = String(msgId);
      const channelLogin = this.normalizeChannel(channel);
      const channelId = this.broadcasterId.get(channelLogin) ?? "";
      if (!channelId) return;
      if (noticeMsgId === "msg_banned") {
        this.emit("viewerSendRestriction", {
          platform: "twitch",
          channel: channelLogin,
          channelId,
          restriction: "banned",
        });
        return;
      }
      const requirement =
        noticeMsgId === "msg_requires_verified_phone_number"
          ? "phone"
          : noticeMsgId === "msg_verified_email"
            ? "email"
            : null;
      if (!requirement) return;
      this.emit("viewerSendRestriction", {
        platform: "twitch",
        channel: channelLogin,
        channelId,
        restriction: "verification",
        requirement,
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

    this.client.on("submysterygift", (channel, _username, giftCount, _methods, tags) => {
      this.handleUserNotice("submysterygift", channel, tags as TwitchTags, undefined, {
        giftCount,
      });
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
        this.setOwnModeratorState(channel, true);
      }
    });

    this.client.on("unmod", (channel, username) => {
      if (this.user && username.toLowerCase() === this.user.login.toLowerCase()) {
        this.setOwnModeratorState(channel, false);
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
    type: "sub" | "resub" | "subgift" | "submysterygift" | "raid",
    channel: string,
    tags: TwitchTags,
    message: string | undefined,
    options: { giftCount?: number } = {}
  ): void {
    const typedTags = tags as Record<string, unknown>;
    const taggedGiftCount =
      typeof typedTags["msg-param-mass-gift-count"] === "string"
        ? Number.parseInt(typedTags["msg-param-mass-gift-count"], 10)
        : undefined;
    const notice: UserNotice = {
      id: (typedTags.id as string) ?? crypto.randomUUID(),
      platform: "twitch",
      channel: this.normalizeChannel(channel),
      type,
      userId: (typedTags["user-id"] as string) ?? "",
      username: ((typedTags["display-name"] as string) ?? "").toLowerCase(),
      displayName: (typedTags["display-name"] as string) ?? "",
      color: (typedTags.color as string | undefined) || undefined,
      message,
      systemMessage: (typedTags["system-msg"] as string) ?? "",
      timestamp: new Date(),
      giftCount:
        options.giftCount ?? (Number.isFinite(taggedGiftCount) ? taggedGiftCount : undefined),
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

    this.scheduleReconnect();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    this.reconnectTimer.cancel();
    this.reconnectTimer = null;
  }

  private scheduleReconnect(): void {
    if (!this.isActive || this.reconnectTimer !== null) return;

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts += 1;
    this.setConnectionState("reconnecting");
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    const capturedGeneration = this.reconnectGeneration;
    const reconnectTimer = createCancellableSleep(delay);
    this.reconnectTimer = reconnectTimer;
    void reconnectTimer.result.then((result) => {
      if (!result.ok || this.reconnectTimer !== reconnectTimer) return;
      this.reconnectTimer = null;
      void this.runReconnect(capturedGeneration);
    });
  }

  private async runReconnect(capturedGeneration: number): Promise<void> {
    if (!this.isActive || this.reconnectGeneration !== capturedGeneration) return;

    // The cached token may have expired during the outage.
    if (!this.isAnonymous && this.tokenFetcher) {
      try {
        const fresh = await this.tokenFetcher();
        if (!this.isActive || this.reconnectGeneration !== capturedGeneration) return;
        if (fresh) {
          this.accessToken = fresh;
        } else {
          this.accessToken = null;
          this.isAnonymous = true;
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

    if (!this.isActive || this.reconnectGeneration !== capturedGeneration) return;

    try {
      await this.connect({ anonymous: this.isAnonymous, debug: this.debugMode });
      if (
        this.isActive &&
        this.reconnectGeneration === capturedGeneration &&
        this.connectionState === "connected"
      ) {
        for (const channel of this.channels) await this.rejoinTrackedChannel(channel);
      }
    } catch (error) {
      logger.error("Chat:Twitch", "Reconnection failed", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      if (this.isActive && this.reconnectGeneration === capturedGeneration) {
        this.scheduleReconnect();
      }
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

    return this.messageTimestamps.length + this.pendingMessageReservations.size < limit;
  }

  private reserveMessageSend(channel: string): symbol | null {
    if (!this.checkRateLimit(channel)) return null;

    const reservation = Symbol("pending-message-send");
    this.pendingMessageReservations.add(reservation);
    return reservation;
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
