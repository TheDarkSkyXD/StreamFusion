import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PanelFeedback } from "../../../components/panels/PanelFeedback";

const retry = fn();
const meta = {
  title: "Moderation/Panels/Feedback",
  component: PanelFeedback,
  args: { state: "ready", retry, children: <p>Recent activity</p> },
} satisfies Meta<typeof PanelFeedback>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Recent activity")).toBeInTheDocument();
  },
};
export const Loading: Story = { args: { state: "loading" } };
export const PermissionRequired: Story = {
  args: { state: "permission", scopes: ["moderation:read"] },
};
export const Error: Story = {
  args: { state: "error", error: "The feed could not load." },
  play: async ({ canvasElement }) => {
    retry.mockClear();
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("The feed could not load.");
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(retry).toHaveBeenCalledOnce();
  },
};
