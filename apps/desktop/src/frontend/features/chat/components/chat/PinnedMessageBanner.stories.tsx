import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PINNED_MESSAGE, seedChatStoryStores } from "./chat-story-fixtures";
import { PinnedMessageBanner } from "./PinnedMessageBanner";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/Banners/PinnedMessageBanner",
  component: PinnedMessageBanner,
  decorators: [
    (Story) => (
      <div className="w-[420px] overflow-hidden rounded-md bg-[#18181b] text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    pin: PINNED_MESSAGE,
    viewerRole: "viewer",
    isExpanded: false,
    onExpandToggle: fn(),
    onDismiss: fn(),
  },
} satisfies Meta<typeof PinnedMessageBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ViewerCollapsed: Story = {};
export const ViewerExpanded: Story = { args: { isExpanded: true } };
export const ModeratorExpanded: Story = {
  args: {
    viewerRole: "mod",
    isExpanded: true,
    onDismiss: undefined,
    onUnpin: fn(),
    onUpdateDuration: fn(),
  },
};
export const Busy: Story = {
  args: {
    viewerRole: "mod",
    isExpanded: true,
    onDismiss: undefined,
    onUnpin: fn(),
    pinActionBusy: true,
  },
};
