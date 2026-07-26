import type { Meta, StoryObj } from "@storybook/react-vite";

import { KickEmoteIcon, KickIcon, SevenTVIcon, TwitchIcon } from "./PlatformIcons";

const meta = {
  title: "Components/Icons/PlatformIcons",
  component: TwitchIcon,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Brand marks used for platform identification. Twitch purple and Kick green stay contextual rather than becoming general interface accents.",
      },
    },
  },
  args: {
    size: 32,
    className: "text-[#9146FF]",
  },
  argTypes: {
    size: { control: { type: "range", min: 12, max: 72, step: 2 } },
  },
} satisfies Meta<typeof TwitchIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const PlatformSet: Story = {
  render: () => (
    <div className="flex items-end gap-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-6">
      <figure className="flex flex-col items-center gap-3">
        <TwitchIcon size={36} className="text-[#9146FF]" />
        <figcaption className="text-xs font-semibold text-[var(--color-foreground-muted)]">
          Twitch
        </figcaption>
      </figure>
      <figure className="flex flex-col items-center gap-3">
        <KickIcon size={36} className="text-[#53FC18]" />
        <figcaption className="text-xs font-semibold text-[var(--color-foreground-muted)]">
          Kick
        </figcaption>
      </figure>
      <figure className="flex flex-col items-center gap-3">
        <SevenTVIcon size={36} className="text-white" />
        <figcaption className="text-xs font-semibold text-[var(--color-foreground-muted)]">
          7TV
        </figcaption>
      </figure>
      <figure className="flex flex-col items-center gap-3">
        <KickEmoteIcon size={36} className="text-[#53FC18]" />
        <figcaption className="text-xs font-semibold text-[var(--color-foreground-muted)]">
          Kick emote
        </figcaption>
      </figure>
    </div>
  ),
};

export const Scale: Story = {
  render: () => (
    <div className="flex items-center gap-5 text-[#9146FF]">
      {[16, 24, 32, 48, 64].map((size) => (
        <TwitchIcon key={size} size={size} />
      ))}
    </div>
  ),
};
