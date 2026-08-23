import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatComposerFooter } from "./ChatComposerFooter";

const meta = {
  title: "Components/Chat/Composer/ChatComposerFooter",
  component: ChatComposerFooter,
  decorators: [
    (Story) => (
      <div className="w-[440px] overflow-hidden rounded-lg bg-[#18181b] text-white">
        <div className="h-48 p-3 text-sm text-white/70">
          Chat messages appear above the composer.
        </div>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "The fixed footer boundary for composer actions. Its children remain fully customizable while the footer preserves the chat panel's surface and separator.",
      },
    },
  },
} satisfies Meta<typeof ChatComposerFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const QuickActions: Story = {
  args: {
    children: (
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-white/60">Press Enter to send</span>
        <div className="flex items-center gap-2">
          <button className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20" type="button">
            GIF
          </button>
          <button className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20" type="button">
            Emotes
          </button>
        </div>
      </div>
    ),
  },
};

export const ReplyContext: Story = {
  args: {
    children: (
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate text-white/70">
          Replying to NovaArcade: That last play was unreal.
        </span>
        <button className="shrink-0 text-white/60 hover:text-white" type="button">
          Cancel reply
        </button>
      </div>
    ),
  },
};
