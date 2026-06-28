import { BrowserWindow } from "electron";
import { logger } from "@/lib/cross-logger";
import type { KickUser } from "../../../../../shared/auth-types";
import { kickAuthService } from "../../../../auth/kick-auth";
import { getPlatformHealth } from "../../../unified/platform-health";
import type { KickRequestor } from "../kick-requestor";
import { KICK_LEGACY_API_V2_BASE, type KickApiResponse, type KickApiUser } from "../kick-types";

import { acquireBrowserWindowSlot } from "./channel-endpoints";

const PUBLIC_USER_PROFILE_LOAD_TIMEOUT_MS = 10000;

export interface KickPublicChannelUserProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

/**
 * Get the currently authenticated user
 */
export async function getUser(): Promise<KickUser | null> {
  return kickAuthService.fetchCurrentUser();
}

/**
 * Get users by IDs
 * https://docs.kick.com/apis/users - GET /public/v1/users?id[]=:id
 */
export async function getUsersById(client: KickRequestor, ids: number[]): Promise<KickApiUser[]> {
  if (ids.length === 0) {
    return [];
  }

  try {
    const uniqueIds = Array.from(new Set(ids));
    // Manually construct query to ensure id[] is not encoded as id%5B%5D
    // Kick API can be picky about parameter encoding
    const queryParts = uniqueIds.map((id) => `id[]=${id}`);
    const queryString = queryParts.join("&");

    const response = await client.request<KickApiResponse<KickApiUser[]>>(
      `/users?${queryString}`,
      undefined,
      "app"
    );

    return response.data || [];
  } catch (error) {
    logger.error("Kick:Endpoints:User", "Failed to fetch Kick users", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return [];
  }
}

/**
 * Legacy/internal fallback for ordinary chatters:
 * GET https://kick.com/api/v2/channels/:channelSlug/users/:username
 *
 * The official users endpoint only accepts numeric ids and requires auth.
 * Mention autocomplete often runs for anonymous sessions and for users who
 * are not channel owners, so this channel-scoped web endpoint is the only
 * observed no-auth profile source that includes `profile_pic`.
 */
export async function getPublicChannelUserProfile(
  channelSlug: string,
  username: string
): Promise<KickPublicChannelUserProfile | null> {
  const normalizedChannelSlug = channelSlug.trim();
  const normalizedUsername = username.trim();
  if (!normalizedChannelSlug || !normalizedUsername || getPlatformHealth("kick") === "down") {
    return null;
  }

  const releaseSlot = await acquireBrowserWindowSlot();
  if (getPlatformHealth("kick") === "down") {
    releaseSlot();
    return null;
  }

  let win: BrowserWindow | null = null;
  try {
    const url = `${KICK_LEGACY_API_V2_BASE}/channels/${encodeURIComponent(
      normalizedChannelSlug
    )}/users/${encodeURIComponent(normalizedUsername)}`;

    win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: "persist:kick_public",
      },
    });

    const loadPromise = win.loadURL(url);
    const timeoutPromise = new Promise<never>((_, reject) =>
      // timer-allowlist: BrowserWindow public-user profile page-load deadline
      setTimeout(() => reject(new Error("Page load timeout")), PUBLIC_USER_PROFILE_LOAD_TIMEOUT_MS)
    );
    await Promise.race([loadPromise, timeoutPromise]);

    const pageContent: string = await win.webContents.executeJavaScript("document.body.innerText;");
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

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(pageContent) as Record<string, unknown>;
    } catch {
      return null;
    }

    if (data.message === "Not found" || data.code === 404) return null;

    const userId = typeof data.id === "number" || typeof data.id === "string" ? data.id : "";
    const responseUsername =
      typeof data.slug === "string"
        ? data.slug
        : typeof data.username === "string"
          ? data.username
          : normalizedUsername;
    const displayName = typeof data.username === "string" ? data.username : responseUsername;
    const avatarUrl = typeof data.profile_pic === "string" ? data.profile_pic : "";

    return {
      userId: String(userId || normalizedUsername),
      username: responseUsername,
      displayName,
      avatarUrl,
    };
  } catch (error) {
    logger.debug("Kick:Endpoints:User", "Failed to fetch public Kick channel user profile", {
      channelSlug: normalizedChannelSlug,
      username: normalizedUsername,
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
