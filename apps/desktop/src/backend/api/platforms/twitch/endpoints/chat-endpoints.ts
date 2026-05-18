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
    console.warn(
      `[TwitchChatHistory] Failed to load history for channel ${login}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Minimal Electron-net JSON GET. We don't reuse TwitchRequestor here because
 * this endpoint is public, unauthenticated, and not Twitch's own API — it has
 * its own base URL and shouldn't go through the worker proxy.
 */
function netGetJson<T>(url: string): Promise<T | null> {
  const { net } = require("electron") as typeof import("electron");

  return new Promise((resolve, reject) => {
    const request = net.request({ method: "GET", url });

    const timeout = setTimeout(() => {
      request.abort();
      reject(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);

    request.on("response", (response) => {
      clearTimeout(timeout);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        // Drain the body so the socket can close, but treat as failure.
        response.on("data", () => {});
        response.on("end", () => resolve(null));
        return;
      }

      let body = "";
      response.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        try {
          resolve(body ? (JSON.parse(body) as T) : null);
        } catch {
          resolve(null);
        }
      });
      response.on("error", (error: Error) => reject(error));
    });

    request.on("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });

    request.end();
  });
}
