import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PLAYER_QUALITIES } from "./player-story-fixtures";
import { SettingsMenu } from "./settings-menu";

const meta = {
  title: "Components/Player/SettingsMenu",
  component: SettingsMenu,
  decorators: [
    (Story) => (
      <div className="flex h-[560px] w-[420px] items-end justify-end rounded-xl bg-black p-10">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
  args: {
    qualities: PLAYER_QUALITIES,
    currentQualityId: "auto",
    playbackRate: 1,
    isTheater: false,
    onQualityChange: fn(),
    onPlaybackRateChange: fn(),
    onTogglePip: fn(),
    onToggleTheater: fn(),
    onOpenChange: fn(),
  },
} satisfies Meta<typeof SettingsMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openSettings(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
  await expect(canvas.getByText("Quality")).toBeVisible();
}

export const Closed: Story = {};

export const MainMenu: Story = {
  play: async ({ canvasElement }) => openSettings(canvasElement),
};

export const QualityMenu: Story = {
  play: async ({ canvasElement }) => {
    await openSettings(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Quality/ }));
    await expect(canvas.getByText("1080p60 (Source)")).toBeVisible();
  },
};

export const PlaybackSpeedMenu: Story = {
  args: { playbackRate: 1.25 },
  play: async ({ canvasElement }) => {
    await openSettings(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Playback speed/ }));
    await expect(canvas.getByRole("button", { name: "1.25" })).toBeVisible();
  },
};
