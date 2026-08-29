/**
 * Kick chat history
 *
 * Fetches the recent-messages page Kick returns for a channel so we can seed
 * the chat with context on join, the way the official site does. The normal
 * path uses Electron's lightweight cookie-bearing session request. A hidden
 * channel page remains as a compatibility fallback when Kick requires browser
 * runtime state. Both paths share the public-channel partition.
 *
 * The web history endpoint keys channels by their internal database id,
 * exposed separately as `UnifiedChannel.kickChannelId`.
 */

import type { BrowserWindow } from "electron";

import { logger } from "@backend/logging/logger";
import type { KickPinnedMessage } from "../../../../../shared/chat-types";
import { getPlatformHealth } from "../../../unified/platform-health";

import { acquireBrowserWindowSlot } from "./channel-endpoints";
import { createHiddenKickBrowserWindow } from "../kick-hidden-browser-window";
import { requestPublicKickSession } from "../kick-session-request";

const LOAD_TIMEOUT_MS = 10000;

async function loadChannelPage(win: BrowserWindow, url: string): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let resolveDomReady: (() => void) | undefined;
  const domReady = new Promise<void>((resolve) => {
    resolveDomReady = resolve;
    win.webContents.once("dom-ready", resolve);
  });
  const timeout = new Promise<never>((_, reject) => {
    // timer-allowlist: BrowserWindow navigation deadline cleared after the page becomes usable
    timeoutId = setTimeout(() => reject(new Error("Page load timeout")), LOAD_TIMEOUT_MS);
  });

  try {
    await Promise.race([win.loadURL(url), domReady, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (resolveDomReady) win.webContents.removeListener("dom-ready", resolveDomReady);
  }
}

/**
 * Raw web-history message shape. `metadata` ships as a JSON string and needs parsing
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
    profile_pic?: string | null;
    profile_picture?: string | null;
    avatar?: string | null;
    avatar_url?: string | null;
    user?: {
      profile_pic?: string | null;
      profile_picture?: string | null;
      avatar?: string | null;
      avatar_url?: string | null;
    };
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

function parseKickChannelHistory(pageContent: string): KickChannelHistory | null {
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

  let parsed: {
    ok?: boolean;
    body?: { data?: { messages?: KickV2ChatMessage[]; pinned_message?: KickPinnedMessage } };
    data?: { messages?: KickV2ChatMessage[]; pinned_message?: KickPinnedMessage };
  };
  try {
    parsed = JSON.parse(pageContent);
  } catch {
    return null;
  }

  if (parsed.ok === false) return null;
  const payload = parsed.body ?? parsed;
  const messages = Array.isArray(payload?.data?.messages) ? payload.data.messages : [];
  const pinnedMessage = payload?.data?.pinned_message ?? null;
  return { messages, pinnedMessage };
}

/**
 * Fetch /api/v2/channels/{channelId}/messages from the persistent public Kick
 * session, falling back to a loaded https://kick.com/{channelSlug} page.
 *
 * Returns null on network failure / Cloudflare challenge / parse error.
 * Callers should treat null as "no history available" and continue.
 */
export async function getKickChannelHistory(
  channelId: string,
  channelSlug?: string
): Promise<KickChannelHistory | null> {
  if (!channelId || getPlatformHealth("kick") === "down") return null;

  const historyUrl = `/api/v2/channels/${encodeURIComponent(channelId)}/messages`;
  const directResponse = await requestPublicKickSession(historyUrl);
  if (directResponse.kind === "response") {
    if (directResponse.ok) {
      const directHistory = parseKickChannelHistory(directResponse.body);
      if (directHistory) return directHistory;
    } else if (![401, 403, 419].includes(directResponse.status)) {
      return null;
    }
  }

  const releaseSlot = await acquireBrowserWindowSlot("high");
  if (getPlatformHealth("kick") === "down") {
    releaseSlot();
    return null;
  }

  let win: BrowserWindow | null = null;
  try {
    const channelPageUrl = `https://kick.com/${encodeURIComponent(channelSlug || channelId)}`;
    win = createHiddenKickBrowserWindow({
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

    await loadChannelPage(win, channelPageUrl);

    const pageContent: string = await win.webContents.executeJavaScript(`
      (async () => {
        const response = await fetch(${JSON.stringify(historyUrl)}, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const text = await response.text();
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch {}
        return JSON.stringify({ ok: response.ok, status: response.status, body });
      })()
    `);
    return parseKickChannelHistory(pageContent);
  } catch (error) {
    logger.warn("Kick:Endpoints:Chat", "Failed to load history for channel", {
      channelId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return null;
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
    releaseSlot();
  }
}
