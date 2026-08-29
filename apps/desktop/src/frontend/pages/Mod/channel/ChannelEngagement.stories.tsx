import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useLayoutEffect } from "react";
import { expect, within } from "storybook/test";

import type { ElectronAPI } from "@backend/preload";
import type { TwitchApiResult, TwitchPoll, TwitchPrediction } from "@shared/twitch-api-types";

import { ChannelEngagement } from "./ChannelEngagement";

type EngagementState = "loading" | "empty" | "populated" | "locked" | "unavailable";

const STORY_BROADCASTER_ID = "story-twitch-channel";
const storybookElectronApi = window.electronAPI;

const activePrediction = {
  id: "prediction-story-1",
  title: "Will NovaArcade complete the run?",
  status: "ACTIVE",
  outcomes: [
    { id: "prediction-outcome-yes", title: "Finish", users: 148, channel_points: 72_500 },
    { id: "prediction-outcome-no", title: "Reset", users: 86, channel_points: 41_200 },
  ],
  prediction_window: 300,
  created_at: "2026-08-10T18:00:00.000Z",
  ended_at: null,
  locked_at: null,
  winning_outcome_id: null,
} satisfies TwitchPrediction;

const lockedPrediction = {
  ...activePrediction,
  id: "prediction-story-locked",
  title: "Can the final boss be defeated?",
  status: "LOCKED",
  locked_at: "2026-08-10T18:05:00.000Z",
} satisfies TwitchPrediction;

const activePoll = {
  id: "poll-story-1",
  title: "Which route next?",
  choices: [
    { id: "poll-choice-safe", title: "Safe route", votes: 1_248 },
    { id: "poll-choice-risky", title: "Risky shortcut", votes: 936 },
  ],
  status: "ACTIVE",
  duration: 120,
  started_at: "2026-08-10T18:02:00.000Z",
  ended_at: null,
} satisfies TwitchPoll;

const unavailableResult: TwitchApiResult = {
  ok: false,
  kind: "unavailable",
  error: {
    code: "unavailable",
    message: "Twitch engagement data is unavailable in this fixture.",
  },
};

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function createEngagementBridge(state: EngagementState): ElectronAPI["twitch"] {
  return {
    execute: async (command) => {
      if (state === "loading") return neverResolves();
      if (state === "unavailable") return unavailableResult;

      const prediction =
        state === "populated" ? activePrediction : state === "locked" ? lockedPrediction : null;
      const poll = state === "populated" ? activePoll : null;

      return {
        ok: true,
        data: {
          data:
            command.operation === "get-predictions"
              ? prediction
                ? [prediction]
                : []
              : poll
                ? [poll]
                : [],
        },
      };
    },
    eventSub: storybookElectronApi.twitch.eventSub,
  };
}

function EngagementBridgeProvider({
  children,
  state,
}: {
  children: ReactNode;
  state: EngagementState;
}) {
  useLayoutEffect(() => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const electronApi = Object.create(storybookElectronApi) as ElectronAPI;
    Object.defineProperty(electronApi, "twitch", {
      configurable: true,
      value: createEngagementBridge(state),
    });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: electronApi,
    });

    return () => {
      if (previousDescriptor) {
        Object.defineProperty(window, "electronAPI", previousDescriptor);
      } else {
        Reflect.deleteProperty(window, "electronAPI");
      }
    };
  }, [state]);

  return children;
}

function ChannelEngagementStoryCanvas({ state }: { state: EngagementState }) {
  return (
    <EngagementBridgeProvider state={state}>
      <div className="min-h-[360px] min-w-[620px] bg-[var(--color-background)] p-6">
        <ChannelEngagement broadcasterId={STORY_BROADCASTER_ID} />
      </div>
    </EngagementBridgeProvider>
  );
}

const meta = {
  title: "Pages/Moderation/Channel/ChannelEngagement",
  component: ChannelEngagement,
  args: {
    broadcasterId: STORY_BROADCASTER_ID,
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Active Twitch prediction and poll states with a local Electron bridge fixture. These stories use fixed moderation data and never call platform APIs or live IPC.",
      },
    },
  },
} satisfies Meta<typeof ChannelEngagement>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  render: () => <ChannelEngagementStoryCanvas state="loading" />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Loading…")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  render: () => <ChannelEngagementStoryCanvas state="empty" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByTestId("channel-engagement-empty")
    ).toBeInTheDocument();
  },
};

export const Populated: Story = {
  render: () => <ChannelEngagementStoryCanvas state="populated" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("channel-engagement-prediction")).toBeInTheDocument();
    await expect(canvas.getByText("Will NovaArcade complete the run?")).toBeInTheDocument();
    await expect(canvas.getByTestId("channel-engagement-poll")).toBeInTheDocument();
    await expect(canvas.getByText("Which route next?")).toBeInTheDocument();
  },
};

export const LockedPrediction: Story = {
  render: () => <ChannelEngagementStoryCanvas state="locked" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Prediction · LOCKED")).toBeInTheDocument();
    await expect(canvas.getByText("Can the final boss be defeated?")).toBeInTheDocument();
  },
};

export const UnavailableFallsBackToEmpty: Story = {
  render: () => <ChannelEngagementStoryCanvas state="unavailable" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByTestId("channel-engagement-empty")
    ).toBeInTheDocument();
  },
};
