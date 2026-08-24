import type { BrowserWindow } from "electron";
import { z } from "zod";
import { logger } from "@/lib/cross-logger";
import type { KickUser } from "../../../../../shared/auth-types";
import { kickAuthService } from "../../../../auth/kick-auth";
import { getPlatformHealth } from "../../../unified/platform-health";
import type { KickRequestor } from "../kick-requestor";
import { createHiddenKickBrowserWindow } from "../kick-hidden-browser-window";
import { KICK_LEGACY_API_V2_BASE, type KickApiResponse, type KickApiUser } from "../kick-types";

import { acquireBrowserWindowSlot } from "./channel-endpoints";

const PUBLIC_USER_PROFILE_LOAD_TIMEOUT_MS = 10000;
const KICK_USERS_FILTER_LIMIT = 50;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface KickPublicChannelUserProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  followingSince?: string | null;
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

function mapKickPublicChannelUserProfile(rawData: unknown): KickPublicChannelUserProfile | null {
  const parsed = kickPublicChannelUserProfileSchema.safeParse(rawData);
  if (!parsed.success) return null;
  const data = parsed.data;
  const followingSince =
    data.following_since === null
      ? null
      : data.following_since &&
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
 * https://docs.kick.com/apis/users - GET /public/v1/users?id=:id
 */
export async function getUsersById(client: KickRequestor, ids: number[]): Promise<KickApiUser[]> {
  if (ids.length === 0 || !client.isAuthenticated()) {
    return [];
  }

  try {
    return await getUsersByIdStrict(client, ids);
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

export async function getUsersByIdStrict(
  client: KickRequestor,
  ids: number[]
): Promise<KickApiUser[]> {
  if (ids.length === 0) return [];
  if (!client.isAuthenticated()) return [];
  const uniqueIds = Array.from(new Set(ids));
  const users: KickApiUser[] = [];

  for (let index = 0; index < uniqueIds.length; index += KICK_USERS_FILTER_LIMIT) {
    const chunk = uniqueIds.slice(index, index + KICK_USERS_FILTER_LIMIT);
    const queryString = chunk.map((id) => `id=${id}`).join("&");
    const response = await client.request<KickApiResponse<KickApiUser[]>>(`/users?${queryString}`);
    const requestedIds = new Set(chunk);
    users.push(...(response.data || []).filter((user) => requestedIds.has(user.user_id)));
  }

  return users;
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

    win = createHiddenKickBrowserWindow({
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
  return mapKickPublicChannelUserProfile(rawData);
}

const PUBLIC_USER_PROFILE_BATCH_SIZE = 25;
const PUBLIC_USER_PROFILE_BATCH_CONCURRENCY = 2;
const PUBLIC_USER_PROFILE_BATCH_EXECUTION_TIMEOUT_MS = 75_000;

async function withPublicProfileBatchTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    // timer-allowlist: bounds an authenticated hidden-window batch so the shared mutex is released.
    timer = setTimeout(() => reject(new Error("Kick profile batch timeout")), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getPublicChannelUserProfiles(
  requests: Array<{ channelSlug: string; username: string }>
): Promise<Array<{ channelSlug: string; profile: KickPublicChannelUserProfile | null }>> {
  const results: Array<{ channelSlug: string; profile: KickPublicChannelUserProfile | null }> = [];
  for (let index = 0; index < requests.length; index += PUBLIC_USER_PROFILE_BATCH_SIZE) {
    const chunk = requests.slice(index, index + PUBLIC_USER_PROFILE_BATCH_SIZE);
    const releaseSlot = await acquireBrowserWindowSlot();
    let win: BrowserWindow | null = null;
    try {
      win = createHiddenKickBrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          // Default session carries the authenticated Kick OAuth cookies.
          // The isolated public partition cannot prove viewer relationships.
        },
      });
      await withPublicProfileBatchTimeout(
        win.loadURL("https://kick.com/"),
        PUBLIC_USER_PROFILE_LOAD_TIMEOUT_MS
      );
      const raw = (await withPublicProfileBatchTimeout(
        win.webContents.executeJavaScript(`(async () => {
        const requests = ${JSON.stringify(chunk)};
        const results = new Array(requests.length);
        let nextIndex = 0;
        // timer-allowlist: retry backoff runs inside the isolated Kick page execution context.
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const retryDelayMs = (response, attempt) => {
          const header = response.headers.get('Retry-After');
          if (header) {
            const seconds = Number(header);
            const parsed = Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(header) - Date.now();
            if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed, 30000);
          }
          return 1000 * (attempt + 1);
        };
        const worker = async () => {
          while (nextIndex < requests.length) {
            const index = nextIndex++;
            const request = requests[index];
            for (let attempt = 0; attempt < 3; attempt += 1) {
              const controller = new AbortController();
              // timer-allowlist: aborts a single in-page profile fetch that exceeds the batch deadline.
              const timeout = setTimeout(() => controller.abort(), ${PUBLIC_USER_PROFILE_LOAD_TIMEOUT_MS});
              try {
                const response = await fetch(
                  '/api/v2/channels/' + encodeURIComponent(request.channelSlug) +
                    '/users/' + encodeURIComponent(request.username),
                  { credentials: 'include', signal: controller.signal }
                );
                if (response.status === 429 && attempt < 2) {
                  await wait(retryDelayMs(response, attempt));
                  continue;
                }
                results[index] = {
                  channelSlug: request.channelSlug,
                  payload: response.ok ? await response.json() : null,
                };
                break;
              } catch {
                results[index] = { channelSlug: request.channelSlug, payload: null };
                break;
              } finally {
                clearTimeout(timeout);
              }
            }
          }
        };
        await Promise.all(Array.from(
          { length: Math.min(${PUBLIC_USER_PROFILE_BATCH_CONCURRENCY}, requests.length) },
          worker
        ));
        return JSON.stringify(results);
      })()`),
        PUBLIC_USER_PROFILE_BATCH_EXECUTION_TIMEOUT_MS
      )) as string;
      const parsed = JSON.parse(raw) as Array<{ channelSlug: string; payload: unknown }>;
      for (const item of parsed) {
        results.push({
          channelSlug: item.channelSlug,
          profile: mapKickPublicChannelUserProfile(item.payload),
        });
      }
    } catch {
      results.push(...chunk.map(({ channelSlug }) => ({ channelSlug, profile: null })));
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
      releaseSlot();
    }
  }
  return results;
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
