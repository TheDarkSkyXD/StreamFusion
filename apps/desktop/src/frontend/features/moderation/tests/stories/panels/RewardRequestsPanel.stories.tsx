import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, userEvent, within } from "storybook/test";
import { RewardRequestsPanel } from "../../../components/panels/RewardRequestsPanel";
import { WorkspacePanelFixture, type FixtureState } from "../fixtures/WorkspacePanelFixture";

const meta = {
  title: "Moderation/Panels/Reward requests",
  component: RewardRequestsPanel,
  args: { channelId: "100", channelName: "fixture_owner", fixtureState: "ready" },
  render: ({ fixtureState }) => <WorkspacePanelFixture panel="rewards" state={fixtureState} />,
  parameters: { layout: "centered" },
} satisfies Meta<ComponentProps<typeof RewardRequestsPanel> & { fixtureState: FixtureState }>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("A poem about the stars, please.")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Fulfill request" }));
    await expect(canvas.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  },
};
export const Empty: Story = { args: { fixtureState: "empty" } };
