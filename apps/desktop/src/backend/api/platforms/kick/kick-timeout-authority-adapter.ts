import { tokenExchangeService } from "@/backend/auth/token-exchange";
import type {
  TimeoutAuthorityAdapter,
  TimeoutBinding,
} from "@/backend/services/moderation/timeout-moderation-service";
import { storageService } from "@/backend/services/storage-service";

import { getChannelUserState, type KickChannelUserState } from "./endpoints/user-endpoints";
import {
  type KickModResult,
  type OfficialTimeoutKickUserArgs,
  timeoutKickUserOfficial,
} from "./kick-mod-mutations";

export interface KickTimeoutCredential {
  actorId: string;
  actorUsername?: string;
  accessToken: string;
  scopes: string[];
}

type ChannelAuthorization =
  | { state: "authorized"; role: "moderator" | "broadcaster" }
  | { state: "unauthorized" | "unverifiable" };

export type KickTimeoutTargetState =
  | { state: "clear"; targetIsModerator: boolean }
  | { state: "invalid" }
  | { state: "unverifiable" };

export interface KickTimeoutAdapterDependencies {
  getCredential(): Promise<KickTimeoutCredential | null>;
  authorizeChannel(
    binding: TimeoutBinding,
    credential: KickTimeoutCredential
  ): Promise<ChannelAuthorization>;
  queryTargetState(
    binding: TimeoutBinding,
    credential: KickTimeoutCredential
  ): Promise<KickTimeoutTargetState>;
  execute(args: OfficialTimeoutKickUserArgs): Promise<KickModResult>;
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

type ChannelUserStateReader = (
  channelSlug: string,
  username: string
) => Promise<KickChannelUserState | null>;

function exactPositiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

async function getProductionCredential(): Promise<KickTimeoutCredential | null> {
  const token = storageService.getToken("kick");
  const user = storageService.getKickUser();
  if (!token || !user) return null;

  const status = await tokenExchangeService.getTokenStatus("kick", token);
  if (
    !status.valid ||
    status.userId !== String(user.id) ||
    (typeof status.expiresAt === "number" && status.expiresAt <= Date.now())
  ) {
    return null;
  }
  return {
    actorId: String(user.id),
    actorUsername: status.login ?? user.username,
    accessToken: token.accessToken,
    scopes: status.scopes ?? [],
  };
}

export async function authorizeKickProductionChannel(
  binding: TimeoutBinding,
  credential: KickTimeoutCredential,
  readChannelUserState: ChannelUserStateReader = getChannelUserState
): Promise<ChannelAuthorization> {
  if (!credential.actorUsername) return { state: "unverifiable" };

  try {
    const actor = await readChannelUserState(binding.channelSlug, credential.actorUsername);
    if (
      !actor ||
      actor.userId !== credential.actorId ||
      normalized(actor.login) !== normalized(credential.actorUsername)
    ) {
      return { state: "unverifiable" };
    }
    if (actor.isChannelOwner) return { state: "authorized", role: "broadcaster" };
    if (actor.isModerator) return { state: "authorized", role: "moderator" };
    return { state: "unauthorized" };
  } catch {
    return { state: "unverifiable" };
  }
}

export async function queryKickProductionTargetState(
  binding: TimeoutBinding,
  _credential: KickTimeoutCredential,
  readChannelUserState: ChannelUserStateReader = getChannelUserState
): Promise<KickTimeoutTargetState> {
  try {
    const target = await readChannelUserState(binding.channelSlug, binding.targetUsername);
    if (
      !target ||
      target.userId !== binding.targetUserId ||
      normalized(target.login) !== normalized(binding.targetUsername)
    ) {
      return { state: "unverifiable" };
    }
    if (target.banned !== null || target.isStaff || target.isChannelOwner) {
      return { state: "invalid" };
    }
    return { state: "clear", targetIsModerator: target.isModerator };
  } catch {
    return { state: "unverifiable" };
  }
}

const productionDependencies: KickTimeoutAdapterDependencies = {
  getCredential: getProductionCredential,
  authorizeChannel: authorizeKickProductionChannel,
  queryTargetState: queryKickProductionTargetState,
  execute: timeoutKickUserOfficial,
};

function safeKickFailure(
  result: Exclude<KickModResult, { ok: true }>
): Exclude<Awaited<ReturnType<TimeoutAuthorityAdapter["executeTimeout"]>>, { ok: true }> {
  switch (result.kind) {
    case "unauthenticated":
      return {
        ok: false,
        code: "unauthorized",
        safeMessage: "Reconnect Kick with moderation access, then try again.",
      };
    case "forbidden":
      return {
        ok: false,
        code: "forbidden",
        safeMessage: "Kick rejected this timeout. Check your moderation access and try again.",
      };
    case "not-found":
      return {
        ok: false,
        code: "not-found",
        safeMessage: "Kick could not find this user in the selected channel.",
      };
    case "rate-limited":
      return {
        ok: false,
        code: "rate-limited",
        safeMessage:
          result.retryAfterSeconds === null
            ? "Kick is rate limiting moderation actions. Try again shortly."
            : `Kick is rate limiting moderation actions. Try again in ${result.retryAfterSeconds} seconds.`,
      };
    case "network":
      return {
        ok: false,
        code: "network",
        safeMessage: "Kick could not be reached. Check your connection and try again.",
      };
    case "unknown":
      return {
        ok: false,
        code: "unknown",
        safeMessage: "Kick could not complete the timeout. Try again.",
      };
  }
}

export function createKickTimeoutAuthorityAdapter(
  dependencies: KickTimeoutAdapterDependencies = productionDependencies
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
          durationUnit: "minutes",
          minDuration: 1,
          maxDuration: 10_080,
          supportsReason: true,
          maxReasonLength: 100,
        },
      };
    },
    async executeTimeout({ binding, actor, duration, reason }) {
      const credential = await dependencies.getCredential();
      const broadcasterUserId = exactPositiveInteger(binding.channelId);
      const userId = exactPositiveInteger(binding.targetUserId);
      if (
        !credential ||
        credential.actorId !== actor.id ||
        broadcasterUserId === null ||
        userId === null
      ) {
        return {
          ok: false,
          code: "unauthorized",
          safeMessage: "Your Kick session changed. Reopen the user dialog and try again.",
        };
      }
      const result = await dependencies.execute({
        accessToken: credential.accessToken,
        broadcasterUserId,
        userId,
        duration,
        ...(reason ? { reason } : {}),
      });
      return result.ok ? { ok: true } : safeKickFailure(result);
    },
  };
}
