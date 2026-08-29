import type { Meta, StoryObj } from "@storybook/react-vite";

import { MentionHighlight } from "./MentionHighlight";

const meta = {
  title: "Components/Chat/Highlights/Mention",
  component: MentionHighlight,
  args: {
    children: (
      <div className="px-1 py-1 text-sm">
        <strong className="text-[#f472b6]">MiraMakes:</strong> @NovaViewer, did you see that?
      </div>
    ),
  },
} satisfies Meta<typeof MentionHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
