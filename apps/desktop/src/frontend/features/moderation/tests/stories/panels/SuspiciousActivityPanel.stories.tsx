import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, userEvent, within } from "storybook/test";
import { SuspiciousActivityPanel } from "../../../components/panels/SuspiciousActivityPanel";
import { WorkspacePanelFixture, type FixtureState } from "../fixtures/WorkspacePanelFixture";

const meta = {
  title: "Moderation/Panels/Suspicious activity",
  component: SuspiciousActivityPanel,
  args: { channelId: "100", channelName: "fixture_owner", fixtureState: "ready" },
  render: ({ fixtureState }) => <WorkspacePanelFixture panel="suspicious" state={fixtureState} />,
  parameters: { layout: "centered" },
} satisfies Meta<ComponentProps<typeof SuspiciousActivityPanel> & { fixtureState: FixtureState }>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MonitoredMessage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("A held message from a monitored account.")
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Restrict user" }));
    await expect(canvas.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  },
};
export const PermissionRequired: Story = {
  args: { fixtureState: "permission" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("button", { name: "Reconnect Twitch" })
    ).toBeInTheDocument();
  },
};
