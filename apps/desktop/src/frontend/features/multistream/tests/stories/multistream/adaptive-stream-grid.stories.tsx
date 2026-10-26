import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { AspectAwareStreamGrid } from "../../../components/multistream/adaptive-stream-grid";

const slots = ["NovaArcade", "MiraMakes", "PixelForge", "CozyCorner"];
const children = slots.map((channel) => (
  <div
    key={channel}
    className="flex h-full w-full items-center justify-center border border-white/20 bg-[#252525] text-xl font-semibold text-white"
  >
    {channel}
  </div>
));

const meta = {
  title: "Components/Multistream/AdaptiveStreamGrid",
  component: AspectAwareStreamGrid,
  decorators: [
    (Story) => (
      <div className="h-[680px] w-[1080px] bg-black">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
  args: { children },
} satisfies Meta<typeof AspectAwareStreamGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grid: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("NovaArcade").closest("[data-stream-placement]")).toHaveAttribute(
      "data-stream-placement",
      "grid"
    );
  },
};

export const Focus: Story = {
  args: { presentation: { kind: "focus", focusedIndex: 1 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("MiraMakes").closest("[data-stream-placement]")).toHaveAttribute(
      "data-stream-placement",
      "focused"
    );
    expect(canvas.getByText("NovaArcade").closest("[data-stream-placement]")).toHaveAttribute(
      "data-stream-placement",
      "rail"
    );
  },
};
