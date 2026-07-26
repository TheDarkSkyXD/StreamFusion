import type { Meta, StoryObj } from "@storybook/react-vite";
import { DELETED_MESSAGE, seedChatStoryStores, TWITCH_BADGE } from "./chat-story-fixtures";
import { DeletedMessageHighlight } from "./DeletedMessageHighlight";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/Moderation/DeletedMessageHighlight",
  component: DeletedMessageHighlight,
  args: {
    badges: [TWITCH_BADGE],
    children: <>spoiler text removed by a moderator</>,
    deletedAt: new Date(Date.UTC(2026, 6, 26, 20, 5, 0)),
    highlightStyle: "compact",
    mode: "compact",
    message: DELETED_MESSAGE,
    moderatorUsername: "ChannelMod",
  },
} satisfies Meta<typeof DeletedMessageHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Compact: Story = {};
export const Cozy: Story = { args: { highlightStyle: "cozy" } };
export const Audit: Story = { args: { mode: "audit" } };
