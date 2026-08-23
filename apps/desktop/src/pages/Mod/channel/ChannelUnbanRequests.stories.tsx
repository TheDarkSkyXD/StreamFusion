import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect, useLayoutEffect } from "react";
import { expect, userEvent, within } from "storybook/test";
import { toast } from "sonner";

import { ToastRoot } from "@/components/ToastRoot";
import type { ElectronAPI } from "@/preload";
import type { TwitchUser } from "@/shared/auth-types";
import type { TwitchApiResult, TwitchUnbanRequest } from "@/shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";

import { ChannelUnbanRequests } from "./ChannelUnbanRequests";

type UnbanRequestsState =
  | "loading"
  | "empty"
  | "populated"
  | "load-error"
  | "permission-denied"
  | "signed-out"
  | "resolving"
  | "resolution-denied";

const STORY_BROADCASTER_ID = "story-twitch-channel";
const storybookElectronApi = window.electronAPI;

const storyModerator = {
  id: "story-moderator",
  login: "storymoderator",
  displayName: "Story Moderator",
  profileImageUrl: "",
  createdAt: "2024-01-01T00:00:00.000Z",
  broadcasterType: "",
} satisfies TwitchUser;

const pendingRequests = [
  {
    id: "request-story-accepted",
    broadcaster_id: STORY_BROADCASTER_ID,
    broadcaster_login: "novaarcade",
    broadcaster_name: "NovaArcade",
    moderator_id: null,
    moderator_login: null,
    moderator_name: null,
    user_id: "requester-lumen",
    user_login: "lumenrunner",
    user_name: "Lumen Runner",
    text: "I understand the chat rule now and would appreciate another chance.",
    status: "pending",
    created_at: "2026-08-10T18:05:00.000Z",
    resolved_at: null,
    resolution_text: null,
  },
  {
    id: "request-story-denied",
    broadcaster_id: STORY_BROADCASTER_ID,
    broadcaster_login: "novaarcade",
    broadcaster_name: "NovaArcade",
    moderator_id: null,
    moderator_login: null,
    moderator_name: null,
    user_id: "requester-orbit",
    user_login: "orbitline",
    user_name: "Orbit Line",
    text: "Please review my ban appeal.",
    status: "pending",
    created_at: "2026-08-10T18:12:00.000Z",
    resolved_at: null,
    resolution_text: null,
  },
] satisfies TwitchUnbanRequest[];

const unavailableResult: TwitchApiResult = {
  ok: false,
  kind: "unavailable",
  error: {
    code: "unavailable",
    message: "The moderation service is unavailable in this fixture.",
  },
};

const missingReadPermissionResult: TwitchApiResult = {
  ok: false,
  kind: "unauthorized",
  error: {
    code: "unauthorized",
    message: "Missing scope: moderator:read:unban_requests",
  },
};

const missingManagePermissionResult: TwitchApiResult = {
  ok: false,
  kind: "unauthorized",
  error: {
    code: "unauthorized",
    message: "Missing scope: moderator:manage:unban_requests",
  },
};

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function createUnbanRequestsBridge(state: UnbanRequestsState): ElectronAPI["twitch"] {
  return {
    execute: async (command) => {
      if (command.operation === "get-unban-requests") {
        if (state === "loading") return neverResolves();
        if (state === "load-error") return unavailableResult;
        if (state === "permission-denied") return missingReadPermissionResult;

        return {
          ok: true,
          data: { data: state === "empty" ? [] : pendingRequests },
        };
      }

      if (command.operation === "resolve-unban-request") {
        if (state === "resolving") return neverResolves();
        if (state === "resolution-denied") return missingManagePermissionResult;
      }

      return { ok: true, data: undefined };
    },
    eventSub: storybookElectronApi.twitch.eventSub,
  };
}

function UnbanRequestsFixtureProvider({
  children,
  state,
}: {
  children: ReactNode;
  state: UnbanRequestsState;
}) {
  useLayoutEffect(() => {
    const previousBridge = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const previousAuth = useAuthStore.getState();
    const electronApi = Object.create(storybookElectronApi) as ElectronAPI;

    Object.defineProperty(electronApi, "twitch", {
      configurable: true,
      value: createUnbanRequestsBridge(state),
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
      useAuthStore.setState(previousAuth);
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

function ChannelUnbanRequestsStoryCanvas({ state }: { state: UnbanRequestsState }) {
  return (
    <UnbanRequestsFixtureProvider state={state}>
      <div className="min-h-[420px] min-w-[680px] bg-[var(--color-background)] p-6">
        <ChannelUnbanRequests broadcasterId={STORY_BROADCASTER_ID} />
      </div>
      <ToastRoot />
    </UnbanRequestsFixtureProvider>
  );
}

const meta = {
  title: "Pages/Moderation/Channel/ChannelUnbanRequests",
  component: ChannelUnbanRequests,
  args: { broadcasterId: "story-broadcaster" },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Twitch unban-request review states with deterministic auth and Electron bridge fixtures. Stories use no platform APIs or live IPC.",
      },
    },
  },
} satisfies Meta<typeof ChannelUnbanRequests>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  render: () => <ChannelUnbanRequestsStoryCanvas state="loading" />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/Loading/)).toBeInTheDocument();
  },
};

export const Empty: Story = {
  render: () => <ChannelUnbanRequestsStoryCanvas state="empty" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("No pending unban requests.")
    ).toBeInTheDocument();
  },
};

export const Populated: Story = {
  render: () => <ChannelUnbanRequestsStoryCanvas state="populated" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("channel-unban-requests-results")).toBeInTheDocument();
    await expect(canvas.getByText("Lumen Runner")).toBeInTheDocument();
    await expect(canvas.getByText("Orbit Line")).toBeInTheDocument();
  },
};

export const LoadError: Story = {
  render: () => <ChannelUnbanRequestsStoryCanvas state="load-error" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(
        /The moderation service is unavailable in this fixture/
      )
    ).toBeInTheDocument();
  },
};

export const MissingReviewPermission: Story = {
  render: () => <ChannelUnbanRequestsStoryCanvas state="permission-denied" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/Missing scope: moderator:read:unban_requests/)
    ).toBeInTheDocument();
  },
};

export const SignedOut: Story = {
  render: () => <ChannelUnbanRequestsStoryCanvas state="signed-out" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("No pending unban requests.")
    ).toBeInTheDocument();
  },
};

export const ResolvingApproval: Story = {
  render: () => <ChannelUnbanRequestsStoryCanvas state="resolving" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const requestId = pendingRequests[0].id;

    await userEvent.click(await canvas.findByTestId(`unban-approve-button-${requestId}`));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Resolution text" }),
      "Appeal accepted"
    );
    await userEvent.click(canvas.getByTestId(`unban-confirm-approved-${requestId}`));

    await expect(canvas.getByRole("button", { name: /Working/ })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeDisabled();
  },
};

export const MissingManagePermission: Story = {
  render: () => <ChannelUnbanRequestsStoryCanvas state="resolution-denied" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const requestId = pendingRequests[1].id;

    await userEvent.click(await canvas.findByTestId(`unban-deny-button-${requestId}`));
    await userEvent.click(canvas.getByTestId(`unban-confirm-denied-${requestId}`));

    await expect(
      await canvas.findByText(/Missing scope: moderator:manage:unban_requests/)
    ).toBeInTheDocument();
  },
};
