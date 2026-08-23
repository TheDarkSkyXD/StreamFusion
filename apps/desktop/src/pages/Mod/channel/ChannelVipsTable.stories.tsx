import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, userEvent, within } from "storybook/test";
import { toast } from "sonner";

import { ToastRoot } from "@/components/ToastRoot";
import type { ElectronAPI } from "@/preload";
import type { TwitchUser } from "@/shared/auth-types";
import type { TwitchApiResult, TwitchChannelMember } from "@/shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";

import { ChannelVipsTable } from "./ChannelVipsTable";

type VipsState =
  | "loading"
  | "empty"
  | "populated"
  | "error"
  | "adding"
  | "removing"
  | "add-success"
  | "permission-denied";
type VipsStoryArgs = ComponentProps<typeof ChannelVipsTable> & {
  fixtureState: VipsState;
  signedIn: boolean;
};

const STORY_BROADCASTER_ID = "story-twitch-channel";
const storybookElectronApi = window.electronAPI;

const broadcaster: TwitchUser = {
  id: STORY_BROADCASTER_ID,
  login: "novaarcade",
  displayName: "NovaArcade",
  profileImageUrl: "",
  createdAt: "2026-08-10T12:00:00.000Z",
  broadcasterType: "partner",
};

const vipEntries = [
  { user_id: "vip-story-1", user_login: "lumen_lark", user_name: "Lumen Lark" },
  { user_id: "vip-story-2", user_login: "pixel_piper", user_name: "Pixel Piper" },
] satisfies TwitchChannelMember[];

const loadError: TwitchApiResult = {
  ok: false,
  kind: "unavailable",
  error: {
    code: "unavailable",
    message: "VIP roster data is unavailable in this fixture.",
  },
};

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function createVipsBridge(state: VipsState): ElectronAPI["twitch"] {
  return {
    execute: async (command) => {
      if (command.operation === "get-vips") {
        if (state === "loading") return neverResolves();
        if (state === "error") return loadError;

        return {
          ok: true,
          data:
            state === "populated" || state === "removing"
              ? { data: vipEntries, pagination: { cursor: "story-next-page" } }
              : { data: [], pagination: {} },
        };
      }

      if (command.operation === "resolve-channel") {
        if (state === "adding") return neverResolves();
        return {
          ok: true,
          data: {
            id: "vip-story-new",
            login: "orbit_owl",
            displayName: "Orbit Owl",
          },
        };
      }

      if (command.operation === "add-vip") {
        if (state === "permission-denied") {
          return {
            ok: false,
            kind: "unauthorized",
            error: {
              code: "unauthorized",
              message: "You do not have permission to manage VIPs for this channel.",
            },
          };
        }
        return { ok: true, data: null };
      }
      if (command.operation === "remove-vip") {
        if (state === "removing") return neverResolves();
        return { ok: true, data: null };
      }

      return { ok: true, data: null };
    },
    eventSub: storybookElectronApi.twitch.eventSub,
  };
}

function installVipsBridge(state: VipsState): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const electronApi = Object.create(storybookElectronApi) as ElectronAPI;
  Object.defineProperty(electronApi, "twitch", {
    configurable: true,
    value: createVipsBridge(state),
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
}

function installVipsFixtures(state: VipsState, signedIn: boolean): () => void {
  const previousAuthState = useAuthStore.getState();
  useAuthStore.setState({
    twitchUser: signedIn ? broadcaster : null,
    twitchConnected: signedIn,
    twitchReconnectRequired: false,
    isGuest: !signedIn,
  });
  const restoreBridge = installVipsBridge(state);

  return () => {
    toast.dismiss();
    restoreBridge();
    useAuthStore.setState(previousAuthState, true);
  };
}

function ChannelVipsTableStoryCanvas({ broadcasterId }: { broadcasterId: string }) {
  return (
    <>
      <div className="min-h-[340px] min-w-[620px] bg-[var(--color-background)] p-6">
        <ChannelVipsTable broadcasterId={broadcasterId} />
      </div>
      <ToastRoot />
    </>
  );
}

const meta = {
  title: "Pages/Moderation/Channel/ChannelVipsTable",
  component: ChannelVipsTable,
  args: {
    broadcasterId: STORY_BROADCASTER_ID,
    fixtureState: "loading",
    signedIn: true,
  },
  beforeEach: ({ args }) => installVipsFixtures(args.fixtureState, args.signedIn),
  render: ({ broadcasterId }) => <ChannelVipsTableStoryCanvas broadcasterId={broadcasterId} />,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Twitch broadcaster VIP roster states using fixed auth and Electron bridge fixtures. The table does not use React Query directly; Storybook supplies its deterministic global query client. No story calls platform APIs or live IPC.",
      },
    },
  },
} satisfies Meta<VipsStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: { fixtureState: "loading" },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Loading\u2026")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { fixtureState: "empty" },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No VIPs yet.")).toBeInTheDocument();
  },
};

export const Populated: Story = {
  args: { fixtureState: "populated" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("vip-row-vip-story-1")).toBeInTheDocument();
    await expect(canvas.getByText("Pixel Piper")).toBeInTheDocument();
    await expect(canvas.getByText("Showing first 100 VIPs.")).toBeInTheDocument();
  },
};

export const LoadError: Story = {
  args: { fixtureState: "error" },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("channel-vips-error")).toHaveTextContent(
      "VIP roster data is unavailable in this fixture."
    );
  },
};

export const AddInProgress: Story = {
  args: { fixtureState: "adding" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("textbox", { name: "Add VIP by username" });
    await userEvent.type(input, "orbit_owl");
    await userEvent.click(canvas.getByRole("button", { name: "Add" }));
    await expect(canvas.getByRole("button", { name: "Adding\u2026" })).toBeDisabled();
  },
};

export const RemoveInProgress: Story = {
  args: { fixtureState: "removing" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("vip-row-vip-story-1");
    await userEvent.click(canvas.getByTestId("remove-vip-button-vip-story-1"));
    await expect(canvas.getByRole("button", { name: "Removing\u2026" })).toBeDisabled();
  },
};

export const AddedVip: Story = {
  args: { fixtureState: "add-success" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("textbox", { name: "Add VIP by username" });
    await userEvent.type(input, "orbit_owl");
    await userEvent.click(canvas.getByRole("button", { name: "Add" }));
    await expect(await canvas.findByTestId("vip-row-vip-story-new")).toBeInTheDocument();
    await expect(input).toHaveValue("");
  },
};

export const PermissionDenied: Story = {
  args: { fixtureState: "permission-denied" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("textbox", { name: "Add VIP by username" });
    await userEvent.type(input, "orbit_owl");
    await userEvent.click(canvas.getByRole("button", { name: "Add" }));
    await expect(
      await within(document.body).findByText(
        "You do not have permission to manage VIPs for this channel."
      )
    ).toBeInTheDocument();
  },
};

export const UnauthenticatedAddIsBlocked: Story = {
  args: { fixtureState: "empty", signedIn: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("textbox", { name: "Add VIP by username" });
    await userEvent.type(input, "guest_vip");
    await userEvent.click(canvas.getByRole("button", { name: "Add" }));
    await expect(canvas.getByRole("button", { name: "Add" })).toBeEnabled();
    await expect(input).toHaveValue("guest_vip");
  },
};
