import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";
import {
  streamInfoSchema,
  streamInfoUpdateSchema,
  streamInfoUpdateResultSchema,
} from "@shared/moderation-types";
import type { ChannelTools, EngagementItem } from "../../capabilities/channel-tools";
import { autoModCategories } from "../../capabilities/channel-tools";
import { getDesktopModerationServices } from "./moderation-services";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Twitch returned an invalid tool response.");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Twitch returned an invalid tool response.");
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Twitch returned an invalid tool response.");
  return value;
}

export function createDesktopChannelTools(
  execute: (command: TwitchApiCommand) => Promise<TwitchApiResult>,
  openExternal: (url: string) => Promise<void> = async () => {
    throw new Error("Desktop link handling is unavailable.");
  },
  searchCategories: ChannelTools["streamInfo"]["searchCategories"] = async () => {
    throw new Error("Category search is unavailable.");
  }
): ChannelTools {
  async function request(command: TwitchApiCommand): Promise<unknown> {
    const result = await execute(command);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }
  async function mutate(command: TwitchApiCommand): Promise<void> {
    await request(command);
  }
  return {
    openNativeView: (channel) =>
      openExternal(`https://www.twitch.tv/moderator/${encodeURIComponent(channel)}`),
    streamInfo: {
      get: async (broadcasterId) =>
        streamInfoSchema.parse(await request({ operation: "get-stream-info", broadcasterId })),
      async update(broadcasterId, settings) {
        streamInfoUpdateResultSchema.parse(
          await request({
            operation: "update-stream-info",
            broadcasterId,
            settings: streamInfoUpdateSchema.parse(settings),
          })
        );
      },
      searchCategories,
    },
    engagement: {
      async list(kind, channelId) {
        const data = record(
          await request({
            operation: kind === "polls" ? "get-polls" : "get-predictions",
            broadcasterId: channelId,
          })
        );
        return array(data.data).map((raw): EngagementItem => {
          const item = record(raw);
          return {
            id: string(item.id),
            title: string(item.title),
            status: string(item.status),
            options: array(kind === "polls" ? item.choices : item.outcomes).map((rawOption) => {
              const option = record(rawOption);
              const score = kind === "polls" ? option.votes : option.channel_points;
              if (typeof score !== "number" || !Number.isFinite(score))
                throw new Error("Twitch returned invalid engagement totals.");
              return { id: string(option.id), title: string(option.title), score };
            }),
          };
        });
      },
      create: (kind, broadcasterId, title, options, duration) =>
        mutate(
          kind === "polls"
            ? { operation: "create-poll", broadcasterId, title, choices: options, duration }
            : {
                operation: "create-prediction",
                broadcasterId,
                title,
                outcomes: options,
                predictionWindow: duration,
              }
        ),
      end: (kind, broadcasterId, id, action, winningOutcomeId) => {
        if (kind === "polls" && (action === "TERMINATED" || action === "ARCHIVED"))
          return mutate({ operation: "end-poll", broadcasterId, pollId: id, status: action });
        if (
          kind === "predictions" &&
          (action === "LOCKED" || action === "RESOLVED" || action === "CANCELED")
        )
          return mutate({
            operation: "end-prediction",
            broadcasterId,
            predictionId: id,
            status: action,
            winningOutcomeId,
          });
        return Promise.reject(new Error("Invalid engagement action."));
      },
    },
    shield: {
      async get(broadcasterId, moderatorId) {
        const response = record(
          await request({ operation: "get-shield-mode", broadcasterId, moderatorId })
        );
        if (typeof response.active !== "boolean")
          throw new Error("Twitch returned an invalid Shield state.");
        return response.active;
      },
      set: (broadcasterId, moderatorId, active) =>
        mutate({ operation: "set-shield-mode", broadcasterId, moderatorId, active }),
    },
    autoMod: {
      async get(broadcasterId, moderatorId) {
        const response = record(
          await request({ operation: "get-automod-settings", broadcasterId, moderatorId })
        );
        const level = response.overallLevel;
        if (
          level !== null &&
          (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 4)
        )
          throw new Error("Twitch returned an invalid AutoMod policy.");
        const levels = record(response.levels);
        const categories = Object.fromEntries(
          autoModCategories.map((key) => {
            const value = levels[key];
            if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4)
              throw new Error("Twitch returned an invalid AutoMod category level.");
            return [key, value];
          })
        ) as Awaited<ReturnType<ChannelTools["autoMod"]["get"]>>["categories"];
        return { level, categories };
      },
      set: (broadcasterId, moderatorId, policy) =>
        mutate({
          operation: "update-automod-settings",
          broadcasterId,
          moderatorId,
          settings:
            policy.level !== null
              ? { overall_level: policy.level }
              : {
                  aggression: policy.categories.aggression,
                  bullying: policy.categories.bullying,
                  disability: policy.categories.disability,
                  misogyny: policy.categories.misogyny,
                  race_ethnicity_or_religion: policy.categories.raceEthnicityOrReligion,
                  sex_based_terms: policy.categories.sexBasedTerms,
                  sexuality_sex_or_gender: policy.categories.sexualitySexOrGender,
                  swearing: policy.categories.swearing,
                },
        }),
    },
    terms: {
      async list(broadcasterId, moderatorId, after) {
        const response = record(
          await request({ operation: "get-blocked-terms", broadcasterId, moderatorId, after })
        );
        return {
          terms: array(response.items).map((raw) => {
            const term = record(raw);
            return { id: string(term.id), text: string(term.text) };
          }),
          ...(response.cursor == null ? {} : { cursor: string(response.cursor) }),
        };
      },
      add: (broadcasterId, moderatorId, text) =>
        mutate({ operation: "add-blocked-term", broadcasterId, moderatorId, text }),
      remove: (broadcasterId, moderatorId, termId) =>
        mutate({ operation: "remove-blocked-term", broadcasterId, moderatorId, termId }),
    },
  };
}

export function getDesktopChannelTools(): ChannelTools {
  return createDesktopChannelTools(
    (command) => getDesktopModerationServices().twitch.execute(command),
    async (url) => {
      await window.electronAPI.openExternal(url);
    },
    async (query) => {
      const response = await window.electronAPI.categories.search({
        platform: "twitch",
        query,
        limit: 10,
      });
      if (!response.success) throw new Error(response.error || "Category search failed.");
      return response.data.map((category) => ({ id: category.id, name: category.name }));
    }
  );
}
