/**
 * Kick chat history (v2 legacy)
 *
 * Fetches the recent-messages page Kick returns for a channel so we can seed
 * the chat with context on join, the way the official site does. The endpoint
 * is the same one KickTalk uses; it sits behind the same Cloudflare-guarded
 * v2 base as `getPublicChannel`, so we reuse the hidden-BrowserWindow trick
 * and the shared GPU-pressure mutex.
 *
 * Why the caller passes `channelId`:
 *   `/api/v2/channels/{X}/messages` only returns real messages when X is the
 *   channel's internal database id. Since the Stream page already fetches the
 *   channel info (via `getPublicChannel` → `useChannelByUsername`) and we
 *   surface that id as `UnifiedChannel.id`, the caller can pass it straight
 *   through with no extra round-trip.
 */

import { BrowserWindow } from "electron";

import type { KickPinnedMessage } from "../../../../../shared/chat-types";
import { isNetworkLikelyDown } from "../kick-network-health";
import { KICK_LEGACY_API_V2_BASE } from "../kick-types";

import { acquireBrowserWindowSlot } from "./channel-endpoints";

const LOAD_TIMEOUT_MS = 10000;

/**
 * Raw v2 message shape. `metadata` ships as a JSON string and needs parsing
 * before it lines up with the Pusher event shape `parseKickChatMessage`
 * expects.
 */
export interface KickV2ChatMessage {
  id: string;
  chatroom_id: number;
  content: string;
  type: string;
  created_at: string;
  sender: {
    id: number;
    username: string;
    slug: string;
    identity: {
      color: string;
      badges: Array<{ type: string; text: string; count?: number }>;
    };
  };
  metadata: string | null;
}

export interface KickChannelHistory {
  messages: KickV2ChatMessage[];
  pinnedMessage: KickPinnedMessage | null;
}

/**
 * GET https://kick.com/api/v2/channels/{channelId}/messages
 *
 * Returns null on network failure / Cloudflare challenge / parse error.
 * Callers should treat null as "no history available" and continue.
 */
export async function getKickChannelHistory(
  channelId: string,
): Promise<KickChannelHistory | null> {
  if (!channelId || isNetworkLikelyDown()) return null;

  const releaseSlot = await acquireBrowserWindowSlot();
  if (isNetworkLikelyDown()) {
    releaseSlot();
    return null;
  }

  let win: BrowserWindow | null = null;
  try {
    const url = `${KICK_LEGACY_API_V2_BASE}/channels/${encodeURIComponent(channelId)}/messages`;
    win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Share the partition with getPublicChannel so the Cloudflare challenge
        // cookies it plants are reused here.
        partition: "persist:kick_public",
      },
    });

    const loadPromise = win.loadURL(url);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Page load timeout")), LOAD_TIMEOUT_MS),
    );
    await Promise.race([loadPromise, timeoutPromise]);

    const pageContent: string = await win.webContents.executeJavaScript(
      "document.body.innerText;",
    );
    if (!pageContent) return null;

    const lower = pageContent.toLowerCase();
    if (
      lower.includes("error code 5") ||
      lower.includes("internal server error") ||
      lower.includes("bad gateway") ||
      lower.includes("service unavailable")
    ) {
      return null;
    }

    let parsed: { data?: { messages?: KickV2ChatMessage[]; pinned_message?: KickPinnedMessage } };
    try {
      parsed = JSON.parse(pageContent);
    } catch {
      return null;
    }

    const messages = Array.isArray(parsed?.data?.messages) ? parsed.data!.messages : [];
    const pinnedMessage = parsed?.data?.pinned_message ?? null;
    return { messages, pinnedMessage };
  } catch (error) {
    console.warn(
      `[KickChatHistory] Failed to load history for channel ${channelId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
    releaseSlot();
  }
}
