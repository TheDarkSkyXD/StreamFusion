/**
 * Kick Chat Service
 *
 * Manages Kick chat connections using Pusher WebSocket.
 * Handles message receiving, sending, and connection lifecycle.
 */

import Pusher from "pusher-js";
import type { ChatConnection as CoreChatConnection } from "@streamfusion/core/chat";
import { createCancellableSleep, type CancellableSleep } from "@shared/utils/sleep";
// Cross-logger: imported by renderer chat components — avoids dragging
// electron-log into the renderer bundle.
import { logger } from "@shared/utils/cross-logger";
import { EventEmitter } from "../../../shared/browser-event-emitter";
// ... imports
import type {
  ChatBadge,
  ChatConnectionState,
  ChatConnectionStatus,
  ChatServiceEvents,
  ContentFragment,
  KickPinnedMessage,
  KickPoll,
  NormalizedPinnedMessage,
  ReplyInfo,
} from "../../../shared/chat-types";
import { buildChannelKey, useChatStore } from "../../../frontend/store/chat-store";
// Type-only import: lets us reference the KickSendResult shape without pulling
// kick-send-window's main-only deps (electron / better-sqlite3 via the
// storage-service chain) into the renderer bundle. The runtime calls go
// through window.electronAPI.kickChat below.
import type { KickSendResult } from "../../api/platforms/kick/kick-send-window";

// ... imports
import {
  type KickBadge,
  type KickChatClearedEvent,
  type KickChatMessageEvent,
  type KickGiftedSubEvent,
  type KickHostRaidEvent,
  type KickMessageDeletedEvent,
  type KickSubscriptionEvent,
  type KickUserBannedEvent,
  getDefaultColor,
  parseKickBadges,
  parseKickChatCleared,
  parseKickChatMessage,
  parseKickGiftedSub,
  parseKickHostRaid,
  parseKickMessageContent,
  parseKickMessageDeleted,
  parseKickSubscription,
  parseKickUserBanned,
  type SubscriberBadge,
} from "./kick-parser";
import {
  chatroomUpdatedEventToPatch,
  type KickChatroomUpdatedEventPayload,
} from "./kick-roomstate";

// ========== Send-window IPC wrappers ==========
// kick-chat.ts is consumed by the renderer (KickChat.tsx). The send-window
// module is main-only — it imports electron's BrowserWindow + session and
// transitively pulls in better-sqlite3 via the channel-endpoints / kick-auth
// / storage-service chain. Going through window.electronAPI.kickChat keeps
// the renderer bundle clean. See docs/brainstorms/2026-05-29-kick-chat-send-...
// and shared/mod-log-types.ts for the same pattern.

const sendKickChatMessage = (
  chatroomId: number,
  content: string,
  channelSlug: string
): Promise<KickSendResult> =>
  window.electronAPI.kickChat.sendMessage(chatroomId, content, channelSlug);

const disposeSendWindow = (): Promise<void> => window.electronAPI.kickChat.disposeSendWindow();
const setSendWindowComposerRetention = (kind: "retain" | "release"): Promise<void> =>
  window.electronAPI.kickChat.setSendWindowComposerRetention({
    kind,
    leaseId: "kick-chat-service",
  });

const WEB_SOCKET_CONNECTING_READY_STATE = 0;
const WEB_SOCKET_OPEN_READY_STATE = 1;
const WEB_SOCKET_CLOSING_READY_STATE = 2;
const WEB_SOCKET_CLOSED_READY_STATE = 3;

interface PusherConnectionManagerLike {
  state?: string;
  connection?: {
    transport?: {
      state?: string;
      socket?: {
        readyState?: number;
      };
    };
  };
}

interface LeaveChannelOptions {
  skipPusherUnsubscribe?: boolean;
}

function getPusherSocketReadyState(pusher: Pick<Pusher, "connection">): number | undefined {
  const connection = pusher.connection as unknown as PusherConnectionManagerLike;
  return connection.connection?.transport?.socket?.readyState;
}

function parseKickPinBadges(badges: KickBadge[]): ChatBadge[] {
  const parsedBadges = parseKickBadges(badges);

  return parsedBadges.map((parsedBadge, index) => {
    const badge = badges[index];
    if (!badge) return parsedBadge;

    const isSubGifter = badge.type === "sub_gifter" || badge.type === "subgifter";
    if (isSubGifter && typeof badge.count === "number" && badge.count > 0) {
      return {
        ...parsedBadge,
        title: `${badge.text || "Sub Gifter"} (${badge.count})`,
      };
    }

    return {
      ...parsedBadge,
      title: badge.text || parsedBadge.title,
    };
  });
}

function removeModeratorBadge(badges: ChatBadge[]): ChatBadge[] {
  return badges.filter((badge) => badge.setId !== "moderator");
}

/**
 * Convert a raw Kick pinned-message Pusher payload into the platform-agnostic
 * NormalizedPinnedMessage shape used by the shared PinnedMessageBanner.
 *
 * Kick's pin Pusher event carries the message body as a raw string — the same
 * format live chat messages arrive in. We run it through the shared content
 * parser so the banner renders `[emote:id:name]` markers as emote images,
 * URLs as clickable anchors, and @mentions as highlighted pills, matching
 * live-chat parity.
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
      ...(pin.message.sender.id !== undefined && pin.message.sender.id !== null
        ? { userId: String(pin.message.sender.id) }
        : {}),
      username: pin.message.sender.username,
      displayName: pin.message.sender.username,
      color: pin.message.sender.identity.color,
      badges: parseKickPinBadges(pin.message.sender.identity.badges ?? []),
    },
    content: parseKickMessageContent(pin.message.content),
    pinnedBy: pin.pinned_by
      ? {
          ...(pin.pinned_by.id !== undefined && pin.pinned_by.id !== null
            ? { userId: String(pin.pinned_by.id) }
            : {}),
          username: pin.pinned_by.username,
          displayName: pin.pinned_by.username,
          color: pin.pinned_by.identity.color,
          badges: parseKickPinBadges(pin.pinned_by.identity.badges ?? []),
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
}

interface ChannelInfo {
  /** Channel slug (username) */
  slug: string;
  /** Chatroom ID for WebSocket subscription (Pusher `chatrooms.{id}.v2`). */
  chatroomId: number;
  /** Broadcaster's user_id (channel.id). Used by sendMessage's optimistic-echo
   *  broadcaster-badge synthesis; not used by the page-context HTTP layer
   *  (which addresses by chatroomId). Distinct from chatroomId — they're
   *  different numbers on most channels. */
  broadcasterUserId?: number;
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

export class KickChatSendError extends Error {
  readonly kickSendResult: Extract<KickSendResult, { ok: false }>;

  constructor(result: Extract<KickSendResult, { ok: false }>) {
    super(result.message);
    this.name = "KickChatSendError";
    this.kickSendResult = result;
  }
}

// ========== Constants ==========

const PUSHER_APP_KEY = "32cbd69e4b950bf97679";
const PUSHER_CLUSTER = "us2";
const RECONNECT_DELAYS_MS = [5000, 10000, 15000, 30000] as const;
const MESSAGE_RATE_LIMIT = 10; // Messages per 10 seconds (conservative)
const MOD_MESSAGE_RATE_LIMIT = 50; // Messages per 10 seconds for mods
const CONNECTION_TIMEOUT_MS = 30000; // 30 second timeout for initial connection

interface PendingConnectionWait {
  client: Pusher;
  cancel: () => void;
}

// WebSocket close codes that are transient and should not trigger error emissions
// 1006 = Abnormal closure (network issue, will auto-retry)
// 1001 = Going away (page unload, etc.)
const TRANSIENT_WS_CODES = new Set([1006, 1001]);

// ========== KickChatService Class ==========

export class KickChatService
  extends EventEmitter
  implements
    TypedEventEmitter,
    CoreChatConnection<
      ChatServiceEvents,
      [options?: KickChatOptions],
      [channel: string, chatroomId: number, broadcasterUserId?: number],
      [
        channel: string,
        message: string,
        sender?: { id: number; username: string; slug: string; color?: string },
        localFragments?: ContentFragment[],
        localReplyTo?: ReplyInfo,
      ],
      [channel: string, options?: LeaveChannelOptions]
    >
{
  private pusher: Pusher | null = null;
  private channels: Map<string, ChannelInfo> = new Map(); // slug -> ChannelInfo
  private connectionState: ChatConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: CancellableSleep | null = null;
  private pendingConnectionWaits = new Set<PendingConnectionWait>();
  private debugMode = false;

  // Rate limiting
  private messageTimestamps: number[] = [];
  private pendingMessageReservations: Set<symbol> = new Set();
  private isModerator: Map<string, boolean> = new Map(); // channel -> isMod
  private channelBadges: Map<string, SubscriberBadge[]> = new Map(); // channel -> badges
  // Self-learning presentation cache populated from authoritative Pusher
  // messages. REST identity responses do not include chat color or badges.
  // Outer key: channel slug. Inner key: userId (string).
  private senderPresentationCache: Map<
    string,
    Map<string, { color: string; badges: ChatBadge[] }>
  > = new Map();

  // Platform isolation: prevents zombie reconnections when service should be inactive
  // When false, ALL connection attempts and reconnections are blocked
  private isActive = false;

  // Generation counter for soft-disconnect race guard.
  // Incremented by disconnect() and forceShutdown() so any reconnect callback
  // that was scheduled before the disconnect can detect it was superseded.
  private reconnectGeneration = 0;

  // Reference counting for multiview support
  // Tracks how many components are actively using this service
  // Only performs full shutdown when count reaches 0
  private activeUsers = 0;
  private channelUsers: Map<string, number> = new Map();
  private sendWindowRetentionUsers = 0;

  // ========== Public API ==========

  acquireSendWindowRetention(): void {
    this.sendWindowRetentionUsers += 1;
    if (this.sendWindowRetentionUsers === 1) void setSendWindowComposerRetention("retain");
  }

  releaseSendWindowRetention(): void {
    if (this.sendWindowRetentionUsers === 0) return;
    this.sendWindowRetentionUsers -= 1;
    if (this.sendWindowRetentionUsers === 0) void setSendWindowComposerRetention("release");
  }

  /**
   * Connect to Kick Pusher WebSocket
   */
  async connect(options: KickChatOptions = {}): Promise<void> {
    this.clearReconnectTimer();
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
    this.setConnectionState("connecting");

    try {
      const staleClient = this.pusher;
      if (staleClient) {
        this.cancelConnectionWaits(staleClient);
        staleClient.connection.unbind_all();
        this.disconnectPusherSafe(staleClient);
      }

      // Create Pusher client
      const client = this.createPusherClient();
      this.pusher = client;

      // Set up connection event handlers
      this.setupConnectionHandlers(client);

      this.log("Connecting to Kick Pusher WebSocket...");

      // Wait for the connection to actually be established
      await this.waitForConnection(client);

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

      if (this.pusher === client) {
        for (const [slug, info] of [...this.channels]) {
          this.subscribeTrackedChannel(slug, info.chatroomId, info.broadcasterUserId);
        }
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
  private waitForConnection(client: Pusher | null = this.pusher): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!client) {
        reject(new Error("Pusher client not initialized"));
        return;
      }

      // If already connected, resolve immediately
      if (client.connection.state === "connected") {
        resolve();
        return;
      }

      let timeoutId: NodeJS.Timeout | null = null;
      let settled = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        client.connection.unbind("connected", onConnected);
        client.connection.unbind("failed", onFailed);
        this.pendingConnectionWaits.delete(pendingWait);
      };

      const settle = (complete: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        complete();
      };

      const onConnected = () => {
        settle(resolve);
      };

      const onFailed = () => {
        settle(() => reject(new Error("Pusher connection failed permanently")));
      };

      const onTimeout = () => {
        if (settled) return;

        // Check Pusher's actual state before timing out
        const currentState = client.connection.state;

        // If Pusher is still actively trying, extend the timeout
        if (currentState === "connecting" || currentState === "unavailable") {
          this.log(`Connection still in progress (state: ${currentState}), extending timeout...`);
          // Give it another 15 seconds
          timeoutId = setTimeout(onTimeout, 15000); // timer-allowlist: Pusher connect deadline (SP1/SP3 out-of-scope)
          return;
        }

        // If we're already connected (race condition), resolve
        if (currentState === "connected") {
          onConnected();
          return;
        }

        // Otherwise, truly timed out
        settle(() => reject(new Error(`Pusher connection timed out (state: ${currentState})`)));
      };

      const pendingWait: PendingConnectionWait = {
        client,
        cancel: () => {
          settle(resolve);
        },
      };
      this.pendingConnectionWaits.add(pendingWait);

      // Set up initial timeout
      timeoutId = setTimeout(onTimeout, CONNECTION_TIMEOUT_MS); // timer-allowlist: Pusher connect deadline (SP1/SP3 out-of-scope)

      // Set up one-time listeners for connection result
      client.connection.bind("connected", onConnected);
      client.connection.bind("failed", onFailed);
      // Note: We don't bind to 'error' here because Pusher errors are often
      // transient and Pusher will automatically retry the connection.
    });
  }

  /**
   * Disconnect from Kick Pusher WebSocket
   * Note: This is a soft disconnect - service remains active for reconnection
   */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.reconnectGeneration += 1;
    const client = this.pusher;
    if (!client) return;

    this.cancelConnectionWaits(client);

    try {
      // No per-channel unsubscribe: closing the socket cleans them up
      // server-side, and the explicit frame races pusher.disconnect().
      this.disconnectPusherSafe(client);
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
  acquire(channel?: string): void {
    this.activeUsers++;
    if (channel) {
      this.channelUsers.set(channel, (this.channelUsers.get(channel) ?? 0) + 1);
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
      const channelUserCount = this.channelUsers.get(channel);
      if (channelUserCount === undefined || channelUserCount <= 1) {
        this.channelUsers.delete(channel);
        shouldLeaveChannel = true;
      } else {
        this.channelUsers.set(channel, channelUserCount - 1);
      }
    }

    // Leave and evict the specific channel only after its final panel releases.
    if (channel && shouldLeaveChannel) {
      await this.leaveChannel(channel, { skipPusherUnsubscribe: this.activeUsers <= 1 });
      useChatStore.getState().dropChannel(buildChannelKey("kick", channel));
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
    this.clearReconnectTimer();
    this.reconnectGeneration += 1;
    this.activeUsers = 0;
    if (this.sendWindowRetentionUsers > 0) {
      await setSendWindowComposerRetention("release");
    }
    this.sendWindowRetentionUsers = 0;
    this.reconnectAttempts = 0;

    const { dropChannel } = useChatStore.getState();
    for (const channel of this.channels.keys()) {
      dropChannel(buildChannelKey("kick", channel));
    }
    this.channelUsers.clear();

    const client = this.pusher;
    if (!client) {
      this.setConnectionState("disconnected");
      void disposeSendWindow();
      return;
    }

    this.cancelConnectionWaits(client);

    try {
      // Unbind ALL connection handlers
      client.connection.unbind_all();

      // unbind_all() drops the per-channel handler closures (local
      // memory, no socket frame). The matching pusher.unsubscribe()
      // calls were removed because they raced pusher.disconnect();
      // the server cleans up channels on socket close.
      for (const [_slug, info] of this.channels) {
        if (info.pusherChannel) {
          info.pusherChannel.unbind_all();
        }
      }

      this.disconnectPusherSafe(client);
    } catch {
      // Ignore disconnect errors
    }

    this.pusher = null;
    this.channels.clear();
    this.isModerator.clear();
    this.channelBadges.clear();
    this.setConnectionState("disconnected");
    this.log("Kick chat service shutdown complete");

    void disposeSendWindow();
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
   * @param chatroomId - Chatroom ID from Kick API (used for Pusher subscription)
   * @param broadcasterUserId - Broadcaster's user_id (channel.id). Distinct from
   *   `chatroomId` — they're different numbers on most channels. Used by the
   *   optimistic-echo broadcaster-badge synthesis in `sendMessage`.
   */
  async joinChannel(
    channel: string,
    chatroomId: number,
    broadcasterUserId?: number
  ): Promise<void> {
    const normalizedChannel = this.normalizeChannel(channel);

    if (this.channels.has(normalizedChannel)) {
      this.log(`Already in channel: ${normalizedChannel}`);
      return;
    }

    if (
      !this.pusher ||
      this.connectionState !== "connected" ||
      this.pusher.connection.state !== "connected"
    ) {
      await this.connect({ debug: this.debugMode });
    }

    const client = this.pusher;
    if (
      !client ||
      this.connectionState !== "connected" ||
      client.connection.state !== "connected"
    ) {
      throw new Error("Kick Pusher connection did not become ready");
    }

    try {
      this.log(`Subscribing to chatroom ${chatroomId}...`);
      this.subscribeTrackedChannel(normalizedChannel, chatroomId, broadcasterUserId);

      // NOTE: Channel badges should be set by caller via setChannelBadges()

      this.emitConnectionStatus();
      this.log(`Joined channel: ${normalizedChannel} (chatroom: ${chatroomId})`);
    } catch (error) {
      logger.error("Chat:Kick", "Failed to join channel", {
        channel: normalizedChannel,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  private subscribeTrackedChannel(
    channel: string,
    chatroomId: number,
    broadcasterUserId?: number
  ): void {
    if (!this.pusher) throw new Error("Not connected to Kick Pusher");

    const previous = this.channels.get(channel);
    previous?.pusherChannel?.unbind_all();

    const pusherChannel = this.pusher.subscribe(`chatrooms.${chatroomId}.v2`);
    this.pusher.subscribe(`chatrooms.${chatroomId}`);
    this.channels.set(channel, {
      slug: channel,
      chatroomId,
      broadcasterUserId,
      pusherChannel,
    });
    this.setupChannelEventHandlers(pusherChannel, channel, chatroomId);
  }

  /**
   * Leave a channel's chat
   */
  async leaveChannel(channel: string, options: LeaveChannelOptions = {}): Promise<void> {
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

      // Skip unsubscribe if a concurrent disconnect put the socket in
      // CLOSING / CLOSED — pusher-js would log "WebSocket is already in
      // CLOSING or CLOSED state". Server cleans channels up on close.
      if (!options.skipPusherUnsubscribe && canSendPusherFrames(this.pusher)) {
        const v2ChannelName = `chatrooms.${channelInfo.chatroomId}.v2`;
        const baseChannelName = `chatrooms.${channelInfo.chatroomId}`;
        this.pusher.unsubscribe(v2ChannelName);
        this.pusher.unsubscribe(baseChannelName);
      }
    }

    this.channels.delete(normalizedChannel);
    this.isModerator.delete(normalizedChannel);
    this.senderPresentationCache.delete(normalizedChannel);
    this.emitConnectionStatus();
    this.log(`Left channel: ${normalizedChannel}`);
  }

  /**
   * Send a message to a channel via the kick.com page-context v2 endpoint.
   *
   * The actual POST + auth handshake lives in `kick-send-window`; this
   * method orchestrates rate-limiting, optimistic echo, and error mapping
   * for the renderer-facing IPC contract. See
   * docs/adr/0001-kick-chat-page-context-send.md for the architecture.
   *
   * `sender` is optional so anonymous / test callers still work; when
   * provided we emit a synthetic "message" event so the local UI shows
   * the user's own outbound message (IRC-style echo). The Pusher echo
   * arrives ~150-400ms later with full identity; dedup-by-message-id
   * collapses the duplicate.
   */
  async sendMessage(
    channel: string,
    message: string,
    sender?: { id: number; username: string; slug: string; color?: string },
    /**
     * Pre-rendered fragments for the optimistic local echo. When provided,
     * the echo carries real emote/mention fragments built from the input's
     * emote slots so the user's own outbound message shows emote IMAGES (and
     * not the raw emote name text) for the ~150-400ms before the Pusher
     * delivery arrives. Falls back to a single text fragment when omitted,
     * preserving the historical echo shape for non-input callers.
     */
    localFragments?: ContentFragment[],
    /** Reply metadata for the optimistic local echo, matching Kick Pusher reply payloads. */
    localReplyTo?: ReplyInfo
  ): Promise<void> {
    const normalizedChannel = this.normalizeChannel(channel);
    const channelInfo = this.channels.get(normalizedChannel);

    if (!channelInfo) {
      throw new Error(`Not in channel: ${normalizedChannel}`);
    }

    const rateLimitReservation = this.reserveMessageSend(normalizedChannel);
    if (!rateLimitReservation) {
      throw new Error("Message rate limit exceeded");
    }

    // Delegate to the page-context sender. The send-window owns auth and
    // the actual HTTP — this service just orchestrates rate limit, error
    // surfacing, and optimistic echo.
    let result: KickSendResult;
    try {
      result = await sendKickChatMessage(channelInfo.chatroomId, message, normalizedChannel);
      if (!result.ok) {
        throw new KickChatSendError(result);
      }
    } catch (error) {
      this.pendingMessageReservations.delete(rateLimitReservation);
      throw error;
    }
    this.pendingMessageReservations.delete(rateLimitReservation);
    this.recordMessageSent();

    // Optimistic local echo. The new send path triggers a Pusher delivery
    // ~150-400ms later that carries real color + badges; this echo bridges
    // the latency. Dedup-by-id collapses the duplicate.
    if (sender) {
      const cachedForChannel = this.senderPresentationCache.get(normalizedChannel);
      const cachedPresentation = cachedForChannel?.get(String(sender.id));
      let echoBadges: ChatBadge[];
      if (cachedPresentation) {
        echoBadges = removeModeratorBadge(cachedPresentation.badges);
      } else {
        const synthBadges: KickBadge[] = [];
        if (sender.id === channelInfo.broadcasterUserId) {
          synthBadges.push({ type: "broadcaster", text: "Broadcaster" });
        }
        echoBadges = parseKickBadges(synthBadges);
      }
      this.emit("message", {
        id: result.messageId ?? crypto.randomUUID(),
        platform: "kick",
        type: "message",
        channel: normalizedChannel,
        userId: String(sender.id),
        username: sender.slug,
        displayName: sender.username,
        color: cachedPresentation?.color || getDefaultColor(sender.username),
        badges: echoBadges,
        content:
          localFragments && localFragments.length > 0
            ? localFragments
            : [{ type: "text", content: message }],
        rawContent: message,
        timestamp: new Date(),
        isDeleted: false,
        isHighlighted: false,
        isAction: false,
        isOptimistic: true,
        replyTo: localReplyTo,
      });
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
      isAuthenticated: this.connectionState === "connected",
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
   * Apply an observed self moderator-state change for a Kick channel.
   */
  setModeratorState(channel: string, isModerator: boolean): void {
    this.isModerator.set(this.normalizeChannel(channel), isModerator);
  }

  /**
   * Get chatroom ID for a channel (if joined)
   */
  getChatroomId(channel: string): number | null {
    const info = this.channels.get(this.normalizeChannel(channel));
    return info?.chatroomId ?? null;
  }

  /**
   * Expose the underlying Pusher client to sibling services (e.g.
   * `kick-predictions-service`) that need to subscribe their own channels on
   * the same WebSocket. Returns `null` when the service hasn't connected
   * yet (or has shut down) so callers can defer subscription until the next
   * `connectionStateChange` to `connected`. Sibling services MUST NOT call
   * `.disconnect()` or `.connection.bind_all()` on this instance — lifecycle
   * stays with KickChatService.
   */
  getPusher(): Pusher | null {
    return this.pusher;
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

  private cancelConnectionWaits(client: Pusher): void {
    for (const pendingWait of this.pendingConnectionWaits) {
      if (pendingWait.client === client) pendingWait.cancel();
    }
  }

  private disconnectPusherSafe(pusher: Pusher): void {
    const readyState = getPusherSocketReadyState(pusher);
    if (
      readyState === WEB_SOCKET_CLOSING_READY_STATE ||
      readyState === WEB_SOCKET_CLOSED_READY_STATE
    ) {
      return;
    }

    if (readyState === WEB_SOCKET_CONNECTING_READY_STATE) {
      let settled = false;
      let onConnected: (() => void) | null = null;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (onConnected) pusher.connection.unbind("connected", onConnected);
        pusher.connection.unbind("failed", cleanup);
        pusher.connection.unbind("disconnected", cleanup);
      };
      onConnected = () => {
        cleanup();
        try {
          pusher.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      };

      pusher.connection.bind("connected", onConnected);
      pusher.connection.bind("failed", cleanup);
      pusher.connection.bind("disconnected", cleanup);
      return;
    }

    pusher.disconnect();
  }

  /**
   * Set up connection event handlers for the Pusher client
   */
  private setupConnectionHandlers(client: Pusher): void {
    client.connection.bind("connected", () => {
      if (this.pusher !== client) return;
      this.log("Pusher connected");
      this.setConnectionState("connected");
      this.reconnectAttempts = 0;
    });

    client.connection.bind("disconnected", () => {
      if (this.pusher !== client) return;
      this.log("Pusher disconnected");
      this.handleDisconnect();
    });

    client.connection.bind("error", (error: unknown) => {
      if (this.pusher !== client) return;
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
        logger.warn("Chat:Kick", "Pusher error", {
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
        logger.warn("Chat:Kick", "Pusher connection issue", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        // Don't emit transient errors to avoid alarming the UI
      }
    });

    client.connection.bind("connecting", () => {
      if (this.pusher !== client) return;
      this.log("Pusher connecting...");
      this.setConnectionState("connecting");
    });

    client.connection.bind("unavailable", () => {
      if (this.pusher !== client) return;
      this.log("Pusher unavailable");
      this.setConnectionState("reconnecting");
    });

    client.connection.bind("failed", () => {
      if (this.pusher !== client) return;
      this.log("Pusher connection failed");
      this.handleConnectionError(new Error("Pusher connection failed"));
    });
  }

  /**
   * Set up event handlers for a channel subscription
   */
  private setupChannelEventHandlers(
    pusherChannel: ReturnType<Pusher["subscribe"]>,
    channelSlug: string,
    chatroomId: number
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
        this.emit("pinnedMessage", { ...kickPinToNormalized(pin), channel: channelSlug });
      }
    });

    pusherChannel.bind("App\\Events\\PinnedMessageDeletedEvent", (_data: unknown) => {
      this.log(`Pinned message deleted in ${channelSlug}`);
      this.emit("pinnedMessageCleared", channelSlug);
    });

    // Poll update event
    pusherChannel.bind("App\\Events\\PollUpdateEvent", (data: unknown) => {
      this.log(`Poll updated in ${channelSlug}`);
      const poll = data as KickPoll;
      if (poll?.title) {
        this.emit("pollUpdate", { ...poll, channel: channelSlug });
      }
    });

    // Chatroom-updated event — chat-settings modes (followers/subs/slow/emote-only/account-age).
    // Verified event name + payload shape against KickTalk's
    // reference/KickTalk-main/utils/services/kick/kickPusher.js:192 and
    // src/renderer/src/components/Chat/Input/InfoBar.jsx lines 12-22.
    // Note: this event fires on mode CHANGES only, not on subscribe — initial
    // state comes from getPublicChannel.chatroomSettings via U6's hook.
    pusherChannel.bind("App\\Events\\ChatroomUpdatedEvent", (data: unknown) => {
      const patch = chatroomUpdatedEventToPatch(data as KickChatroomUpdatedEventPayload);
      this.emit("roomState", {
        platform: "kick",
        channel: channelSlug,
        channelId: String(chatroomId),
        patch,
        reason: "ws",
      });
    });

    // Subscription states
    pusherChannel.bind("pusher:subscription_succeeded", () => {
      this.log(`Subscription succeeded for ${channelSlug}`);
    });

    pusherChannel.bind("pusher:subscription_error", (error: unknown) => {
      logger.error("Chat:Kick", "Subscription error", {
        channel: channelSlug,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    });
  }

  /**
   * Handle incoming chat message
   */
  private handleChatMessage(data: KickChatMessageEvent, channelSlug: string): void {
    const subscriberBadges = this.channelBadges.get(channelSlug);
    const parsedMessage = parseKickChatMessage(data, channelSlug, subscriberBadges);
    const channelInfo = this.channels.get(channelSlug);
    const message =
      channelInfo?.broadcasterUserId !== undefined &&
      parsedMessage.userId === String(channelInfo.broadcasterUserId)
        ? { ...parsedMessage, badges: removeModeratorBadge(parsedMessage.badges) }
        : parsedMessage;

    let cacheForChannel = this.senderPresentationCache.get(channelSlug);
    if (!cacheForChannel) {
      cacheForChannel = new Map();
      this.senderPresentationCache.set(channelSlug, cacheForChannel);
    }
    cacheForChannel.set(message.userId, { color: message.color, badges: message.badges });

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

    this.scheduleReconnect();
  }

  private clearReconnectTimer(): void {
    this.reconnectTimer?.cancel();
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
    const timer = createCancellableSleep(delay);
    this.reconnectTimer = timer;
    void this.runReconnectAfterDelay(timer, capturedGeneration);
  }

  private async runReconnectAfterDelay(
    timer: CancellableSleep,
    capturedGeneration: number
  ): Promise<void> {
    const result = await timer.result;
    if (!result.ok || this.reconnectTimer !== timer) return;
    this.reconnectTimer = null;
    void this.runReconnect(capturedGeneration);
  }

  private async runReconnect(capturedGeneration: number): Promise<void> {
    if (!this.isActive || this.reconnectGeneration !== capturedGeneration) return;

    try {
      await this.connect({ debug: this.debugMode });
    } catch (error) {
      logger.error("Chat:Kick", "Reconnection failed", {
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
    logger.error("Chat:Kick", "Connection error", {
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
      logger.debug("Chat:Kick", message);
    }
  }
}

// ========== Export Singleton ==========

export const kickChatService = new KickChatService();

/**
 * Module-level accessor for the live Pusher singleton owned by
 * `kickChatService`. Returns `null` until the chat service has connected.
 *
 * The `kick-predictions-service` and any future sibling that wants to ride
 * on the same WebSocket imports this rather than calling
 * `kickChatService.getPusher()` directly so test mocks can stub a single
 * function point.
 */
export function getKickPusher(): Pusher | null {
  return kickChatService.getPusher();
}

export function canSendPusherFrames(pusher: Pick<Pusher, "connection"> | null): boolean {
  if (!pusher) return false;

  const connection = pusher.connection as unknown as PusherConnectionManagerLike;
  if (connection.state !== "connected") return false;

  const transport = connection.connection?.transport;
  if (!transport) return true;
  if (transport.state && transport.state !== "open") return false;

  const readyState = transport.socket?.readyState;
  return typeof readyState !== "number" || readyState === WEB_SOCKET_OPEN_READY_STATE;
}
