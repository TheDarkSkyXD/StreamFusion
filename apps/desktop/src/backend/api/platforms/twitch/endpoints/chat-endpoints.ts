/**
 * Twitch chat history (community service)
 *
 * Twitch's first-party IRC has no history endpoint. The de-facto source —
 * used by Chatterino and most desktop clients — is recent-messages.robotty.de,
 * a community-run service that captures IRC frames per channel and replays
 * them as raw IRC strings via REST. No auth, plain CORS-enabled HTTPS, so we
 * can hit it straight from Electron's `net` module without the BrowserWindow
 * Cloudflare trick the Kick path needs.
 */

import { logger } from "@/backend/logging/logger";

const RECENT_MESSAGES_BASE = "https://recent-messages.robotty.de/api/v2/recent-messages";
const HISTORY_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 10000;

export interface TwitchChannelHistory {
  /** Raw IRC frames, oldest first per the service's contract. */
  rawMessages: string[];
}

/**
 * GET https://recent-messages.robotty.de/api/v2/recent-messages/{login}
 *
 * Returns null on network failure / non-2xx / `error_code` payload. Callers
 * should treat null as "no history available" and continue with live-only.
 */
export async function getTwitchChannelHistory(
  channelLogin: string
): Promise<TwitchChannelHistory | null> {
  if (!channelLogin) return null;

  const login = channelLogin.toLowerCase().replace(/^#/, "");
  const params = new URLSearchParams({
    limit: String(HISTORY_LIMIT),
    hide_moderation_messages: "true",
    hide_moderated_messages: "true",
  });
  const url = `${RECENT_MESSAGES_BASE}/${encodeURIComponent(login)}?${params.toString()}`;

  try {
    const payload = await netGetJson<{
      messages?: string[];
      error?: string;
      error_code?: string;
    }>(url);
    if (!payload || payload.error_code || !Array.isArray(payload.messages)) {
      return null;
    }
    return { rawMessages: payload.messages };
  } catch (error) {
    logger.warn("Twitch:Endpoints:Chat", "Failed to load chat history for channel", {
      login,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return null;
  }
}

/**
 * Minimal Electron-net JSON GET. We don't reuse TwitchRequestor here because
 * this endpoint is public, unauthenticated, and not Twitch's own API — it has
 * its own base URL and shouldn't go through the worker proxy.
 */
async function netGetJson<T>(url: string): Promise<T | null> {
  const { net } = require("electron") as typeof import("electron");

  const response = await net.fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status < 200 || response.status >= 300) {
    return null;
  }

  const text = await response.text();
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}
