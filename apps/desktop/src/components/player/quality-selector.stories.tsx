import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PLAYER_QUALITIES } from "./player-story-fixtures";
import { QualitySelector } from "./quality-selector";

const meta = {
  title: "Components/Player/QualitySelector",
  component: QualitySelector,
  decorators: [
    (Story) => (
      <div className="rounded-xl bg-black p-8">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
  args: {
    levels: PLAYER_QUALITIES,
    current: "auto",
    onChange: fn(),
  },
} satisfies Meta<typeof QualitySelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Automatic: Story = {};
export const SourceSelected: Story = { args: { current: "source" } };
export const Disabled: Story = { args: { disabled: true } };
export const NoLevels: Story = { args: { levels: [] } };
