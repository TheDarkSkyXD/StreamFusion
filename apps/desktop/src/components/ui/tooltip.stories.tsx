import type { Meta, StoryObj } from "@storybook/react-vite";
import { LuMinimize2, LuPanelLeft, LuSettings } from "react-icons/lu";

import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

const meta = {
  title: "Components/UI/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Brief supporting text for icon-only or unfamiliar controls. Content portals into the preview document and appears without delaying keyboard users.",
      },
    },
  },
  decorators: [
    (Story) => (
      <TooltipProvider delayDuration={0}>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Player settings">
          <LuSettings aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Player settings</TooltipContent>
    </Tooltip>
  ),
};

export const Open: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Collapse sidebar">
          <LuPanelLeft aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">Collapse sidebar</TooltipContent>
    </Tooltip>
  ),
};

export const PlayerControls: Story = {
  render: () => (
    <div className="flex items-center gap-1 rounded-lg bg-black p-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="Exit picture in picture">
            <LuMinimize2 aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Exit picture in picture</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="Player settings">
            <LuSettings aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Player settings</TooltipContent>
      </Tooltip>
    </div>
  ),
};
