import type { Meta, StoryObj } from "@storybook/react-vite";
import { LuRadio, LuUsers } from "react-icons/lu";

import { Button } from "./button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";

const meta = {
  title: "Components/UI/Card",
  component: Card,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A flat, tonal container for grouping related content. Cards use surface contrast instead of resting shadows.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[420px] max-w-[calc(100vw-2rem)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Continue watching</CardTitle>
        <CardDescription>Pick up where you left off across Twitch and Kick.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 rounded-md bg-[var(--color-background-tertiary)] p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#9146ff]">
            <LuRadio aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">Late-night speedruns</p>
            <p className="flex items-center gap-1 text-xs text-[var(--color-foreground-secondary)]">
              <LuUsers aria-hidden />
              18.4K viewers
            </p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm">Resume</Button>
        <Button size="sm" variant="ghost">
          Remove
        </Button>
      </CardFooter>
    </Card>
  ),
};

export const Dense: Story = {
  render: () => (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-3">
        <div>
          <p className="text-sm font-bold">Chat replay</p>
          <p className="text-xs text-[var(--color-foreground-secondary)]">
            Synced with the current VOD
          </p>
        </div>
        <span className="rounded-full bg-[var(--color-tag-bg)] px-2.5 py-1 text-xs font-bold">
          Enabled
        </span>
      </CardContent>
    </Card>
  ),
};
