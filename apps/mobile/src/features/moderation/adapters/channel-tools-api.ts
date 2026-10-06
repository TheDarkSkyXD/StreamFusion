import { z } from "zod";
import type {
  ChannelToolsGateway,
  ToolSnapshot,
  ToolCommandResult,
} from "../capabilities/provider-tools";
import type { ProviderResult } from "../capabilities/moderation";
import { createProviderRequest, malformed } from "./provider-request";

const page = z.object({ cursor: z.string().optional() }).optional();
const person = z.object({
  user_id: z.string(),
  user_login: z.string(),
  user_name: z.string(),
});
const info = z.object({
  data: z
    .array(
      z.object({
        broadcaster_id: z.string(),
        title: z.string(),
        game_id: z.string(),
        game_name: z.string(),
        broadcaster_language: z.string(),
        tags: z.array(z.string()),
        content_classification_labels: z.array(z.string()),
      }),
    )
    .min(1),
});
const labels = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string() })),
});
const level = z.number().int().min(0).max(4);
const policy = z.object({
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
      }),
    )
    .min(1),
});
const shield = z.object({
  data: z
    .array(z.object({ is_active: z.boolean(), last_activated_at: z.string() }))
    .min(1),
});
const terms = z.object({
  data: z.array(z.object({ id: z.string(), text: z.string() })),
  pagination: page,
});
const chatters = z.object({
  data: z.array(person),
  total: z.number().int().nonnegative(),
  pagination: page,
});
const rewards = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      cost: z.number().nonnegative(),
    }),
  ),
});
const redemptions = z.object({
  data: z.array(
    person.extend({
      id: z.string(),
      user_input: z.string(),
      status: z.enum(["UNFULFILLED", "FULFILLED", "CANCELED"]),
      redeemed_at: z.string(),
      reward: z.object({ id: z.string(), title: z.string() }),
    }),
  ),
  pagination: page,
});
const streams = z.object({
  data: z.array(
    z.object({
      user_id: z.string(),
      user_login: z.string(),
      user_name: z.string(),
      title: z.string(),
      viewer_count: z.number().nonnegative(),
      type: z.string(),
    }),
  ),
  pagination: page,
});
const raid = z.object({
  data: z
    .array(
      z.object({
        created_at: z.string(),
        viewer_count: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});
const editableLabel = z.enum([
  "DebatedSocialIssuesAndPolitics",
  "DrugsIntoxication",
  "SexualThemes",
  "ViolentGraphic",
  "Gambling",
  "ProfanityVulgarity",
]);
const suspiciousResponse = z.object({
  data: z
    .array(
      z.object({
        user_id: z.string(),
        status: z.enum(["ACTIVE_MONITORING", "RESTRICTED", "NO_TREATMENT"]),
      }),
    )
    .min(1),
});
function unsupported(): ProviderResult<never> {
  return {
    kind: "failure",
    reason: "unsupported",
    detail:
      "Kick does not publish this tool in its official API. Open the Kick channel to use provider tools that are available there.",
  };
}
export function createChannelToolsApi(
  fetcher = globalThis.fetch,
): ChannelToolsGateway {
  const request = createProviderRequest(fetcher);
  return {
    async searchCategories(credential, query, signal, cursor) {
      if (credential.platform !== "twitch") return unsupported();
      const result = await request({
        credential,
        signal,
        path: `/search/categories?query=${encodeURIComponent(query)}&first=30${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
      });
      if (result.kind === "failure") return result;
      const parsed = z
        .object({
          data: z.array(z.object({ id: z.string(), name: z.string() })),
          pagination: page,
        })
        .safeParse(result.value);
      return parsed.success
        ? {
            kind: "success",
            value: {
              query,
              categories: parsed.data.data,
              cursor: parsed.data.pagination?.cursor ?? null,
            },
          }
        : malformed();
    },
    async read(
      channel,
      credential,
      tool,
      signal,
      cursor,
      rewardId,
    ): Promise<ProviderResult<ToolSnapshot>> {
      if (channel.platform !== "twitch") return unsupported();
      const actor = `broadcaster_id=${encodeURIComponent(channel.id)}&moderator_id=${encodeURIComponent(credential.userId)}`;
      const after = cursor ? `&after=${encodeURIComponent(cursor)}` : "";
      const paths = {
        "stream-info": `/channels?broadcaster_id=${encodeURIComponent(channel.id)}`,
        shield: `/moderation/shield_mode?${actor}`,
        "automod-policy": `/moderation/automod/settings?${actor}`,
        "blocked-terms": `/moderation/blocked_terms?${actor}&first=100${after}`,
        community: `/chat/chatters?${actor}&first=100${after}`,
        rewards: `/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(channel.id)}&only_manageable_rewards=true`,
        "raid-targets": `/streams?first=20${after}`,
      };
      const result = await request({ credential, signal, path: paths[tool] });
      if (result.kind === "failure") return result;
      switch (tool) {
        case "stream-info": {
          const parsed = info.safeParse(result.value);
          const row = parsed.success
            ? parsed.data.data.find((row) => row.broadcaster_id === channel.id)
            : undefined;
          if (!row) return malformed();
          const catalog = await request({
            credential,
            signal,
            path: "/content_classification_labels?locale=en-US",
          });
          if (catalog.kind === "failure") return catalog;
          const available = labels.safeParse(catalog.value);
          return available.success
            ? {
                kind: "success",
                value: {
                  kind: tool,
                  title: row.title,
                  categoryId: row.game_id,
                  categoryName: row.game_name,
                  language: row.broadcaster_language,
                  tags: row.tags,
                  labels: row.content_classification_labels,
                  availableLabels: available.data.data.filter(
                    (label) => editableLabel.safeParse(label.id).success,
                  ),
                },
              }
            : malformed();
        }
        case "shield": {
          const parsed = shield.safeParse(result.value);
          const row = parsed.success ? parsed.data.data[0] : undefined;
          return row
            ? {
                kind: "success",
                value: {
                  kind: tool,
                  active: row.is_active,
                  activatedAt: row.last_activated_at,
                },
              }
            : malformed();
        }
        case "automod-policy": {
          const parsed = policy.safeParse(result.value);
          const row = parsed.success ? parsed.data.data[0] : undefined;
          if (!row) return malformed();
          const { overall_level: overall, ...categories } = row;
          return {
            kind: "success",
            value: { kind: tool, overall, categories },
          };
        }
        case "blocked-terms": {
          const parsed = terms.safeParse(result.value);
          return parsed.success
            ? {
                kind: "success",
                value: {
                  kind: tool,
                  terms: parsed.data.data,
                  cursor: parsed.data.pagination?.cursor ?? null,
                },
              }
            : malformed();
        }
        case "community": {
          const parsed = chatters.safeParse(result.value);
          return parsed.success
            ? {
                kind: "success",
                value: {
                  kind: tool,
                  people: parsed.data.data.map((row) => ({
                    id: row.user_id,
                    login: row.user_login,
                    name: row.user_name,
                  })),
                  total: parsed.data.total,
                  cursor: parsed.data.pagination?.cursor ?? null,
                },
              }
            : malformed();
        }
        case "rewards": {
          const parsed = rewards.safeParse(result.value);
          if (!parsed.success) return malformed();
          if (!rewardId)
            return {
              kind: "success",
              value: {
                kind: tool,
                rewards: parsed.data.data,
                redemptions: [],
                rewardId: null,
                cursor: null,
              },
            };
          if (!parsed.data.data.some((reward) => reward.id === rewardId))
            return {
              kind: "failure",
              reason: "permission",
              detail:
                "This app can manage redemptions only for rewards created by this Twitch application.",
            };
          const pageResult = await request({
            credential,
            signal,
            path: `/channel_points/custom_rewards/redemptions?broadcaster_id=${encodeURIComponent(channel.id)}&reward_id=${encodeURIComponent(rewardId)}&status=UNFULFILLED&first=50${after}`,
          });
          if (pageResult.kind === "failure") return pageResult;
          const decoded = redemptions.safeParse(pageResult.value);
          return decoded.success
            ? {
                kind: "success",
                value: {
                  kind: tool,
                  rewards: parsed.data.data,
                  rewardId,
                  cursor: decoded.data.pagination?.cursor ?? null,
                  redemptions: decoded.data.data.map((row) => ({
                    id: row.id,
                    rewardId: row.reward.id,
                    title: row.reward.title,
                    userId: row.user_id,
                    name: row.user_name,
                    input: row.user_input,
                    status: row.status,
                    redeemedAt: row.redeemed_at,
                  })),
                },
              }
            : malformed();
        }
        case "raid-targets": {
          const parsed = streams.safeParse(result.value);
          return parsed.success
            ? {
                kind: "success",
                value: {
                  kind: tool,
                  targets: parsed.data.data
                    .filter(
                      (row) =>
                        row.type === "live" && row.user_id !== channel.id,
                    )
                    .map((row) => ({
                      id: row.user_id,
                      login: row.user_login,
                      name: row.user_name,
                      title: row.title,
                      viewers: row.viewer_count,
                    })),
                  cursor: parsed.data.pagination?.cursor ?? null,
                },
              }
            : malformed();
        }
      }
    },
    async execute(
      channel,
      credential,
      command,
      signal,
      beforeSubmit,
    ): Promise<ProviderResult<ToolCommandResult>> {
      if (channel.platform !== "twitch") return unsupported();
      const actor = `broadcaster_id=${encodeURIComponent(channel.id)}&moderator_id=${encodeURIComponent(credential.userId)}`;
      let path: string;
      let method: "POST" | "PUT" | "PATCH" | "DELETE";
      let body: unknown;
      switch (command.kind) {
        case "stream-info":
          path = `/channels?broadcaster_id=${encodeURIComponent(channel.id)}`;
          method = "PATCH";
          body = {
            title: command.value.title,
            game_id: command.value.categoryId,
            broadcaster_language: command.value.language,
            tags: command.value.tags,
            content_classification_labels: command.value.availableLabels.map(
              (label) => ({
                id: label.id,
                is_enabled: command.value.labels.includes(label.id),
              }),
            ),
          };
          break;
        case "shield":
          path = `/moderation/shield_mode?${actor}`;
          method = "PUT";
          body = { is_active: command.active };
          break;
        case "automod-policy":
          path = `/moderation/automod/settings?${actor}`;
          method = "PUT";
          body =
            command.value.overall === null
              ? command.value.categories
              : { overall_level: command.value.overall };
          break;
        case "add-term":
          path = `/moderation/blocked_terms?${actor}`;
          method = "POST";
          body = { text: command.text };
          break;
        case "remove-term":
          path = `/moderation/blocked_terms?${actor}&id=${encodeURIComponent(command.id)}`;
          method = "DELETE";
          break;
        case "raid": {
          const live = await request({
            credential,
            signal,
            path: `/streams?user_id=${encodeURIComponent(command.targetId)}`,
          });
          if (live.kind === "failure") return live;
          const parsed = streams.safeParse(live.value);
          if (!parsed.success) return malformed();
          if (
            !parsed.data.data.some(
              (row) => row.user_id === command.targetId && row.type === "live",
            ) ||
            command.targetId === channel.id
          )
            return {
              kind: "failure",
              reason: "invalid",
              detail:
                "The raid target is no longer live. Refresh the target list.",
            };
          if (signal.aborted)
            return {
              kind: "failure",
              reason: "network",
              detail: "Raid cancelled before submission.",
            };
          path = `/raids?from_broadcaster_id=${encodeURIComponent(channel.id)}&to_broadcaster_id=${encodeURIComponent(command.targetId)}`;
          method = "POST";
          break;
        }
        case "cancel-raid":
          path = `/raids?broadcaster_id=${encodeURIComponent(channel.id)}`;
          method = "DELETE";
          break;
        case "reward-decision": {
          const manageable = await request({
            credential,
            signal,
            path: `/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(channel.id)}&only_manageable_rewards=true`,
          });
          if (manageable.kind === "failure") return manageable;
          const parsed = rewards.safeParse(manageable.value);
          if (!parsed.success) return malformed();
          if (
            !parsed.data.data.some((reward) => reward.id === command.rewardId)
          )
            return {
              kind: "failure",
              reason: "permission",
              detail: "This reward was not created by this Twitch application.",
            };
          if (signal.aborted)
            return {
              kind: "failure",
              reason: "network",
              detail: "Decision cancelled before submission.",
            };
          path = `/channel_points/custom_rewards/redemptions?broadcaster_id=${encodeURIComponent(channel.id)}&reward_id=${encodeURIComponent(command.rewardId)}&id=${encodeURIComponent(command.redemptionId)}`;
          method = "PATCH";
          body = { status: command.status };
          break;
        }
        case "suspicious-status":
          path = `/moderation/suspicious_users?${actor}${command.status === "NO_TREATMENT" ? `&user_id=${encodeURIComponent(command.userId)}` : ""}`;
          method = command.status === "NO_TREATMENT" ? "DELETE" : "POST";
          if (command.status !== "NO_TREATMENT")
            body = { user_id: command.userId, status: command.status };
          break;
        case "whisper":
          path = `/whispers?from_user_id=${encodeURIComponent(credential.userId)}&to_user_id=${encodeURIComponent(command.userId)}`;
          method = "POST";
          body = { message: command.text };
          break;
      }
      if (!(await beforeSubmit()) || signal.aborted)
        return {
          kind: "failure",
          reason: "auth",
          detail: "Account or channel changed before submission.",
        };
      const result = await request({
        credential,
        signal,
        path,
        method,
        ...(body === undefined ? {} : { body }),
      });
      if (result.kind === "failure") return result;
      if (command.kind === "raid") {
        const parsed = raid.safeParse(result.value);
        const row = parsed.success ? parsed.data.data[0] : undefined;
        return row
          ? {
              kind: "success",
              value: {
                kind: "raid-pending",
                targetId: command.targetId,
                createdAt: row.created_at,
                viewers: row.viewer_count ?? null,
              },
            }
          : malformed();
      }
      if (command.kind === "shield") {
        const parsed = shield.safeParse(result.value);
        if (
          !parsed.success ||
          parsed.data.data[0]?.is_active !== command.active
        )
          return malformed();
      }
      if (
        command.kind === "automod-policy" &&
        !policy.safeParse(result.value).success
      )
        return malformed();
      if (command.kind === "add-term" && !terms.safeParse(result.value).success)
        return malformed();
      if (command.kind === "suspicious-status") {
        const parsed = suspiciousResponse.safeParse(result.value);
        if (
          !parsed.success ||
          !parsed.data.data.some(
            (row) =>
              row.user_id === command.userId && row.status === command.status,
          )
        )
          return malformed();
      }
      if (command.kind === "reward-decision") {
        const parsed = redemptions.safeParse(result.value);
        if (
          !parsed.success ||
          !parsed.data.data.some(
            (row) =>
              row.id === command.redemptionId &&
              row.reward.id === command.rewardId &&
              row.status === command.status,
          )
        )
          return malformed();
      }
      return { kind: "success", value: { kind: "confirmed" } };
    },
  };
}
