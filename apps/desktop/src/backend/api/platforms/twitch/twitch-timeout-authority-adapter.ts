import { z } from "zod";
import { getOAuthConfig } from "@backend/auth/oauth-config";
import { tokenExchangeService } from "@backend/auth/token-exchange";
import type {
  TimeoutAuthorityAdapter,
  TimeoutBinding,
} from "@backend/services/moderation/timeout-moderation-service";
import { storageService } from "@backend/services/storage-service";

import { getBannedUsers } from "./twitch-helix-banned-list";
import { getModeratedChannelsResult } from "./twitch-helix-moderation";
import { type TimeoutUserArgs, timeoutUser } from "./twitch-helix-moderation-mutations";
import { getModerators } from "./twitch-helix-moderators-vips";

const TWITCH_TIMEOUT_SCOPE = "moderator:manage:banned_users";
const TWITCH_MOD_CHANNEL_SCOPE = "user:read:moderated_channels";
const TWITCH_MODERATOR_READ_SCOPES = ["moderation:read", "channel:manage:moderators"] as const;

const twitchTimeoutStateSchema = z.object({
  data: z.object({
    currentUser: z.object({ id: z.string().min(1), login: z.string().min(1) }),
    channelUser: z.object({ id: z.string().min(1), login: z.string().min(1) }),
    targetUser: z.object({
      id: z.string().min(1),
      login: z.string().min(1),
      isModerator: z.boolean(),
    }),
    banStatus: z
      .object({
        createdAt: z.string().min(1),
        expiresAt: z.string().nullable(),
        isPermanent: z.boolean(),
        reason: z.string().nullable().optional(),
        moderator: z
          .object({ id: z.string().min(1), login: z.string().min(1) })
          .nullable()
          .optional(),
      })
      .nullable(),
  }),
  errors: z.array(z.unknown()).optional(),
});

export interface TwitchTimeoutCredential {
  actorId: string;
  actorUsername?: string;
  accessToken: string;
  clientId: string;
  scopes: string[];
}

type ChannelAuthorization =
  | { state: "authorized"; role: "moderator" | "broadcaster" }
  | { state: "unauthorized" | "unverifiable" };

export type TwitchTimeoutTargetState =
  | { state: "clear"; targetIsModerator: boolean }
  | { state: "invalid" }
  | { state: "unverifiable" };

export interface TwitchTimeoutAdapterDependencies {
  getCredential(): Promise<TwitchTimeoutCredential | null>;
  authorizeChannel(
    binding: TimeoutBinding,
    credential: TwitchTimeoutCredential
  ): Promise<ChannelAuthorization>;
  queryTargetState(
    binding: TimeoutBinding,
    credential: TwitchTimeoutCredential
  ): Promise<TwitchTimeoutTargetState>;
  execute(args: TimeoutUserArgs): ReturnType<typeof timeoutUser>;
}

function equalsLogin(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function classifyExactUserEntries(
  entries: unknown,
  binding: TimeoutBinding
): "absent" | "present" | "unverifiable" {
  if (!Array.isArray(entries)) return "unverifiable";
  if (entries.length === 0) return "absent";
  if (entries.length !== 1) return "unverifiable";

  const entry = entries[0] as { user_id?: unknown; user_login?: unknown };
  if (
    typeof entry?.user_id !== "string" ||
    typeof entry.user_login !== "string" ||
    entry.user_id !== binding.targetUserId ||
    !equalsLogin(entry.user_login, binding.targetUsername)
  ) {
    return "unverifiable";
  }
  return "present";
}

export function parseTwitchTimeoutTargetState(
  value: unknown,
  binding: TimeoutBinding,
  actorId: string
): TwitchTimeoutTargetState {
  const parsed = twitchTimeoutStateSchema.safeParse(value);
  if (!parsed.success || (parsed.data.errors?.length ?? 0) > 0) {
    return { state: "unverifiable" };
  }

  const { currentUser, channelUser, targetUser, banStatus } = parsed.data.data;
  if (
    currentUser.id !== actorId ||
    channelUser.id !== binding.channelId ||
    !equalsLogin(channelUser.login, binding.channelSlug) ||
    targetUser.id !== binding.targetUserId ||
    !equalsLogin(targetUser.login, binding.targetUsername)
  ) {
    return { state: "unverifiable" };
  }
  if (banStatus !== null) return { state: "invalid" };
  return { state: "unverifiable" };
}

function hasScope(credential: TwitchTimeoutCredential, scope: string): boolean {
  return credential.scopes.includes(scope);
}

function hasAnyScope(credential: TwitchTimeoutCredential, scopes: readonly string[]): boolean {
  return scopes.some((scope) => hasScope(credential, scope));
}

async function getProductionCredential(): Promise<TwitchTimeoutCredential | null> {
  const token = storageService.getToken("twitch");
  const user = storageService.getTwitchUser();
  const clientId = getOAuthConfig("twitch").clientId;
  if (!token || !user || !clientId) return null;

  const status = await tokenExchangeService.getTokenStatus("twitch", token);
  if (
    !status.valid ||
    status.userId !== user.id ||
    (typeof status.expiresAt === "number" && status.expiresAt <= Date.now())
  ) {
    return null;
  }
  return {
    actorId: user.id,
    actorUsername: status.login ?? user.login,
    accessToken: token.accessToken,
    clientId,
    scopes: status.scopes ?? [],
  };
}

async function authorizeProductionChannel(
  binding: TimeoutBinding,
  credential: TwitchTimeoutCredential
): Promise<ChannelAuthorization> {
  if (!hasScope(credential, TWITCH_TIMEOUT_SCOPE)) return { state: "unauthorized" };
  if (credential.actorId === binding.channelId) {
    return { state: "authorized", role: "broadcaster" };
  }
  if (!hasScope(credential, TWITCH_MOD_CHANNEL_SCOPE)) return { state: "unauthorized" };

  const channels = await getModeratedChannelsResult(
    credential.actorId,
    credential.accessToken,
    credential.clientId
  );
  if (channels.state !== "complete") return { state: "unverifiable" };
  return channels.channels.some((channel) => channel.broadcaster_id === binding.channelId)
    ? { state: "authorized", role: "moderator" }
    : { state: "unauthorized" };
}

async function queryProductionTargetState(
  binding: TimeoutBinding,
  credential: TwitchTimeoutCredential
): Promise<TwitchTimeoutTargetState> {
  return queryTwitchProductionTargetState(binding, credential);
}

export async function queryTwitchProductionTargetState(
  binding: TimeoutBinding,
  credential: TwitchTimeoutCredential,
  queryBannedUsers: typeof getBannedUsers = getBannedUsers,
  queryModerators: typeof getModerators = getModerators
): Promise<TwitchTimeoutTargetState> {
  if (credential.actorId !== binding.channelId) return { state: "unverifiable" };
  if (!hasAnyScope(credential, TWITCH_MODERATOR_READ_SCOPES)) {
    return { state: "unverifiable" };
  }

  try {
    const [bannedResult, moderatorsResult] = await Promise.all([
      queryBannedUsers({
        accessToken: credential.accessToken,
        broadcasterId: binding.channelId,
        moderatorUserId: credential.actorId,
        clientId: credential.clientId,
        userId: binding.targetUserId,
        first: 1,
      }),
      queryModerators({
        accessToken: credential.accessToken,
        broadcasterId: binding.channelId,
        clientId: credential.clientId,
        userId: binding.targetUserId,
      }),
    ]);
    if (!moderatorsResult.ok) return { state: "unverifiable" };

    const bannedState = classifyExactUserEntries(bannedResult.data, binding);
    const moderatorState = classifyExactUserEntries(moderatorsResult.payload.data, binding);
    if (bannedState === "unverifiable" || moderatorState === "unverifiable") {
      return { state: "unverifiable" };
    }
    if (bannedState === "present" || moderatorState === "present") {
      return { state: "invalid" };
    }
    return { state: "clear", targetIsModerator: false };
  } catch {
    return { state: "unverifiable" };
  }
}

const productionDependencies: TwitchTimeoutAdapterDependencies = {
  getCredential: getProductionCredential,
  authorizeChannel: authorizeProductionChannel,
  queryTargetState: queryProductionTargetState,
  execute: timeoutUser,
};

function safeTwitchFailure(
  result: Exclude<Awaited<ReturnType<typeof timeoutUser>>, { ok: true }>
): Exclude<Awaited<ReturnType<TimeoutAuthorityAdapter["executeTimeout"]>>, { ok: true }> {
  switch (result.kind) {
    case "missing-scopes":
    case "unauthorized":
      return {
        ok: false,
        code: "unauthorized",
        safeMessage: "Reconnect Twitch with moderation access, then try again.",
      };
    case "forbidden":
      return {
        ok: false,
        code: "forbidden",
        safeMessage: "Twitch rejected this timeout. Check your moderation access and try again.",
      };
    case "not-found":
      return {
        ok: false,
        code: "not-found",
        safeMessage: "Twitch could not find this user in the selected channel.",
      };
    case "rate-limited":
      return {
        ok: false,
        code: "rate-limited",
        safeMessage:
          result.retryAfterSeconds === null
            ? "Twitch is rate limiting moderation actions. Try again shortly."
            : `Twitch is rate limiting moderation actions. Try again in ${result.retryAfterSeconds} seconds.`,
      };
    case "network":
      return {
        ok: false,
        code: "network",
        safeMessage: "Twitch could not be reached. Check your connection and try again.",
      };
  }
}

export function createTwitchTimeoutAuthorityAdapter(
  dependencies: TwitchTimeoutAdapterDependencies = productionDependencies
): TimeoutAuthorityAdapter {
  return {
    async inspectTimeoutTarget(binding) {
      const credential = await dependencies.getCredential();
      if (!credential) return { state: "unavailable", reason: "unverifiable" };
      const authorization = await dependencies.authorizeChannel(binding, credential);
      if (authorization.state === "unauthorized") {
        return { state: "unavailable", reason: "unauthorized" };
      }
      if (authorization.state !== "authorized") {
        return { state: "unavailable", reason: "unverifiable" };
      }

      const target = await dependencies.queryTargetState(binding, credential);
      if (target.state === "unverifiable") {
        return { state: "unavailable", reason: "unverifiable" };
      }
      if (target.state === "invalid") {
        return { state: "unavailable", reason: "invalid-target-state" };
      }
      if (
        binding.targetUserId === credential.actorId ||
        binding.targetUserId === binding.channelId ||
        (target.targetIsModerator && authorization.role !== "broadcaster")
      ) {
        return { state: "unavailable", reason: "invalid-target-state" };
      }
      return {
        state: "verified",
        actor: {
          id: credential.actorId,
          username: credential.actorUsername,
          role: authorization.role,
        },
        target: { state: "clear" },
        policy: {
          durationUnit: "seconds",
          minDuration: 1,
          maxDuration: 1_209_600,
          supportsReason: true,
          maxReasonLength: 500,
        },
      };
    },
    async executeTimeout({ binding, actor, duration, reason }) {
      const credential = await dependencies.getCredential();
      if (!credential || credential.actorId !== actor.id) {
        return {
          ok: false,
          code: "unauthorized",
          safeMessage: "Your Twitch session changed. Reopen the user dialog and try again.",
        };
      }
      const result = await dependencies.execute({
        accessToken: credential.accessToken,
        clientId: credential.clientId,
        broadcasterId: binding.channelId,
        moderatorId: actor.id,
        userId: binding.targetUserId,
        durationSeconds: duration,
        ...(reason ? { reason } : {}),
      });
      return result.ok ? { ok: true } : safeTwitchFailure(result);
    },
  };
}
