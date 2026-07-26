import type { Meta, StoryObj } from "@storybook/react-vite";
import { LuBell, LuExternalLink, LuHeart, LuPlay } from "react-icons/lu";

import { Button } from "./button";

const meta = {
  title: "Components/UI/Button",
  component: Button,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "The shared action primitive. Neutral variants belong to StreamFusion; platform colors are reserved for Twitch and Kick actions.",
      },
    },
  },
  args: {
    children: "Watch now",
    variant: "default",
    size: "default",
  },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "outline",
        "ghost",
        "twitch",
        "kick",
        "destructive",
        "link",
      ],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
    },
    asChild: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <LuPlay aria-hidden />
        Watch now
      </Button>
      <Button variant="secondary">Add to multistream</Button>
      <Button variant="outline">
        <LuBell aria-hidden />
        Notify me
      </Button>
      <Button variant="ghost">Dismiss</Button>
      <Button variant="twitch">Connect Twitch</Button>
      <Button variant="kick">Connect Kick</Button>
      <Button variant="destructive">Unfollow</Button>
      <Button variant="link">View channel</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Compact</Button>
      <Button>Default</Button>
      <Button size="lg">Large action</Button>
      <Button size="icon" aria-label="Follow channel">
        <LuHeart aria-hidden />
      </Button>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button>Ready</Button>
      <Button disabled>Unavailable</Button>
      <Button variant="secondary" aria-busy="true">
        Connecting…
      </Button>
    </div>
  ),
};

export const ComposedAsLink: Story = {
  render: () => (
    <Button asChild variant="outline">
      <a href="https://streamfusion.app">
        Open StreamFusion
        <LuExternalLink aria-hidden />
      </a>
    </Button>
  ),
};
