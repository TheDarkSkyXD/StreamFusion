import { useLayoutEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelToolsPanel } from "@/features/moderation/components/screens/Mod/channel/workspace/ChannelToolsPanel";
import { ChannelEngagement } from "@/features/moderation/components/screens/Mod/channel/ChannelEngagement";
import { twitchToolAccess } from "@/features/moderation/adapters/electron/twitch-tool-access";
import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";

type StoryState = "ready" | "permission" | "error" | "loading" | "remote";
const scopes = [
  "moderator:manage:shield_mode",
  "moderator:manage:automod_settings",
  "moderator:manage:blocked_terms",
  "channel:manage:polls",
  "channel:manage:predictions",
  "channel:manage:broadcast",
];

function ChannelToolsCanvas({ state }: { state: StoryState }) {
  useLayoutEffect(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const original = window.electronAPI;
    let shield = true;
    let streamInfo = {
      broadcasterId: "123",
      title: "A relaxed evening of games and conversation",
      category: { id: "509658", name: "Just Chatting" },
      language: "en",
      tags: ["English", "Community", "Gaming"],
      contentClassificationLabels: ["MatureGame", "ProfanityVulgarity"],
      availableContentClassificationLabels: [
        {
          id: "ProfanityVulgarity",
          name: "Significant profanity",
          description: "Frequent strong language or vulgarity.",
        },
        { id: "Gambling", name: "Gambling", description: "Gambling or games of chance." },
        {
          id: "SexualThemes",
          name: "Sexual themes",
          description: "Discussion or depictions of sexual themes.",
        },
        {
          id: "ViolentGraphic",
          name: "Violent and graphic depictions",
          description: "Graphic violence or injury.",
        },
        {
          id: "DrugsIntoxication",
          name: "Drugs and intoxication",
          description: "Drug use or excessive intoxication.",
        },
        {
          id: "DebatedSocialIssuesAndPolitics",
          name: "Politics and sensitive social issues",
          description: "Discussion of sensitive political or social topics.",
        },
      ],
    };
    let policy = {
      overallLevel: null as number | null,
      levels: {
        aggression: 2,
        bullying: 2,
        disability: 2,
        misogyny: 2,
        raceEthnicityOrReligion: 3,
        sexBasedTerms: 1,
        sexualitySexOrGender: 2,
        swearing: 0,
      },
    };
    let terms = [{ id: "story-term-1", text: "example blocked phrase" }];
    let predictionStatus = "LOCKED";
    const execute = async (command: TwitchApiCommand): Promise<TwitchApiResult> => {
      if (state === "loading") return new Promise(() => {});
      if (state === "error")
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "Fixture: Twitch is temporarily unavailable. Retry when connected.",
          },
        };
      if (command.operation === "get-shield-mode") return { ok: true, data: { active: shield } };
      if (command.operation === "get-stream-info") return { ok: true, data: streamInfo };
      if (command.operation === "update-stream-info") {
        const settings = command.settings;
        streamInfo = {
          ...streamInfo,
          title: settings.title ?? streamInfo.title,
          language: settings.language ?? streamInfo.language,
          tags: settings.tags ?? streamInfo.tags,
          category:
            settings.categoryId === undefined
              ? streamInfo.category
              : {
                  id: settings.categoryId,
                  name:
                    settings.categoryId === "509658"
                      ? "Just Chatting"
                      : settings.categoryId
                        ? "Minecraft"
                        : "",
                },
          contentClassificationLabels: settings.contentClassificationLabels
            ? [
                "MatureGame",
                ...settings.contentClassificationLabels
                  .filter((label) => label.enabled)
                  .map((label) => label.id),
              ]
            : streamInfo.contentClassificationLabels,
        };
        return { ok: true, data: { updated: true } };
      }
      if (command.operation === "set-shield-mode") shield = command.active;
      if (command.operation === "get-automod-settings") return { ok: true, data: policy };
      if (command.operation === "update-automod-settings")
        policy = { ...policy, overallLevel: command.settings.overall_level ?? null };
      if (command.operation === "get-blocked-terms")
        return { ok: true, data: { items: terms, cursor: null } };
      if (command.operation === "add-blocked-term")
        terms = [...terms, { id: `story-term-${terms.length + 1}`, text: command.text }];
      if (command.operation === "remove-blocked-term")
        terms = terms.filter((term) => term.id !== command.termId);
      if (command.operation === "end-prediction") predictionStatus = command.status;
      if (command.operation === "get-predictions")
        return {
          ok: true,
          data: {
            data: [
              {
                id: "story-prediction",
                title: "Will the final boss fall?",
                status: predictionStatus,
                outcomes: [
                  { id: "yes", title: "Victory", channel_points: 24500 },
                  { id: "no", title: "Another attempt", channel_points: 18300 },
                ],
              },
            ],
          },
        };
      return { ok: true, data: { data: [] } };
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        ...original,
        twitch: { ...original.twitch, execute },
        categories: {
          ...original.categories,
          search: async () => ({
            success: true,
            data: [
              { id: "509658", name: "Just Chatting" },
              { id: "27471", name: "Minecraft" },
            ],
            providers: { twitch: "complete", kick: "not-requested" },
          }),
        },
        openExternal: async () => {},
      },
    });
    return () => {
      if (descriptor) Object.defineProperty(window, "electronAPI", descriptor);
    };
  }, [state]);
  const access = twitchToolAccess(state === "permission" ? [] : scopes, state !== "remote");
  return (
    <div className="grid min-h-[720px] grid-cols-1 gap-3 bg-[#0e0e10] p-4 text-white md:grid-cols-2">
      <div className="rounded-md border border-[#303034] bg-[#18181b]">
        <ChannelToolsPanel
          key={state}
          channelId="123"
          actorId="123"
          channel="fixture"
          refreshCounter={0}
          access={access}
          requestScopes={() => {}}
        />
      </div>
      <div className="rounded-md border border-[#303034] bg-[#18181b]">
        <ChannelEngagement
          key={state}
          broadcasterId="123"
          channel="fixture"
          access={access}
          requestScopes={() => {}}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Pages/Moderation/Channel/ChannelTools",
  component: ChannelToolsCanvas,
  args: { state: "ready" },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Local bridge fixtures for existing moderation tools. These stories never call Twitch or live IPC.",
      },
    },
  },
} satisfies Meta<typeof ChannelToolsCanvas>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const PermissionRequired: Story = { args: { state: "permission" } };
export const ProviderError: Story = { args: { state: "error" } };
export const Loading: Story = { args: { state: "loading" } };
export const RemoteModerator: Story = { args: { state: "remote" } };
