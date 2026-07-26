import type { Meta, StoryObj } from "@storybook/react-vite";
import { LuVolume2 } from "react-icons/lu";

import { Button } from "./button";
import { VisuallyHidden } from "./visually-hidden";

const meta = {
  title: "Components/UI/VisuallyHidden",
  component: VisuallyHidden,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Content that remains available to assistive technology without changing the visual layout. Inspect the accessibility tree to see the hidden labels in these examples.",
      },
    },
  },
} satisfies Meta<typeof VisuallyHidden>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AccessibleIconButton: Story = {
  render: () => (
    <Button size="icon" variant="secondary">
      <LuVolume2 aria-hidden />
      <VisuallyHidden>Mute stream</VisuallyHidden>
    </Button>
  ),
};

export const SupplementalStatus: Story = {
  render: () => (
    <div className="flex items-center gap-2 rounded-full bg-[var(--color-background-tertiary)] px-3 py-1.5 text-xs font-bold">
      <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
      12.8K
      <VisuallyHidden>viewers, live now</VisuallyHidden>
    </div>
  ),
};
