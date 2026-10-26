import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { ChannelSwitcher } from "../../../components/panels/ChannelSwitcher";
import { installPageFixtures } from "../pages/Mod/channel/ModChannelPage.stories";

function SwitcherCanvas() {
  const [router] = useState(() =>
    createRouter({
      routeTree: createRootRoute({
        component: () => <ChannelSwitcher currentChannelId="1002048" />,
      }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    })
  );
  return (
    <div className="h-[360px] w-[300px]">
      <RouterProvider router={router} />
    </div>
  );
}

const meta = {
  title: "Moderation/Panels/Channel switcher",
  component: ChannelSwitcher,
  args: { currentChannelId: "1002048" },
  beforeEach: () => installPageFixtures("twitch-broadcaster-ready"),
  render: () => <SwitcherCanvas />,
} satisfies Meta<typeof ChannelSwitcher>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ModeratedChannels: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("link", { name: "NovaArcade" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  },
};
