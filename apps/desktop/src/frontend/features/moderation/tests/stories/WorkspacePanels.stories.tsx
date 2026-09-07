import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect, useState } from "react";
import { expect, within } from "storybook/test";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import type { ModerationFeedEvent } from "@shared/moderation-types";
import { ActivityFeedPanel } from "../../components/panels/ActivityFeedPanel";
import { SuspiciousActivityPanel } from "../../components/panels/SuspiciousActivityPanel";
import { WhispersPanel } from "../../components/panels/WhispersPanel";
import { CommunityPanel } from "../../components/panels/CommunityPanel";
import { RewardRequestsPanel } from "../../components/panels/RewardRequestsPanel";

type Panel = "activity" | "suspicious" | "whispers" | "community" | "rewards";
type FixtureState = "ready" | "permission" | "error" | "loading" | "empty";
const panels = {
  activity: ActivityFeedPanel,
  suspicious: SuspiciousActivityPanel,
  whispers: WhispersPanel,
  community: CommunityPanel,
  rewards: RewardRequestsPanel,
};
const user = {
  id: "100",
  login: "fixture_owner",
  displayName: "Fixture Owner",
  profileImageUrl: "",
  createdAt: "2026-01-01",
  broadcasterType: "" as const,
};
const identity = { id: "300", login: "orbit_owl", displayName: "Orbit Owl" };
const stamp = new Date().toISOString();
const redemption = {
  redemptionId: "redemption-1",
  rewardId: "reward-1",
  rewardTitle: "Read a poem",
  cost: 400,
  user: identity,
  input: "A poem about the stars, please.",
  status: "unfulfilled",
  redeemedAt: stamp,
} as const;

function WorkspacePanelFixture({ panel, state }: { panel: Panel; state: FixtureState }) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const previous = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const original = window.electronAPI;
    const previousAuth = useAuthStore.getState();
    const events = new Set<Parameters<typeof original.twitch.eventSub.onEvent>[0]>();
    const states = new Set<Parameters<typeof original.twitch.eventSub.onState>[0]>();
    const failure = {
      ok: false,
      error: { code: "unavailable", message: "Twitch is unavailable in this error fixture." },
    } as const;
    const fixture: typeof original = {
      ...original,
      openExternal: async () => undefined,
      auth: {
        ...original.auth,
        tokenStatus: async () =>
          state === "loading"
            ? new Promise(() => undefined)
            : {
                platform: "twitch",
                connected: true,
                valid: state !== "permission",
                userId: "100",
                scopes: [
                  "moderator:read:followers",
                  "channel:read:subscriptions",
                  "bits:read",
                  "moderator:read:suspicious_users",
                  "moderator:manage:suspicious_users",
                  "user:read:whispers",
                  "moderator:read:chatters",
                  "moderation:read",
                  "channel:manage:redemptions",
                ],
              },
      },
      twitch: {
        ...original.twitch,
        execute: async (command) => {
          if (state === "error") return failure;
          if (command.operation === "get-chatters")
            return {
              ok: true,
              data: {
                items:
                  state === "empty"
                    ? []
                    : [identity, { id: "301", login: "lumen_lark", displayName: "Lumen Lark" }],
                cursor: null,
                total: 2,
                observedAt: stamp,
              },
            };
          if (command.operation === "get-active-moderators")
            return {
              ok: true,
              data: {
                items: state === "empty" ? [] : [identity],
                cursor: null,
                total: 2,
                observedAt: stamp,
                coverage: "chatters-page",
                rosterComplete: false,
              },
            };
          if (command.operation === "get-manageable-rewards")
            return {
              ok: true,
              data: {
                items:
                  state === "empty" ? [] : [{ id: "reward-1", title: "Read a poem", cost: 400 }],
              },
            };
          if (command.operation === "get-reward-redemptions")
            return {
              ok: true,
              data: { items: state === "empty" ? [] : [redemption], cursor: null },
            };
          return { ok: true, data: null };
        },
        eventSub: {
          onEvent: (callback) => {
            events.add(callback);
            return () => {
              events.delete(callback);
            };
          },
          onState: (callback) => {
            states.add(callback);
            return () => {
              states.delete(callback);
            };
          },
          stop: async () => true,
          start: async ({ feedId }) => {
            if (state === "error") return failure;
            states.forEach((callback) => callback({ feedId, state: "connected" }));
            if (state !== "empty") {
              const base = {
                id: "fixture-event",
                accountId: "100",
                channelId: "100",
                occurredAt: stamp,
                coverageStartedAt: stamp,
              };
              const payload: ModerationFeedEvent =
                panel === "suspicious"
                  ? {
                      ...base,
                      kind: "suspicious-message",
                      user: identity,
                      status: "active_monitoring",
                      message: "A held message from a monitored account.",
                      messageId: "message-1",
                    }
                  : panel === "whispers"
                    ? {
                        ...base,
                        kind: "whisper",
                        from: identity,
                        to: { id: "100", login: user.login, displayName: user.displayName },
                        message: "Thanks for helping with chat today.",
                      }
                    : panel === "rewards"
                      ? { ...base, ...redemption, kind: "reward" }
                      : {
                          ...base,
                          kind: "activity",
                          action: "subscription-gift",
                          user: identity,
                          count: 5,
                          message: "",
                        };
              events.forEach((callback) => callback({ feedId, payload }));
            }
            return { ok: true, data: null };
          },
        },
      },
    };
    Object.defineProperty(window, "electronAPI", { configurable: true, value: fixture });
    useAuthStore.setState({ twitchUser: user, twitchConnected: true });
    setReady(true);
    return () => {
      events.clear();
      states.clear();
      useAuthStore.setState(previousAuth, true);
      if (previous) Object.defineProperty(window, "electronAPI", previous);
    };
  }, [panel, state]);
  const Panel = panels[panel];
  return (
    <div className="h-[560px] w-[400px] bg-[#18181b] text-white">
      {ready && <Panel key={`${panel}:${state}`} channelId="100" channelName="fixture_owner" />}
    </div>
  );
}

const meta = {
  title: "Pages/Moderation/Workspace/NewPanels",
  component: WorkspacePanelFixture,
  args: { panel: "activity", state: "ready" },
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Deterministic local fixtures. Every read, feed, external link and moderation action is intercepted; these stories never contact Twitch or mutate a live channel.",
      },
    },
  },
} satisfies Meta<typeof WorkspacePanelFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Activity: Story = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Orbit Owl")).toBeInTheDocument();
  },
};
export const Suspicious: Story = {
  args: { panel: "suspicious" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("button", { name: "Restrict user" })
    ).toBeInTheDocument();
  },
};
export const Whispers: Story = { args: { panel: "whispers" } };
export const Community: Story = { args: { panel: "community" } };
export const Rewards: Story = {
  args: { panel: "rewards" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("button", { name: "Fulfill request" })
    ).toBeInTheDocument();
  },
};
export const Permission: Story = {
  args: { panel: "suspicious", state: "permission" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("button", { name: "Reconnect Twitch" })
    ).toBeInTheDocument();
  },
};
export const Error: Story = {
  args: { state: "error" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Twitch is unavailable in this error fixture.")
    ).toBeInTheDocument();
  },
};
export const Loading: Story = { args: { state: "loading" } };
export const Empty: Story = { args: { state: "empty" } };
