import type { TwitchPlaylistFetchResult } from "@shared/twitch-playlist-types";
import { session } from "electron";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type SessionFetch = (url: string, init?: RequestInit) => Promise<Response>;

function isAllowedPlaylistUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      (url.hostname === "ttvnw.net" || url.hostname.endsWith(".ttvnw.net")) &&
      url.pathname.toLowerCase().endsWith(".m3u8")
    );
  } catch {
    return false;
  }
}

export class TwitchPlaylistFetchService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly sessionFetch: SessionFetch = (url, init) =>
      session.defaultSession.fetch(url, init)
  ) {}

  async fetchPlaylist(requestId: string, url: string): Promise<TwitchPlaylistFetchResult> {
    if (!isAllowedPlaylistUrl(url)) {
      return { ok: false, status: 0, error: "invalid-url" };
    }

    this.cancel(requestId);
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    // timer-allowlist: shared request controller supports both explicit cancel and a cleared deadline
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      let currentUrl = url;
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const response = await this.sessionFetch(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
        });

        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          if (!location || redirects === MAX_REDIRECTS) {
            return { ok: false, status: response.status, error: "http" };
          }
          const redirectUrl = new URL(location, currentUrl).toString();
          if (!isAllowedPlaylistUrl(redirectUrl)) {
            return { ok: false, status: 0, error: "invalid-url" };
          }
          currentUrl = redirectUrl;
          continue;
        }

        if (!response.ok) {
          return { ok: false, status: response.status, error: "http" };
        }
        return { ok: true, status: response.status, text: await response.text() };
      }
      return { ok: false, status: 0, error: "network" };
    } catch {
      return { ok: false, status: 0, error: "network" };
    } finally {
      clearTimeout(timeout);
      if (this.controllers.get(requestId) === controller) {
        this.controllers.delete(requestId);
      }
    }
  }

  cancel(requestId: string): boolean {
    const controller = this.controllers.get(requestId);
    if (!controller) return false;
    this.controllers.delete(requestId);
    controller.abort();
    return true;
  }
}

export const twitchPlaylistFetchService = new TwitchPlaylistFetchService();
