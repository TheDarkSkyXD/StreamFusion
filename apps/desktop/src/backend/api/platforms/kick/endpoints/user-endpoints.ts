import { BrowserWindow } from "electron";
import { z } from "zod";
import { logger } from "@/lib/cross-logger";
import type { KickUser } from "../../../../../shared/auth-types";
import { kickAuthService } from "../../../../auth/kick-auth";
import { getPlatformHealth } from "../../../unified/platform-health";
import type { KickRequestor } from "../kick-requestor";
import { KICK_LEGACY_API_V2_BASE, type KickApiResponse, type KickApiUser } from "../kick-types";

import { acquireBrowserWindowSlot } from "./channel-endpoints";

const PUBLIC_USER_PROFILE_LOAD_TIMEOUT_MS = 10000;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isExpectedOfficialApiCircuitOpen(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Kick official API app-token proxy unavailable while Kick is degraded"
  );
}

export interface KickPublicChannelUserProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  followingSince?: string;
}

export interface KickChannelUserState {
  userId: string;
  login: string;
  displayName: string;
  isModerator: boolean;
  isChannelOwner: boolean;
  isStaff: boolean;
  banned: unknown;
}

const kickPublicChannelUserProfileSchema = z.looseObject({
  id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
  slug: z.string().trim().min(1),
  username: z.string().trim().min(1),
  profile_pic: z.string().nullable().optional(),
  following_since: z.string().nullable().optional(),
});

const CHANNEL_USER_KEYS = [
  "badges",
  "badges_v2",
  "banned",
  "created_at",
  "following_since",
  "id",
  "is_channel_owner",
  "is_moderator",
  "is_staff",
  "profile_pic",
  "slug",
  "subscribed_for",
  "username",
] as const;

const kickChannelUserStateSchema = z.strictObject({
  badges: z.array(z.unknown()),
  badges_v2: z.array(z.unknown()),
  banned: z.unknown(),
  created_at: z.string().trim().min(1),
  following_since: z.string().nullable(),
  id: z.number().int().positive(),
  is_channel_owner: z.boolean(),
  is_moderator: z.boolean(),
  is_staff: z.boolean(),
  profile_pic: z.string().nullable(),
  slug: z.string().trim().min(1),
  subscribed_for: z.number().int().nonnegative(),
  username: z.string().trim().min(1),
});

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
    return await getUsersByIdStrict(client, ids);
  } catch (error) {
    const log = isExpectedOfficialApiCircuitOpen(error) ? logger.debug : logger.error;
    log("Kick:Endpoints:User", "Failed to fetch Kick users", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return [];
  }
}

export async function getUsersByIdStrict(
  client: KickRequestor,
  ids: number[]
): Promise<KickApiUser[]> {
  if (ids.length === 0) return [];
  const uniqueIds = Array.from(new Set(ids));
  const queryString = uniqueIds.map((id) => `id[]=${id}`).join("&");
  const response = await client.request<KickApiResponse<KickApiUser[]>>(
    `/users?${queryString}`,
    undefined,
    client.isAuthenticated() ? "user" : "app"
  );
  return response.data || [];
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
async function fetchPublicChannelUserPayload(
  channelSlug: string,
  username: string
): Promise<unknown | null> {
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

    let rawData: unknown;
    try {
      rawData = JSON.parse(pageContent) as unknown;
    } catch {
      return null;
    }

    const responseRecord =
      typeof rawData === "object" && rawData !== null ? (rawData as Record<string, unknown>) : null;
    if (responseRecord?.message === "Not found" || responseRecord?.code === 404) {
      return null;
    }

    return rawData;
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

export async function getPublicChannelUserProfile(
  channelSlug: string,
  username: string
): Promise<KickPublicChannelUserProfile | null> {
  const rawData = await fetchPublicChannelUserPayload(channelSlug, username);
  const parsed = kickPublicChannelUserProfileSchema.safeParse(rawData);
  if (!parsed.success) return null;

  const data = parsed.data;
  const followingSince =
    data.following_since &&
    ISO_TIMESTAMP_PATTERN.test(data.following_since) &&
    Number.isFinite(Date.parse(data.following_since))
      ? data.following_since
      : undefined;

  return {
    userId: String(data.id),
    username: data.slug,
    displayName: data.username,
    avatarUrl: data.profile_pic ?? "",
    followingSince,
  };
}

/**
 * Strict legacy/internal channel-user state read used for moderation checks.
 * The official Kick API does not expose equivalent channel-relative role and
 * current ban state, so schema drift must fail closed.
 */
export async function getChannelUserState(
  channelSlug: string,
  username: string
): Promise<KickChannelUserState | null> {
  const rawData = await fetchPublicChannelUserPayload(channelSlug, username);
  if (
    typeof rawData !== "object" ||
    rawData === null ||
    Object.keys(rawData).length !== CHANNEL_USER_KEYS.length ||
    !CHANNEL_USER_KEYS.every((key) => Object.hasOwn(rawData, key))
  ) {
    return null;
  }

  const parsed = kickChannelUserStateSchema.safeParse(rawData);
  if (!parsed.success) return null;

  return {
    userId: String(parsed.data.id),
    login: parsed.data.slug,
    displayName: parsed.data.username,
    isModerator: parsed.data.is_moderator,
    isChannelOwner: parsed.data.is_channel_owner,
    isStaff: parsed.data.is_staff,
    banned: parsed.data.banned,
  };
}
