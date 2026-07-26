import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { seedChatStoryStores } from "./chat-story-fixtures";
import { MentionAutocomplete } from "./MentionAutocomplete";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/Autocomplete/MentionAutocomplete",
  component: MentionAutocomplete,
  decorators: [
    (Story) => (
      <div className="relative mt-52 w-[420px] rounded-md border border-[#333333] bg-[#191919] p-3 text-white">
        <Story />
        <span className="text-sm text-[#a0a0a0]">Composer anchor</span>
      </div>
    ),
  ],
  args: {
    inputValue: "@nova",
    cursorPosition: 5,
    isActive: true,
    platform: "twitch",
    onSelect: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof MentionAutocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchMatches: Story = {};
export const KickMatches: Story = {
  args: {
    inputValue: "@kick",
    cursorPosition: 5,
    platform: "kick",
  },
};
export const Inactive: Story = {
  args: { isActive: false },
};
