import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type { Platform } from "@streamfusion/core/platform";
import { MobileButton } from "@mobile/design/button";
import { mobileType } from "@mobile/design/tokens";
import type { ModerationChannel } from "@mobile/features/moderation/capabilities/moderation";
import type {
  ChannelPoll,
  ChannelPrediction,
  EngagementGateway,
} from "../capabilities/engagement";
import { createEngagementController } from "../domain/engagement-controller";
import { EngagementSheet } from "./engagement-sheet";

function createStoryRuntime({
  platform,
  viewer,
  empty,
  denied,
}: {
  readonly platform: Platform;
  readonly viewer: boolean;
  readonly empty: boolean;
  readonly denied: boolean;
}) {
  const channel: ModerationChannel = {
    platform,
    id: "101",
    login: "theater",
    name: "Theater",
  };
  const access: AuthenticatedPlatformAccess = {
    subscribe: () => () => undefined,
    async read(provider) {
      return {
        kind: "ready",
        platform: provider,
        accessToken: "storybook-fixture",
        clientId: "storybook",
        userId: viewer ? "202" : channel.id,
        username: viewer ? "viewer" : channel.login,
        generation: 1,
        scopes: [],
      };
    },
  };
  let polls: ChannelPoll[] = empty
    ? []
    : [
        {
          id: "poll-1",
          title: "Next game?",
          status: "ACTIVE",
          choices: [
            { id: "chess", title: "Chess", votes: 54 },
            { id: "go", title: "Go", votes: 31 },
          ],
        },
      ];
  let predictions: ChannelPrediction[] = empty
    ? []
    : [
        {
          id: "prediction-1",
          title: "Will we win this round?",
          status: "ACTIVE",
          winningOutcomeId: null,
          outcomes: [
            { id: "yes", title: "Yes", votes: 42 },
            { id: "no", title: "No", votes: 18 },
          ],
        },
      ];
  const gateway: EngagementGateway = {
    async polls() {
      return { kind: "success", value: polls };
    },
    async predictions() {
      return { kind: "success", value: predictions };
    },
    async execute(_channel, command) {
      if (denied)
        return {
          kind: "failure",
          reason: "permission",
          detail:
            "Twitch returned 403. This account does not have permission. No result was applied.",
        };
      if (command.kind === "create-poll") {
        const poll: ChannelPoll = {
          id: "created-poll",
          title: command.title,
          status: "ACTIVE",
          choices: command.choices.map((title, index) => ({
            id: `choice-${index}`,
            title,
            votes: 0,
          })),
        };
        polls = [poll, ...polls];
        return { kind: "success", value: { kind: "poll", poll } };
      }
      if (command.kind === "end-poll") {
        const original = polls.find((poll) => poll.id === command.id);
        if (!original)
          return {
            kind: "failure",
            reason: "invalid",
            detail: "Poll not found",
          };
        const poll: ChannelPoll = {
          ...original,
          status: command.archive ? "ARCHIVED" : "TERMINATED",
        };
        polls = polls.map((entry) => (entry.id === poll.id ? poll : entry));
        return { kind: "success", value: { kind: "poll", poll } };
      }
      if (command.kind === "create-prediction") {
        const prediction: ChannelPrediction = {
          id: "created-prediction",
          title: command.title,
          status: "ACTIVE",
          winningOutcomeId: null,
          outcomes: command.outcomes.map((title, index) => ({
            id: `outcome-${index}`,
            title,
            votes: 0,
          })),
        };
        predictions = [prediction, ...predictions];
        return { kind: "success", value: { kind: "prediction", prediction } };
      }
      const original = predictions.find(
        (prediction) => prediction.id === command.id,
      );
      if (!original)
        return {
          kind: "failure",
          reason: "invalid",
          detail: "Prediction not found",
        };
      const prediction: ChannelPrediction = {
        ...original,
        status:
          command.kind === "lock-prediction"
            ? "LOCKED"
            : command.kind === "cancel-prediction"
              ? "CANCELED"
              : "RESOLVED",
        winningOutcomeId:
          command.kind === "resolve-prediction"
            ? command.winningOutcomeId
            : null,
      };
      predictions = predictions.map((entry) =>
        entry.id === prediction.id ? prediction : entry,
      );
      return { kind: "success", value: { kind: "prediction", prediction } };
    },
  };
  return {
    channel,
    controller: createEngagementController({ access, gateway }),
  };
}
function EngagementExample({
  platform = "twitch",
  viewer = false,
  empty = false,
  denied = false,
}: {
  readonly platform?: Platform;
  readonly viewer?: boolean;
  readonly empty?: boolean;
  readonly denied?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  const [notice, setNotice] = useState("");
  const runtime = useMemo(
    () => createStoryRuntime({ platform, viewer, empty, denied }),
    [platform, viewer, empty, denied],
  );
  useEffect(() => () => runtime.controller.dispose(), [runtime]);
  return (
    <View style={{ flex: 1 }}>
      <MobileButton
        accessibilityLabel="Open engagement sheet"
        onPress={() => setVisible(true)}
        testID="story-engagement-open"
        variant="secondary"
      >
        Open engagement
      </MobileButton>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={mobileType.body}>
          {notice}
        </Text>
      ) : null}
      <EngagementSheet
        channel={runtime.channel}
        controller={runtime.controller}
        visible={visible}
        onDismiss={() => setVisible(false)}
        onOpenProvider={(channel) => {
          setVisible(false);
          setNotice(`Provider handoff: ${channel.platform}/${channel.login}`);
        }}
        onRequestScopes={(_platform, scopes) =>
          setNotice(`Account consent requested: ${scopes.join(", ")}`)
        }
      />
    </View>
  );
}
const meta = {
  title: "Android/Workflows/Engagement",
  component: EngagementExample,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Production EngagementSheet and controller with deterministic provider ports. Creation, confirmation, lock, winner resolution, cancellation, denial, and provider handoff are interactive. Story fixtures do not call providers or mutate real Channel Points.",
      },
    },
  },
} satisfies Meta<typeof EngagementExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Broadcaster: Story = {};
export const Creation: Story = { args: { empty: true } };
export const ProviderDenied: Story = { args: { denied: true } };
export const TwitchViewer: Story = { args: { viewer: true } };
export const KickHandoff: Story = { args: { platform: "kick" } };
