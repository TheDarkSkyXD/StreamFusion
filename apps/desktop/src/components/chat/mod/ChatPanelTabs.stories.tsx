import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { ChatPanelTabs } from "./ChatPanelTabs";

const panel = (label: string, description: string) => (
  <div className="h-full bg-[#0f0f0f] p-4 text-white">
    <h3 className="text-sm font-semibold">{label}</h3>
    <p className="mt-1 text-xs text-neutral-400">{description}</p>
  </div>
);

const meta = {
  title: "Components/Chat/Moderation/Chat Panel Tabs",
  component: ChatPanelTabs,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="h-80 w-[360px] overflow-hidden rounded-lg border border-[#333]">
        <Story />
      </div>
    ),
  ],
  args: {
    visibleTabs: ["chat", "modlog", "engagement"],
    badges: { modlog: 3 },
    children: {
      chat: panel("Chat", "The live chat subtree remains mounted while another tab is selected."),
      modlog: panel("Mod log", "Recent moderation actions for this channel."),
      engagement: panel("Engagement", "Broadcaster prediction and poll controls."),
    },
    onTabChange: fn(),
  },
} satisfies Meta<typeof ChatPanelTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Broadcaster: Story = {};

export const ModLogSelected: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("tab", { name: /mod log/i }));
  },
};

export const ViewerWithoutTabStrip: Story = {
  args: {
    visibleTabs: ["chat"],
    badges: {},
  },
};
