import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, createRef, type RefObject, useRef } from "react";
import { fn } from "storybook/test";
import { STORY_CHANNEL_ID, seedChatStoryStores } from "./chat-story-fixtures";
import { EmoteDialog } from "./EmoteDialog";

seedChatStoryStores();

function DialogCanvas(props: ComponentProps<typeof EmoteDialog>) {
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative h-[600px] w-[480px] rounded-lg bg-[#18181b] p-4 text-white">
      <p className="text-sm text-[#a0a0a0]">The picker is positioned from its anchor button.</p>
      <button
        ref={anchorRef}
        type="button"
        className="absolute bottom-4 right-4 rounded-md border border-[#333333] bg-[#252525] px-3 py-2 text-sm"
      >
        Emote dialog anchor
      </button>
      <EmoteDialog {...props} anchorRef={anchorRef as RefObject<HTMLElement>} />
    </div>
  );
}

const meta = {
  title: "Components/Chat/Emotes/EmoteDialog",
  component: EmoteDialog,
  parameters: { layout: "fullscreen" },
  render: (args) => <DialogCanvas {...args} />,
  args: {
    isOpen: true,
    onClose: fn(),
    onSelect: fn(),
    anchorRef: createRef<HTMLElement>() as RefObject<HTMLElement>,
    scope: "native",
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
  },
} satisfies Meta<typeof EmoteDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchNative: Story = {};

export const KickSubscriberLocks: Story = {
  args: {
    platform: "kick",
    viewerIsSubscribed: false,
  },
};

export const TwitchThirdParty: Story = {
  args: { scope: "thirdParty" },
};
