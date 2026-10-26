import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, within } from "storybook/test";
import { WorkspaceFeedPanel } from "../../../components/panels/WorkspaceFeedPanel";
import { WorkspacePanelFixture, type FixtureState } from "../fixtures/WorkspacePanelFixture";

const meta = {
  title: "Moderation/Panels/Workspace feed",
  component: WorkspaceFeedPanel,
  args: { kind: "activity", channelId: "100", channelName: "fixture_owner", fixtureState: "ready" },
  render: ({ fixtureState }) => <WorkspacePanelFixture panel="workspace" state={fixtureState} />,
  parameters: { layout: "centered" },
} satisfies Meta<ComponentProps<typeof WorkspaceFeedPanel> & { fixtureState: FixtureState }>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Orbit Owl")).toBeInTheDocument();
  },
};
export const Empty: Story = { args: { fixtureState: "empty" } };
