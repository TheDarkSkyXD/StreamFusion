import type { Meta, StoryObj } from "@storybook/react-vite";

import { ScrollArea } from "./scroll-area";

const channels = [
  ["River Arcade", "Playing Hades II", "12.8K"],
  ["Mira Builds", "Designing a tiny home", "4.2K"],
  ["Night Shift", "Ranked climb", "8.7K"],
  ["Static Bloom", "Live modular session", "2.1K"],
  ["Quiet Kitchen", "Fresh pasta from scratch", "6.4K"],
  ["Orbit Labs", "Building a satellite tracker", "1.9K"],
  ["Sunday Circuit", "Retro hardware repair", "3.6K"],
  ["Northbound", "Speedrunning the classics", "9.1K"],
];

const meta = {
  title: "Components/UI/ScrollArea",
  component: ScrollArea,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="w-80 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChannelList: Story = {
  render: () => (
    <ScrollArea className="h-72">
      <div className="p-2">
        <p className="px-2 pb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-foreground-secondary)]">
          Live channels
        </p>
        {channels.map(([name, detail, viewers]) => (
          <div
            className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-[var(--color-background-tertiary)]"
            key={name}
          >
            <span className="h-9 w-9 shrink-0 rounded-full bg-[var(--color-background-elevated)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{name}</span>
              <span className="block truncate text-xs text-[var(--color-foreground-secondary)]">
                {detail}
              </span>
            </span>
            <span className="flex items-center gap-1 text-xs text-[var(--color-foreground-secondary)]">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              {viewers}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const CompactMetadata: Story = {
  render: () => (
    <ScrollArea className="h-40">
      <div className="divide-y divide-[var(--color-border)] px-4">
        {channels.slice(0, 6).map(([name, detail]) => (
          <div className="py-3" key={name}>
            <p className="text-sm font-semibold">{name}</p>
            <p className="text-xs text-[var(--color-foreground-secondary)]">{detail}</p>
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};
