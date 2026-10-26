import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, userEvent, within } from "storybook/test";
import { ActivityFeedPanel } from "../../../components/panels/ActivityFeedPanel";
import { WorkspacePanelFixture, type FixtureState } from "../fixtures/WorkspacePanelFixture";

const meta = {
  title: "Moderation/Panels/Activity feed",
  component: ActivityFeedPanel,
  args: { channelId: "100", channelName: "fixture_owner", fixtureState: "ready" },
  render: ({ fixtureState }) => <WorkspacePanelFixture panel="activity" state={fixtureState} />,
  parameters: { layout: "centered" },
} satisfies Meta<ComponentProps<typeof ActivityFeedPanel> & { fixtureState: FixtureState }>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Activity: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Orbit Owl")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Filter" }));
    await expect(await within(document.body).findByRole("menu")).toBeInTheDocument();
  },
};
export const Error: Story = {
  args: { fixtureState: "error" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Twitch is unavailable in this error fixture.")
    ).toBeInTheDocument();
  },
};
export const Loading: Story = { args: { fixtureState: "loading" } };
export const Empty: Story = { args: { fixtureState: "empty" } };
