import type { Meta, StoryObj } from "@storybook/react-vite";

import { Progress } from "./progress";

const meta = {
  title: "Components/UI/Progress",
  component: Progress,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: {
    value: 64,
    "aria-label": "Download progress",
  },
  argTypes: {
    value: {
      control: { type: "range", min: 0, max: 100, step: 1 },
    },
  },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const DownloadStates: Story = {
  render: () => (
    <div className="grid gap-5">
      {[
        ["Queued", 0],
        ["Downloading", 38],
        ["Almost ready", 86],
        ["Complete", 100],
      ].map(([label, value]) => (
        <div className="grid gap-2" key={label}>
          <div className="flex justify-between text-xs">
            <span>{label}</span>
            <span className="text-[var(--color-foreground-secondary)]">{value}%</span>
          </div>
          <Progress value={Number(value)} aria-label={`${label} progress`} />
        </div>
      ))}
    </div>
  ),
};

export const Compact: Story = {
  args: {
    value: 72,
    className: "h-1",
    "aria-label": "Playback progress",
  },
};
