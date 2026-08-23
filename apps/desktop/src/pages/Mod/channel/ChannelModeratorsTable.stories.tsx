import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, userEvent, within } from "storybook/test";
import { toast } from "sonner";

import { ToastRoot } from "@/components/ToastRoot";
import type { ElectronAPI } from "@/preload";
import type { TwitchUser } from "@/shared/auth-types";
import type { TwitchApiResult, TwitchChannelMember } from "@/shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

import { ChannelModeratorsTable } from "./ChannelModeratorsTable";

type ModeratorsState =
  "loading" | "empty" | "populated" | "error" | "adding" | "removing" | "lookup-error";
type ModeratorsStoryArgs = ComponentProps<typeof ChannelModeratorsTable> & {
  fixtureState: ModeratorsState;
  signedIn: boolean;
};

const STORY_BROADCASTER_ID = "story-twitch-channel";
const storybookElectronApi = window.electronAPI;

const broadcaster = {
  id: STORY_BROADCASTER_ID,
  login: "novaarcade",
  displayName: "NovaArcade",
  profileImageUrl: "",
  createdAt: "2026-08-10T12:00:00.000Z",
  broadcasterType: "partner",
} satisfies TwitchUser;

const moderatorEntries = [
  { user_id: "mod-story-1", user_login: "lumen_lark", user_name: "Lumen Lark" },
  { user_id: "mod-story-2", user_login: "pixel_piper", user_name: "Pixel Piper" },
] satisfies TwitchChannelMember[];

const loadError: TwitchApiResult = {
  ok: false,
  kind: "unavailable",
  error: { code: "unavailable", message: "Moderator roster data is unavailable in this fixture." },
};

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function createModeratorsBridge(state: ModeratorsState): ElectronAPI["twitch"] {
  return {
    execute: async (command) => {
      if (command.operation === "get-moderators") {
        if (state === "loading") return neverResolves();
        if (state === "error") return loadError;
        return {
          ok: true,
          data:
            state === "populated" || state === "removing"
              ? { data: moderatorEntries, pagination: { cursor: "story-next-page" } }
              : { data: [], pagination: {} },
        };
      }

      if (command.operation === "resolve-channel") {
        if (state === "adding") return neverResolves();
        if (state === "lookup-error") return { ok: true, data: null };
        return {
          ok: true,
          data: { id: "mod-story-new", login: "orbit_owl", displayName: "Orbit Owl" },
        };
      }
      if (command.operation === "add-moderator") return { ok: true, data: null };
      if (command.operation === "remove-moderator") {
        if (state === "removing") return neverResolves();
        return { ok: true, data: null };
      }
      return { ok: true, data: null };
    },
    eventSub: storybookElectronApi.twitch.eventSub,
  };
}

function installModeratorsBridge(state: ModeratorsState): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const electronApi = Object.create(storybookElectronApi) as ElectronAPI;
  Object.defineProperty(electronApi, "twitch", {
    configurable: true,
    value: createModeratorsBridge(state),
  });
  Object.defineProperty(window, "electronAPI", { configurable: true, value: electronApi });

  return () => {
    if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
    else Reflect.deleteProperty(window, "electronAPI");
  };
}

function installModeratorsFixtures(state: ModeratorsState, signedIn: boolean): () => void {
  const previousAuthState = useAuthStore.getState();
  const previousModeratedChannelsState = useModeratedChannelsStore.getState();
  useAuthStore.setState({
    twitchUser: signedIn ? broadcaster : null,
    twitchConnected: signedIn,
    twitchReconnectRequired: false,
    isGuest: !signedIn,
  });
  const restoreBridge = installModeratorsBridge(state);

  return () => {
    toast.dismiss();
    restoreBridge();
    useAuthStore.setState(previousAuthState, true);
    useModeratedChannelsStore.setState(previousModeratedChannelsState, true);
  };
}

function StoryCanvas({ broadcasterId }: { broadcasterId: string }) {
  return (
    <>
      <div className="min-h-[340px] min-w-[620px] bg-[var(--color-background)] p-6">
        <ChannelModeratorsTable broadcasterId={broadcasterId} />
      </div>
      <ToastRoot />
    </>
  );
}

const meta = {
  title: "Pages/Moderation/Channel/ChannelModeratorsTable",
  component: ChannelModeratorsTable,
  args: {
    broadcasterId: STORY_BROADCASTER_ID,
    fixtureState: "loading",
    signedIn: true,
  },
  beforeEach: ({ args }) => installModeratorsFixtures(args.fixtureState, args.signedIn),
  render: ({ broadcasterId }) => <StoryCanvas broadcasterId={broadcasterId} />,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Deterministic auth, moderation-store, and Electron fixtures, with no live IPC or platform API calls.",
      },
    },
  },
} satisfies Meta<ModeratorsStoryArgs>;

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
    await expect(await within(canvasElement).findByText("No moderators yet.")).toBeInTheDocument();
  },
};

export const Populated: Story = {
  args: { fixtureState: "populated" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("moderator-row-mod-story-1")).toBeInTheDocument();
    await expect(canvas.getByText("Pixel Piper")).toBeInTheDocument();
    await expect(canvas.getByText("Showing first 100 moderators.")).toBeInTheDocument();
  },
};

export const LoadError: Story = {
  args: { fixtureState: "error" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByTestId("channel-moderators-error")
    ).toHaveTextContent("Moderator roster data is unavailable in this fixture.");
  },
};

export const AddInProgress: Story = {
  args: { fixtureState: "adding" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("textbox", { name: "Add moderator by username" });
    await userEvent.type(input, "orbit_owl");
    await userEvent.click(canvas.getByRole("button", { name: "Add" }));
    await expect(canvas.getByRole("button", { name: "Adding\u2026" })).toBeDisabled();
  },
};

export const RemoveInProgress: Story = {
  args: { fixtureState: "removing" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("moderator-row-mod-story-1");
    await userEvent.click(canvas.getByTestId("remove-moderator-button-mod-story-1"));
    await expect(canvas.getByRole("button", { name: "Removing\u2026" })).toBeDisabled();
  },
};

export const AddedModerator: Story = {
  args: { fixtureState: "empty" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("textbox", { name: "Add moderator by username" });
    await userEvent.type(input, "orbit_owl");
    await userEvent.click(canvas.getByRole("button", { name: "Add" }));
    await expect(await canvas.findByTestId("moderator-row-mod-story-new")).toBeInTheDocument();
    await expect(input).toHaveValue("");
  },
};

export const UnknownModerator: Story = {
  args: { fixtureState: "lookup-error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("textbox", { name: "Add moderator by username" });
    await userEvent.type(input, "unknown_mod");
    await userEvent.click(canvas.getByRole("button", { name: "Add" }));
    await expect(await canvas.findByText('Couldn\'t find user "unknown_mod"')).toBeInTheDocument();
    await expect(input).toHaveValue("unknown_mod");
  },
};

export const UnauthenticatedAddIsBlocked: Story = {
  args: { fixtureState: "empty", signedIn: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("textbox", { name: "Add moderator by username" });
    await userEvent.type(input, "guest_mod");
    await userEvent.click(canvas.getByRole("button", { name: "Add" }));
    await expect(canvas.getByRole("button", { name: "Add" })).toBeEnabled();
    await expect(input).toHaveValue("guest_mod");
  },
};
