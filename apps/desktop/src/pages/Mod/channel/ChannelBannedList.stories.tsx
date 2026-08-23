import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect, useLayoutEffect } from "react";
import { expect, userEvent, within } from "storybook/test";
import { toast } from "sonner";

import { ToastRoot } from "@/components/ToastRoot";
import type { ElectronAPI } from "@/preload";
import type { TwitchUser } from "@/shared/auth-types";
import type { TwitchApiResult, TwitchBannedUser } from "@/shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";

import { ChannelBannedList } from "./ChannelBannedList";

type BannedListState =
  | "loading"
  | "empty"
  | "populated"
  | "load-error"
  | "permission-denied"
  | "signed-out"
  | "unbanning"
  | "unban-success"
  | "unban-permission-denied";

const STORY_BROADCASTER_ID = "story-twitch-channel";
const storybookElectronApi = window.electronAPI;

const storyModerator = {
  id: "story-moderator",
  login: "storymoderator",
  displayName: "Story Moderator",
  profileImageUrl: "",
  createdAt: "2026-08-10T12:00:00.000Z",
  broadcasterType: "",
} satisfies TwitchUser;

const bannedUsers = [
  {
    user_id: "banned-story-permanent",
    user_login: "orbit_owl",
    user_name: "Orbit Owl",
    expires_at: "",
    created_at: "2026-08-10T17:45:00.000Z",
    reason: "Repeated harassment",
    moderator_id: "story-moderator",
    moderator_login: "storymoderator",
    moderator_name: "Story Moderator",
  },
  {
    user_id: "banned-story-temporary",
    user_login: "lumen_lark",
    user_name: "Lumen Lark",
    expires_at: "2026-08-12T18:00:00.000Z",
    created_at: "2026-08-10T17:50:00.000Z",
    reason: "Spoilers after warning",
    moderator_id: "story-moderator",
    moderator_login: "storymoderator",
    moderator_name: "Story Moderator",
  },
] satisfies TwitchBannedUser[];

const unavailableResult: TwitchApiResult = {
  ok: false,
  kind: "unavailable",
  error: {
    code: "unavailable",
    message: "Banned-user data is unavailable in this fixture.",
  },
};

const missingReadPermissionResult: TwitchApiResult = {
  ok: false,
  kind: "unauthorized",
  error: {
    code: "unauthorized",
    message: "Missing scope: moderator:read:banned_users",
  },
};

const missingManagePermissionResult: TwitchApiResult = {
  ok: false,
  kind: "unauthorized",
  error: {
    code: "unauthorized",
    message: "Missing scope: moderator:manage:banned_users",
  },
};

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function createBannedListBridge(state: BannedListState): ElectronAPI["twitch"] {
  return {
    execute: async (command) => {
      if (command.operation === "get-banned-users") {
        if (state === "loading") return neverResolves();
        if (state === "load-error") return unavailableResult;
        if (state === "permission-denied") return missingReadPermissionResult;

        return {
          ok: true,
          data: {
            data: state === "empty" ? [] : bannedUsers,
          },
        };
      }

      if (command.operation === "unban-user") {
        if (state === "unbanning") return neverResolves();
        if (state === "unban-permission-denied") return missingManagePermissionResult;
        return { ok: true, data: null };
      }

      return { ok: true, data: null };
    },
    eventSub: storybookElectronApi.twitch.eventSub,
  };
}

function BannedListFixtureProvider({
  children,
  state,
}: {
  children: ReactNode;
  state: BannedListState;
}) {
  useLayoutEffect(() => {
    const previousBridge = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const previousAuth = useAuthStore.getState();
    const electronApi = Object.create(storybookElectronApi) as ElectronAPI;

    Object.defineProperty(electronApi, "twitch", {
      configurable: true,
      value: createBannedListBridge(state),
    });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: electronApi,
    });
    useAuthStore.setState({
      twitchUser: state === "signed-out" ? null : storyModerator,
      twitchConnected: state !== "signed-out",
      isGuest: state === "signed-out",
    });

    return () => {
      useAuthStore.setState(previousAuth, true);
      if (previousBridge) {
        Object.defineProperty(window, "electronAPI", previousBridge);
      } else {
        Reflect.deleteProperty(window, "electronAPI");
      }
    };
  }, [state]);

  useEffect(
    () => () => {
      toast.dismiss();
    },
    []
  );

  return children;
}

function ChannelBannedListStoryCanvas({
  state,
  platform = "twitch",
}: {
  state: BannedListState;
  platform?: "twitch" | "kick";
}) {
  return (
    <BannedListFixtureProvider state={state}>
      <div className="min-h-[360px] min-w-[620px] bg-[var(--color-background)] p-6">
        <ChannelBannedList platform={platform} broadcasterId={STORY_BROADCASTER_ID} />
      </div>
      <ToastRoot />
    </BannedListFixtureProvider>
  );
}

const meta = {
  title: "Pages/Moderation/Channel/ChannelBannedList",
  component: ChannelBannedList,
  args: { platform: "twitch" },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Twitch banned-user list and inline Unban states using fixed auth and Electron bridge fixtures. The Kick variant documents the platform's supported informational state. These stories never call platform APIs or live IPC.",
      },
    },
  },
} satisfies Meta<typeof ChannelBannedList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  render: () => <ChannelBannedListStoryCanvas state="loading" />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Loading…")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  render: () => <ChannelBannedListStoryCanvas state="empty" />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No banned users.")).toBeInTheDocument();
  },
};

export const Populated: Story = {
  render: () => <ChannelBannedListStoryCanvas state="populated" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("channel-banned-list-results")).toBeInTheDocument();
    await expect(canvas.getByText("orbit_owl")).toBeInTheDocument();
    await expect(canvas.getByText("Permanent")).toBeInTheDocument();
    await expect(canvas.getByText("Repeated harassment")).toBeInTheDocument();
  },
};

export const LoadError: Story = {
  render: () => <ChannelBannedListStoryCanvas state="load-error" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByTestId("channel-banned-list-error")
    ).toHaveTextContent("Banned-user data is unavailable in this fixture.");
  },
};

export const MissingReadPermission: Story = {
  render: () => <ChannelBannedListStoryCanvas state="permission-denied" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByTestId("channel-banned-list-error")
    ).toHaveTextContent("Missing scope: moderator:read:banned_users");
  },
};

export const SignedOut: Story = {
  render: () => <ChannelBannedListStoryCanvas state="signed-out" />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No banned users.")).toBeInTheDocument();
  },
};

export const UnbanInProgress: Story = {
  render: () => <ChannelBannedListStoryCanvas state="unbanning" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("unban-button-banned-story-permanent"));
    await expect(canvas.getByRole("button", { name: "Unbanning…" })).toBeDisabled();
  },
};

export const UnbanSuccess: Story = {
  render: () => <ChannelBannedListStoryCanvas state="unban-success" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("unban-button-banned-story-permanent"));
    await expect(canvas.queryByTestId("banned-row-banned-story-permanent")).not.toBeInTheDocument();
    await expect(await within(document.body).findByText("Unbanned Orbit Owl")).toBeInTheDocument();
  },
};

export const MissingManagePermission: Story = {
  render: () => <ChannelBannedListStoryCanvas state="unban-permission-denied" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByTestId("unban-button-banned-story-permanent");
    await userEvent.click(button);
    await expect(button).toBeEnabled();
    await expect(
      await within(document.body).findByText(/Couldn't unban.*moderator:manage:banned_users/)
    ).toBeInTheDocument();
  },
};

export const KickUnsupported: Story = {
  render: () => <ChannelBannedListStoryCanvas state="empty" platform="kick" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("channel-banned-list-kick")).toBeInTheDocument();
    await expect(
      canvas.getByText("Kick doesn't expose a public banned-users list endpoint.")
    ).toBeInTheDocument();
  },
};
