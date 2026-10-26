import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ToolAccessGate } from "../../../../../../components/screens/Mod/channel/workspace/ToolAccessGate";

const requestScopes = fn();
const access = {
  canRead: true,
  canManage: true,
  broadcasterOnly: false,
  missingReadScopes: [],
  missingWriteScopes: [],
};
const meta = {
  title: "Pages/Moderation/Workspace/Tool access",
  component: ToolAccessGate,
  args: { access, channel: "fixture_owner", requestScopes, children: <p>Tool controls</p> },
} satisfies Meta<typeof ToolAccessGate>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CanManage: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Tool controls")).toBeInTheDocument();
  },
};
export const ReadOnly: Story = {
  args: {
    access: { ...access, canManage: false, missingWriteScopes: ["moderator:manage:shield_mode"] },
  },
  play: async ({ canvasElement }) => {
    requestScopes.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Reconnect Twitch" }));
    await expect(requestScopes).toHaveBeenCalledWith(["moderator:manage:shield_mode"]);
    await expect(canvas.getByText("Tool controls")).toBeInTheDocument();
  },
};
export const BroadcasterOnly: Story = {
  args: { access: { ...access, broadcasterOnly: true, canRead: false, canManage: false } },
};
