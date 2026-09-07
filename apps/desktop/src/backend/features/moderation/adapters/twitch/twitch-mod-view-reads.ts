import { z } from "zod";
import { readStreamInfo, updateStreamInfo } from "./twitch-stream-info";
import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";
import type {
  AutoModPolicy,
  BlockedTerm,
  RewardRedemption,
  ShieldState,
} from "@shared/moderation-types";
import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import {
  query,
  requestDecoded,
  emptyResponseSchema,
} from "@backend/api/platforms/twitch/twitch-command-request";
import {
  acquireModerationAccountLease,
  type ModerationAccountLease,
} from "./moderation-account-lease";

const member = z.object({ user_id: z.string(), user_login: z.string(), user_name: z.string() });
const pagination = z.object({ cursor: z.string().optional() }).optional();
const members = z.object({ data: z.array(member), pagination, total: z.number().optional() });
const term = z.object({
  id: z.string(),
  text: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  expires_at: z.string().nullable(),
});
const terms = z.object({ data: z.array(term), pagination });
const shield = z.object({
  data: z
    .array(
      z.object({
        is_active: z.boolean(),
        moderator_id: z.string(),
        moderator_login: z.string(),
        moderator_name: z.string(),
        last_activated_at: z.string(),
      })
    )
    .min(1),
});
const level = z.number().int().min(0).max(4);
const automod = z.object({
  data: z
    .array(
      z.object({
        overall_level: level.nullable(),
        aggression: level,
        bullying: level,
        disability: level,
        misogyny: level,
        race_ethnicity_or_religion: level,
        sex_based_terms: level,
        sexuality_sex_or_gender: level,
        swearing: level,
      })
    )
    .min(1),
});
const rewards = z.object({
  data: z.array(z.object({ id: z.string(), title: z.string(), cost: z.number() })),
});
const redemptions = z.object({
  data: z.array(
    member.extend({
      id: z.string(),
      user_input: z.string(),
      status: z.enum(["UNFULFILLED", "FULFILLED", "CANCELED"]),
      redeemed_at: z.string(),
      reward: z.object({ id: z.string(), title: z.string(), cost: z.number() }),
    })
  ),
  pagination,
});
const identity = (value: z.infer<typeof member>) => ({
  id: value.user_id,
  login: value.user_login,
  displayName: value.user_name,
});
const blockedTerm = (value: z.infer<typeof term>): BlockedTerm => ({
  id: value.id,
  text: value.text,
  createdAt: value.created_at,
  updatedAt: value.updated_at,
  expiresAt: value.expires_at || null,
});

const suspiciousStatus = z.object({
  data: z
    .array(
      z.object({
        user_id: z.string(),
        status: z.enum(["ACTIVE_MONITORING", "RESTRICTED", "NO_TREATMENT"]),
        updated_at: z.string(),
      })
    )
    .min(1),
});
const scopesByOperation = {
  "get-stream-info": ["channel:manage:broadcast"],
  "update-stream-info": ["channel:manage:broadcast"],
  "set-suspicious-user-status": ["moderator:manage:suspicious_users"],
  "update-reward-redemption": ["channel:manage:redemptions"],
  "get-shield-mode": ["moderator:read:shield_mode", "moderator:manage:shield_mode"],
  "get-automod-settings": ["moderator:read:automod_settings", "moderator:manage:automod_settings"],
  "update-automod-settings": ["moderator:manage:automod_settings"],
  "get-blocked-terms": ["moderator:read:blocked_terms", "moderator:manage:blocked_terms"],
  "add-blocked-term": ["moderator:manage:blocked_terms"],
  "remove-blocked-term": ["moderator:manage:blocked_terms"],
  "get-chatters": ["moderator:read:chatters"],
  "get-active-moderators": ["moderator:read:chatters"],
  "get-manageable-rewards": ["channel:read:redemptions", "channel:manage:redemptions"],
  "get-reward-redemptions": ["channel:read:redemptions", "channel:manage:redemptions"],
} satisfies Record<string, readonly string[]>;

export async function executeTwitchModViewCommand(
  requestor: TwitchHelixRequestPort,
  command: TwitchApiCommand,
  acquireLease: () => Promise<ModerationAccountLease | null> = acquireModerationAccountLease
): Promise<TwitchApiResult | null> {
  if (!(command.operation in scopesByOperation)) return null;
  const operation = command.operation;
  if (!(operation in scopesByOperation) || !("broadcasterId" in command)) return null;
  const required = Object.entries(scopesByOperation).find(([key]) => key === operation)?.[1] ?? [];
  const lease = await acquireLease();
  if (!lease || !lease.isCurrent())
    return {
      ok: false,
      error: { code: "unauthorized", message: "Reconnect Twitch before using this tool." },
    };
  const broadcasterOnly =
    operation === "get-stream-info" ||
    operation === "update-stream-info" ||
    operation === "get-active-moderators" ||
    operation === "get-manageable-rewards" ||
    operation === "get-reward-redemptions" ||
    operation === "update-reward-redemption";
  if (
    ("moderatorId" in command && command.moderatorId !== lease.userId) ||
    (broadcasterOnly && command.broadcasterId !== lease.userId)
  )
    return {
      ok: false,
      error: {
        code: "forbidden",
        message: "This operation requires the matching signed-in actor.",
      },
    };
  if (
    !required.some((scope) => lease.scopes.includes(scope)) ||
    (operation === "get-active-moderators" &&
      !["moderation:read", "channel:manage:moderators"].some((scope) =>
        lease.scopes.includes(scope)
      ))
  )
    return {
      ok: false,
      error: {
        code: "missing-scope",
        message: `Reconnect Twitch with ${required.join(" or ")}${operation === "get-active-moderators" ? " and moderation:read or channel:manage:moderators" : ""}.`,
      },
    };
  const scopedRequestor: TwitchHelixRequestPort = {
    request: async (endpoint, options) => {
      if (!lease.isCurrent()) throw new Error("The Twitch account changed.");
      const response = await requestor.request(endpoint, options);
      if (!lease.isCurrent()) throw new Error("The Twitch account changed.");
      return response;
    },
  };
  const actorQuery = { broadcaster_id: command.broadcasterId, moderator_id: lease.userId };
  try {
    if (command.operation === "get-stream-info") {
      return { ok: true, data: await readStreamInfo(scopedRequestor, command.broadcasterId) };
    }
    if (command.operation === "update-stream-info") {
      await updateStreamInfo(scopedRequestor, command.broadcasterId, command.settings);
      return { ok: true, data: { updated: true } };
    }
    if (command.operation === "set-suspicious-user-status") {
      const removing = command.status === "NO_TREATMENT";
      const response = await requestDecoded(
        scopedRequestor,
        suspiciousStatus,
        query("/moderation/suspicious_users", {
          ...actorQuery,
          user_id: removing ? command.userId : undefined,
        }),
        removing
          ? { method: "DELETE" }
          : {
              method: "POST",
              body: JSON.stringify({ user_id: command.userId, status: command.status }),
            }
      );
      const value = response.data[0];
      if (!value || value.user_id !== command.userId || value.status !== command.status)
        throw new Error("Twitch did not confirm the requested suspicious status.");
      return {
        ok: true,
        data: { userId: value.user_id, status: value.status, updatedAt: value.updated_at },
      };
    }
    if (command.operation === "get-shield-mode") {
      const response = await requestDecoded(
        scopedRequestor,
        shield,
        query("/moderation/shield_mode", actorQuery)
      );
      const value = response.data[0];
      if (!value) throw new Error("Twitch returned no Shield state.");
      const data: ShieldState = {
        active: value.is_active,
        moderator: {
          id: value.moderator_id,
          login: value.moderator_login,
          displayName: value.moderator_name,
        },
        lastActivatedAt: value.last_activated_at,
      };
      return { ok: true, data };
    }
    if (
      command.operation === "get-automod-settings" ||
      command.operation === "update-automod-settings"
    ) {
      const response = await requestDecoded(
        scopedRequestor,
        automod,
        query("/moderation/automod/settings", actorQuery),
        command.operation === "update-automod-settings"
          ? { method: "PUT", body: JSON.stringify(command.settings) }
          : undefined
      );
      const value = response.data[0];
      if (!value) throw new Error("Twitch returned no AutoMod policy.");
      const data: AutoModPolicy = {
        overallLevel: value.overall_level,
        levels: {
          aggression: value.aggression,
          bullying: value.bullying,
          disability: value.disability,
          misogyny: value.misogyny,
          raceEthnicityOrReligion: value.race_ethnicity_or_religion,
          sexBasedTerms: value.sex_based_terms,
          sexualitySexOrGender: value.sexuality_sex_or_gender,
          swearing: value.swearing,
        },
      };
      return { ok: true, data };
    }
    if (command.operation === "get-blocked-terms" || command.operation === "add-blocked-term") {
      const response = await requestDecoded(
        scopedRequestor,
        terms,
        query("/moderation/blocked_terms", {
          ...actorQuery,
          first: 100,
          after: command.operation === "get-blocked-terms" ? command.after : undefined,
        }),
        command.operation === "add-blocked-term"
          ? { method: "POST", body: JSON.stringify({ text: command.text }) }
          : undefined
      );
      if (command.operation === "add-blocked-term") {
        const value = response.data[0];
        if (!value) throw new Error("Twitch returned no blocked term.");
        return { ok: true, data: blockedTerm(value) };
      }
      return {
        ok: true,
        data: {
          items: response.data.map(blockedTerm),
          cursor: response.pagination?.cursor ?? null,
        },
      };
    }
    if (command.operation === "remove-blocked-term") {
      await requestDecoded(
        scopedRequestor,
        emptyResponseSchema,
        query("/moderation/blocked_terms", { ...actorQuery, id: command.termId }),
        { method: "DELETE" }
      );
      return { ok: true, data: undefined };
    }
    if (command.operation === "get-chatters" || command.operation === "get-active-moderators") {
      const response = await requestDecoded(
        scopedRequestor,
        members,
        query("/chat/chatters", { ...actorQuery, first: 100, after: command.after })
      );
      const data = {
        items: response.data.map(identity),
        cursor: response.pagination?.cursor ?? null,
        total: response.total ?? response.data.length,
        observedAt: new Date().toISOString(),
      };
      if (command.operation === "get-chatters") return { ok: true, data };
      const roster = await requestDecoded(
        scopedRequestor,
        members,
        query("/moderation/moderators", { broadcaster_id: command.broadcasterId, first: 100 })
      );
      const ids = new Set(roster.data.map((value) => value.user_id));
      return {
        ok: true,
        data: {
          ...data,
          items: data.items.filter((value) => ids.has(value.id)),
          coverage: "chatters-page",
          rosterComplete: !roster.pagination?.cursor,
        },
      };
    }
    if (
      command.operation === "get-manageable-rewards" ||
      command.operation === "get-reward-redemptions" ||
      command.operation === "update-reward-redemption"
    ) {
      const manageable = await requestDecoded(
        scopedRequestor,
        rewards,
        query("/channel_points/custom_rewards", {
          broadcaster_id: command.broadcasterId,
          only_manageable_rewards: "true",
        })
      );
      if (command.operation === "get-manageable-rewards")
        return { ok: true, data: { items: manageable.data } };
      if (!manageable.data.some((reward) => reward.id === command.rewardId))
        return {
          ok: false,
          error: {
            code: "forbidden",
            message: "Redemption history is available only for rewards created by this app.",
          },
        };
      const response = await requestDecoded(
        scopedRequestor,
        redemptions,
        query("/channel_points/custom_rewards/redemptions", {
          broadcaster_id: command.broadcasterId,
          reward_id: command.rewardId,
          ...(command.operation === "update-reward-redemption"
            ? { id: command.redemptionId }
            : { status: "UNFULFILLED", first: 50, after: command.after }),
        }),
        command.operation === "update-reward-redemption"
          ? { method: "PATCH", body: JSON.stringify({ status: command.status }) }
          : undefined
      );
      if (
        command.operation === "update-reward-redemption" &&
        !response.data.some(
          (value) =>
            value.id === command.redemptionId &&
            value.reward.id === command.rewardId &&
            value.status === command.status
        )
      )
        throw new Error("Twitch did not confirm the reward decision.");
      const items: RewardRedemption[] = response.data.map((value) => ({
        redemptionId: value.id,
        rewardId: value.reward.id,
        rewardTitle: value.reward.title,
        cost: value.reward.cost,
        user: identity(value),
        input: value.user_input,
        status:
          value.status === "UNFULFILLED"
            ? "unfulfilled"
            : value.status === "FULFILLED"
              ? "fulfilled"
              : "canceled",
        redeemedAt: value.redeemed_at,
      }));
      return { ok: true, data: { items, cursor: response.pagination?.cursor ?? null } };
    }
    return null;
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? error.status : null;
    return {
      ok: false,
      error: {
        code: status === 403 ? "forbidden" : status === 401 ? "unauthorized" : "unavailable",
        message:
          error instanceof Error ? error.message : "Twitch could not complete this operation.",
      },
    };
  }
}
