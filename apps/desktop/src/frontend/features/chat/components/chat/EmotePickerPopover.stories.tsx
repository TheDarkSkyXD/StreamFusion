import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, createRef, type RefObject, useRef } from "react";
import { fn, userEvent, within } from "storybook/test";
import { STORY_CHANNEL_ID, seedChatStoryStores } from "./chat-story-fixtures";
import { EmotePickerPopover } from "./EmotePickerPopover";

seedChatStoryStores();

function PickerCanvas(props: ComponentProps<typeof EmotePickerPopover>) {
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative h-[600px] w-[480px] rounded-lg bg-[#18181b] p-4 text-white">
      <button
        ref={anchorRef}
        type="button"
        className="absolute bottom-4 right-4 rounded-md border border-[#333333] bg-[#252525] px-3 py-2 text-sm"
      >
        Emote picker anchor
      </button>
      <EmotePickerPopover {...props} anchorRef={anchorRef as RefObject<HTMLElement>} />
    </div>
  );
}

const meta = {
  title: "Components/Chat/Emotes/EmotePickerPopover",
  component: EmotePickerPopover,
  parameters: { layout: "fullscreen" },
  render: (args) => <PickerCanvas {...args} />,
  args: {
    isOpen: true,
    onClose: fn(),
    onSelect: fn(),
    anchorRef: createRef<HTMLElement>() as RefObject<HTMLElement>,
    scope: "native",
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
    channelName: "novaarcade",
    channelLabel: "Nova Arcade",
  },
} satisfies Meta<typeof EmotePickerPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchNative: Story = {};
export const KickNative: Story = {
  args: {
    platform: "kick",
    channelName: "pixelnomad",
    channelLabel: "Pixel Nomad",
    viewerIsSubscribed: false,
  },
};
export const TwitchThirdParty: Story = {
  args: { scope: "thirdParty" },
};
export const SearchNoResults: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(await body.findByPlaceholderText("Search emotes..."), "no-such-emote");
  },
};
