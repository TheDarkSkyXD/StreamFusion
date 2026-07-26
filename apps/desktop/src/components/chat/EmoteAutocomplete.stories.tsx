import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { useEmoteStore } from "../../store/emote-store";
import { CHAT_EMOTES, seedChatStoryStores } from "./chat-story-fixtures";
import { EmoteAutocomplete } from "./EmoteAutocomplete";

seedChatStoryStores();
useEmoteStore.setState({
  searchEmotes: (query, limit = 20) =>
    CHAT_EMOTES.filter((emote) => emote.name.toLowerCase().includes(query.toLowerCase())).slice(
      0,
      limit
    ),
});

const meta = {
  title: "Components/Chat/Autocomplete/EmoteAutocomplete",
  component: EmoteAutocomplete,
  decorators: [
    (Story) => (
      <div className="relative mt-52 w-[420px] rounded-md border border-[#333333] bg-[#191919] p-3 text-white">
        <Story />
        <span className="text-sm text-[#a0a0a0]">Composer anchor</span>
      </div>
    ),
  ],
  args: {
    inputValue: ":Ka",
    cursorPosition: 3,
    isActive: true,
    onSelect: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof EmoteAutocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MatchingEmotes: Story = {};

export const Inactive: Story = {
  args: { isActive: false },
};
