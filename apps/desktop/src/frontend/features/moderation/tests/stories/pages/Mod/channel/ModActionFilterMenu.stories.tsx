import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import {
  ALL_MOD_ACTION_FILTER_IDS,
  ModActionFilterMenu,
} from "../../../../../components/screens/Mod/channel/ModActionFilterMenu";

function FilterCanvas({ platform }: { platform: "twitch" | "kick" }) {
  const [selectedIds, setSelectedIds] = useState([...ALL_MOD_ACTION_FILTER_IDS]);
  const [moderatorFilter, setModeratorFilter] = useState("");
  return (
    <ModActionFilterMenu
      platform={platform}
      selectedIds={selectedIds}
      onSelectedIdsChange={setSelectedIds}
      moderatorFilter={moderatorFilter}
      onModeratorFilterChange={setModeratorFilter}
    />
  );
}

const meta = {
  title: "Pages/Moderation/Channel/Mod action filter menu",
  component: ModActionFilterMenu,
  args: {
    platform: "twitch",
    selectedIds: ALL_MOD_ACTION_FILTER_IDS,
    onSelectedIdsChange: () => undefined,
    moderatorFilter: "",
    onModeratorFilterChange: () => undefined,
  },
  render: ({ platform }) => <FilterCanvas platform={platform} />,
} satisfies Meta<typeof ModActionFilterMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Filters/ }));
    const menu = await within(document.body).findByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "All" }));
    await expect(within(menu).getByRole("menuitemcheckbox", { name: "All" })).not.toBeChecked();
    await userEvent.type(within(menu).getByRole("textbox", { name: "Moderator username" }), "Mira");
    await expect(within(menu).getByRole("textbox", { name: "Moderator username" })).toHaveValue(
      "Mira"
    );
  },
};
export const Kick: Story = { args: { platform: "kick" } };
