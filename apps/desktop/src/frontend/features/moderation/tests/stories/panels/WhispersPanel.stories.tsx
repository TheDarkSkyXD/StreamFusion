import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, within } from "storybook/test";
import { WhispersPanel } from "../../../components/panels/WhispersPanel";
import { WorkspacePanelFixture, type FixtureState } from "../fixtures/WorkspacePanelFixture";

const meta = {
  title: "Moderation/Panels/Whispers",
  component: WhispersPanel,
  args: { channelId: "100", channelName: "fixture_owner", fixtureState: "ready" },
  render: ({ fixtureState }) => <WorkspacePanelFixture panel="whispers" state={fixtureState} />,
  parameters: { layout: "centered" },
} satisfies Meta<ComponentProps<typeof WhispersPanel> & { fixtureState: FixtureState }>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Message: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Thanks for helping with chat today.")
    ).toBeInTheDocument();
  },
};
export const Empty: Story = { args: { fixtureState: "empty" } };
