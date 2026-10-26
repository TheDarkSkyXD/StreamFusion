import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { CommandResultCard } from "../../../components/chat/CommandResultCard";

const meta = {
  title: "Components/Chat/Commands/CommandResultCard",
  component: CommandResultCard,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
  args: {
    result: { tone: "info", title: "Available commands", body: "/help shows chat commands." },
    onDismiss: fn(),
  },
} satisfies Meta<typeof CommandResultCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Information: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("status")).toHaveTextContent("Available commands");
    await userEvent.click(canvas.getByRole("button", { name: /dismiss/i }));
    expect(args.onDismiss).toHaveBeenCalledOnce();
  },
};

export const Error: Story = {
  args: {
    result: { tone: "error", title: "Command unavailable", body: "Sign in to use this command." },
  },
};
