import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ModActionConfirmDialog } from "./ModActionConfirmDialog";
import { TimeoutDurationPicker } from "./TimeoutDurationPicker";

const meta = {
  title: "Components/Chat/Moderation/Mod Action Confirm Dialog",
  component: ModActionConfirmDialog,
  parameters: { layout: "centered" },
  args: {
    open: true,
    onOpenChange: fn(),
    actionType: "ban",
    targetPreview: (
      <span>
        <strong>@spoilerfan</strong>: posting the ending in chat again
      </span>
    ),
    onConfirm: fn(),
  },
} satisfies Meta<typeof ModActionConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ban: Story = {};

export const TimeoutWithDuration: Story = {
  args: {
    actionType: "timeout",
    extraSlot: ({ onDataChange, disabled }) => (
      <TimeoutDurationPicker
        disabled={disabled}
        onChange={(durationSeconds) => onDataChange({ durationSeconds })}
      />
    ),
  },
};

export const ClearChat: Story = {
  args: {
    actionType: "clear",
    targetPreview: "All currently visible messages",
  },
};

export const BusyPredictionResolve: Story = {
  args: {
    actionType: "predictionResolve",
    targetPreview: "Will the next run beat the personal best? Winner: Yes",
    busy: true,
  },
};
