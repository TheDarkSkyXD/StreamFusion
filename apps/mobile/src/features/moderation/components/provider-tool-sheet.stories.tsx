import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useEffect, useMemo } from "react";
import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type {
  ModerationChannel,
  ModerationGateway,
} from "../capabilities/moderation";
import type {
  ChannelToolsGateway,
  FeedState,
  ObservedEvent,
} from "../capabilities/provider-tools";
import { createModerationController } from "../domain/moderation-controller";
import { createProviderToolsController } from "../domain/provider-tools-controller";
import {
  ProviderToolSheet,
  type ProviderWorkspaceTool,
} from "./provider-tool-sheet";

const channel: ModerationChannel = {
  platform: "twitch",
  id: "101",
  login: "aurora",
  name: "aurora",
};
const at = "2026-10-05T12:00:00Z";
const event: ObservedEvent = {
  id: "event-1",
  occurredAt: at,
  userId: "202",
  name: "river",
  detail: "This message needs a closer look.",
  action: "automod.message.hold",
  messageId: "held-1",
  rewardId: null,
  redemptionId: null,
  status: "held",
};
function ToolStory({
  tool = "automod",
  state = "live",
  platform = "twitch",
}: {
  readonly tool?: ProviderWorkspaceTool;
  readonly state?: "live" | "empty" | "disconnected" | "permission";
  readonly platform?: "twitch" | "kick";
}) {
  const runtime = useMemo(() => {
    const selected = { ...channel, platform };
    const access: AuthenticatedPlatformAccess = {
      subscribe: () => () => undefined,
      read: async () => ({
        kind: "ready",
        platform,
        userId: "101",
        username: "aurora",
        generation: 1,
        scopes: [],
        accessToken: "storybook-only",
        clientId: "storybook",
      }),
    };
    const authorization: ModerationGateway = {
      verify: async () => ({ kind: "success", value: "broadcaster" }),
      channels: async () => ({ kind: "success", value: [selected] }),
      execute: async () => ({ kind: "success", value: undefined }),
      banned: async () => ({
        kind: "success",
        value: { users: [], cursor: null },
      }),
      settings: async () => ({
        kind: "success",
        value: {
          slowMode: false,
          slowSeconds: 30,
          followersOnly: false,
          followerMinutes: 0,
          subscribersOnly: false,
          emoteOnly: false,
          uniqueChat: false,
        },
      }),
      review: async (_channel, tool) => ({
        kind: "success",
        value: { tool, items: [], cursor: null },
      }),
    };
    const gateway: ChannelToolsGateway = {
      searchCategories: async (_actor, query) => ({
        kind: "success",
        value: {
          query,
          categories: [{ id: "509658", name: "Just Chatting" }],
          cursor: null,
        },
      }),
      async read(_channel, _actor, tool, _signal, _cursor, rewardId) {
        switch (tool) {
          case "stream-info":
            return {
              kind: "success",
              value: {
                kind: tool,
                title: "One more adventure before sunrise",
                categoryId: "509658",
                categoryName: "Just Chatting",
                language: "en",
                tags: ["English"],
                labels: [],
                availableLabels: [
                  { id: "ProfanityVulgarity", name: "Profanity and vulgarity" },
                ],
              },
            };
          case "shield":
            return {
              kind: "success",
              value: { kind: tool, active: false, activatedAt: "" },
            };
          case "automod-policy":
            return {
              kind: "success",
              value: {
                kind: tool,
                overall: 2,
                categories: {
                  aggression: 2,
                  bullying: 2,
                  disability: 2,
                  misogyny: 2,
                  race_ethnicity_or_religion: 2,
                  sex_based_terms: 2,
                  sexuality_sex_or_gender: 2,
                  swearing: 2,
                },
              },
            };
          case "blocked-terms":
            return {
              kind: "success",
              value: {
                kind: tool,
                terms: [{ id: "term1", text: "spoiler" }],
                cursor: null,
              },
            };
          case "community":
            return {
              kind: "success",
              value: {
                kind: tool,
                people: [
                  { id: "202", login: "river", name: "river" },
                  { id: "203", login: "kai", name: "kai" },
                ],
                total: 2,
                cursor: null,
              },
            };
          case "rewards":
            return {
              kind: "success",
              value: {
                kind: tool,
                rewards: [
                  { id: "reward1", title: "Choose the next build", cost: 1000 },
                ],
                rewardId: rewardId ?? null,
                redemptions: rewardId
                  ? [
                      {
                        id: "redemption1",
                        rewardId,
                        title: "Choose the next build",
                        userId: "202",
                        name: "river",
                        input: "Use the new build",
                        status: "UNFULFILLED",
                        redeemedAt: at,
                      },
                    ]
                  : [],
                cursor: null,
              },
            };
          case "raid-targets":
            return {
              kind: "success",
              value: {
                kind: tool,
                targets: [
                  {
                    id: "202",
                    name: "river",
                    login: "river",
                    title: "Late night adventure",
                    viewers: 42,
                  },
                ],
                cursor: null,
              },
            };
        }
      },
      async execute(_channel, _actor, command, _signal, beforeSubmit) {
        await beforeSubmit();
        return {
          kind: "success",
          value:
            command.kind === "raid"
              ? {
                  kind: "raid-pending",
                  targetId: command.targetId,
                  createdAt: at,
                  viewers: null,
                }
              : { kind: "confirmed" },
        };
      },
    };
    const moderation = createModerationController({
      access,
      gateway: authorization,
    });
    const controller = createProviderToolsController({
      access,
      authorization,
      gateway,
      feeds: {
        async subscribe(_channel, _actor, feed, receive) {
          const feedState: FeedState =
            state === "permission"
              ? {
                  kind: "permission",
                  scopes: ["moderator:manage:automod"],
                  detail: "Grant this tool's permissions to connect.",
                }
              : {
                  kind: state === "disconnected" ? "disconnected" : "live",
                  since: at,
                  items:
                    state === "empty"
                      ? []
                      : [
                          {
                            ...event,
                            action:
                              feed === "automod"
                                ? "automod.message.hold"
                                : feed === "whispers"
                                  ? "user.whisper.message"
                                  : feed === "suspicious"
                                    ? "channel.suspicious_user.message"
                                    : "channel.follow",
                            status: feed === "automod" ? "held" : null,
                          },
                        ],
                };
          receive(feedState);
        },
      },
      log: {
        read: async () => ({
          retentionDays: 30,
          startedAt: Date.parse(at),
          entries: [
            {
              id: "log1",
              at: Date.parse(at),
              channel: selected,
              actorId: "101",
              userId: "202",
              action: "timeout",
              detail: "Spam",
              source: "app-issued",
              outcome: "confirmed",
            },
          ],
        }),
        record: async () => undefined,
        setRetention: async () => undefined,
      },
    });
    controller.bindChannel(selected, 1);
    return { selected, moderation, controller };
  }, [state, platform]);
  useEffect(() => {
    void runtime.moderation.selectChannel(runtime.selected);
    return () => {
      runtime.controller.dispose();
      runtime.moderation.dispose();
    };
  }, [runtime]);
  return (
    <ProviderToolSheet
      controller={runtime.controller}
      moderation={runtime.moderation}
      channel={runtime.selected}
      tool={tool}
      onDismiss={() => undefined}
      onOpenProvider={() => undefined}
      onRequestScopes={() => undefined}
    />
  );
}
const meta = {
  title: "Mobile/Workflows/Provider tools",
  component: ToolStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ToolStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AutoModQueue: Story = { args: { tool: "automod" } };
export const EmptyQueue: Story = { args: { tool: "automod", state: "empty" } };
export const DisconnectedQueue: Story = {
  args: { tool: "automod", state: "disconnected" },
};
export const Permission: Story = {
  args: { tool: "automod", state: "permission" },
};
export const StreamTools: Story = { args: { tool: "stream" } };
export const ModActions: Story = { args: { tool: "logs" } };
export const KickRetention: Story = {
  args: { tool: "retention", platform: "kick" },
};
export const Activity: Story = { args: { tool: "activity" } };
export const Community: Story = { args: { tool: "community" } };
export const Rewards: Story = { args: { tool: "rewards" } };
export const Suspicious: Story = { args: { tool: "suspicious" } };
export const Whispers: Story = { args: { tool: "whispers" } };
export const KickProviderTools: Story = {
  args: { tool: "provider", platform: "kick" },
};
