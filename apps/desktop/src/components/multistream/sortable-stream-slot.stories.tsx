import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { installMultistreamMocks, resetMultistreamStore } from "./multistream-story-fixtures";
import { SortableStreamSlot } from "./sortable-stream-slot";

const meta = {
  title: "Components/Multistream/Sortable Stream Slot",
  component: SortableStreamSlot,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => {
      installMultistreamMocks();
      resetMultistreamStore();
      return (
        <DndContext>
          <SortableContext items={["twitch-novaarcade"]}>
            <div className="aspect-video w-[min(50rem,90vw)] overflow-hidden rounded-lg bg-black">
              <Story />
            </div>
          </SortableContext>
        </DndContext>
      );
    },
  ],
  args: {
    id: "twitch-novaarcade",
    platform: "twitch",
    channelName: "novaarcade",
    isMuted: false,
    onRemove: fn(),
    onFocus: fn(),
    isFocused: false,
  },
} satisfies Meta<typeof SortableStreamSlot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
