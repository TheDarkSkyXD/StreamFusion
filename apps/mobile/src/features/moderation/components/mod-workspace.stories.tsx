import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type { Platform } from "@streamfusion/core/platform";
import { mobileType } from "@mobile/design/tokens";
import type {
  ModerationChannel,
  ModerationGateway,
  ReviewItem,
} from "../capabilities/moderation";
import { createModerationController } from "../domain/moderation-controller";
import { ModWorkspace } from "./mod-workspace";

function createStoryRuntime({
  platform,
  role,
  denied,
}: {
  readonly platform: Platform;
  readonly role: "broadcaster" | "moderator";
  readonly denied: boolean;
}) {
  const own: ModerationChannel = {
    platform,
    id: "101",
    login: "theater",
    name: "Theater",
  };
  const channel: ModerationChannel =
    role === "broadcaster"
      ? own
      : { ...own, id: "202", login: "community", name: "Community" };
  const access: AuthenticatedPlatformAccess = {
    subscribe: () => () => undefined,
    async read(provider) {
      return {
        kind: "ready",
        platform: provider,
        accessToken: "storybook-fixture",
        clientId: "storybook",
        userId: own.id,
        username: own.login,
        generation: 1,
        scopes: [],
      };
    },
  };
  const members: Record<"moderators" | "vips", ReviewItem[]> = {
    moderators: [{ kind: "member", userId: "401", name: "NightModerator" }],
    vips: [{ kind: "member", userId: "402", name: "LongtimeViewer" }],
  };
  const appeals: ReviewItem[] = [
    {
      kind: "unban",
      id: "appeal-1",
      userId: "303",
      name: "ReturningViewer",
      text: "I understand the channel rules now. May I return?",
    },
  ];
  let banned = [
    {
      id: "303",
      name: "ReturningViewer",
      reason: "Repeated spam",
      expiresAt: "",
    },
  ];
  let settings = {
    slowMode: true,
    slowSeconds: 30,
    followersOnly: false,
    followerMinutes: 0,
    subscribersOnly: false,
    emoteOnly: false,
    uniqueChat: false,
  };
  const gateway: ModerationGateway = {
    async channels() {
      return { kind: "success", value: [channel] };
    },
    async verify() {
      return { kind: "success", value: role };
    },
    async settings() {
      return { kind: "success", value: settings };
    },
    async banned() {
      return { kind: "success", value: { users: banned, cursor: null } };
    },
    async review(_channel, tool) {
      return {
        kind: "success",
        value: {
          tool,
          items: tool === "unban-requests" ? appeals : members[tool],
          cursor: null,
        },
      };
    },
    async execute(_channel, command) {
      if (denied)
        return {
          kind: "failure",
          reason: "permission",
          detail:
            "Twitch returned 403. Your moderation role was revoked. No action was confirmed.",
        };
      if (command.kind === "unban")
        banned = banned.filter((user) => user.id !== command.userId);
      if (command.kind === "chat-settings") settings = command.settings;
      if (command.kind === "membership")
        members[command.group] =
          command.operation === "add"
            ? [
                ...members[command.group],
                {
                  kind: "member",
                  userId: command.userId,
                  name: `User ${command.userId}`,
                },
              ]
            : members[command.group].filter(
                (item) => item.userId !== command.userId,
              );
      if (command.kind === "resolve-unban") {
        const index = appeals.findIndex(
          (item) => item.kind === "unban" && item.id === command.requestId,
        );
        if (index >= 0) appeals.splice(index, 1);
      }
      return { kind: "success", value: undefined };
    },
  };
  return {
    channel,
    controller: createModerationController({ access, gateway }),
  };
}
function ModerationExample({
  platform = "twitch",
  role = "broadcaster",
  actions = false,
  denied = false,
}: {
  readonly platform?: Platform;
  readonly role?: "broadcaster" | "moderator";
  readonly actions?: boolean;
  readonly denied?: boolean;
}) {
  const [notice, setNotice] = useState("");
  const runtime = useMemo(
    () => createStoryRuntime({ platform, role, denied }),
    [platform, role, denied],
  );
  useEffect(() => () => runtime.controller.dispose(), [runtime]);
  return (
    <View style={{ flex: 1 }}>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={mobileType.body}>
          {notice}
        </Text>
      ) : null}
      <ModWorkspace
        controller={runtime.controller}
        initialChannel={runtime.channel}
        initialPlatform={platform}
        {...(actions ? { initialUserId: "303" } : {})}
        onOpenChannel={(channel) => setNotice(`Watch handoff: ${channel.name}`)}
        onOpenProvider={(channel, provider) =>
          setNotice(
            `Provider handoff: ${provider}${channel ? `/${channel.login}` : ""}`,
          )
        }
        onOpenEngagement={(channel) =>
          setNotice(`Engagement handoff: ${channel.name}`)
        }
        onRequestScopes={(_platform, scopes) =>
          setNotice(`Account consent requested: ${scopes.join(", ")}`)
        }
      />
    </View>
  );
}
const meta = {
  title: "Android/Workflows/Moderation",
  component: ModerationExample,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Production ModWorkspace and domain controller with deterministic provider ports. Fixture roles and action responses are confined to this Storybook story. Production uses authenticated official APIs and re-verifies permissions before submission.",
      },
    },
  },
} satisfies Meta<typeof ModerationExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Broadcaster: Story = {};
export const Moderator: Story = { args: { role: "moderator" } };
export const UserActions: Story = { args: { actions: true } };
export const ProviderDenied: Story = { args: { actions: true, denied: true } };
export const KickBroadcaster: Story = { args: { platform: "kick" } };
