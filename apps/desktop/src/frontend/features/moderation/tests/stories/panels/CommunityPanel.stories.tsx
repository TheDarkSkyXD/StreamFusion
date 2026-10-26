import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CommunityPanel } from "../../../components/panels/CommunityPanel";
import { WorkspacePanelFixture, type FixtureState } from "../fixtures/WorkspacePanelFixture";

const meta = {
  title: "Moderation/Panels/Community",
  component: CommunityPanel,
  args: { channelId: "100", channelName: "fixture_owner", fixtureState: "ready" },
  render: ({ fixtureState }) => <WorkspacePanelFixture panel="community" state={fixtureState} />,
  parameters: { layout: "centered" },
} satisfies Meta<ComponentProps<typeof CommunityPanel> & { fixtureState: FixtureState }>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Chatters: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Orbit Owl")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Active Mods" }));
    await expect(canvas.getByRole("button", { name: "Active Mods" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await waitFor(() => expect(canvas.queryByText("Lumen Lark")).not.toBeInTheDocument());
  },
};
export const Empty: Story = { args: { fixtureState: "empty" } };
