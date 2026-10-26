import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { FeedFilterMenu } from "../../../components/panels/FeedFilterMenu";

const options = [
  { value: "follow", label: "Follows" },
  { value: "raid", label: "Raids" },
] as const;

function FilterCanvas() {
  const [selected, setSelected] = useState<string[] | null>(null);
  return (
    <FeedFilterMenu
      label="Activity types"
      options={options}
      selected={selected}
      onChange={setSelected}
    />
  );
}

const meta = {
  title: "Moderation/Panels/Feed filter menu",
  component: FeedFilterMenu,
  args: { label: "Activity types", options, selected: null, onChange: () => undefined },
  render: () => <FilterCanvas />,
} satisfies Meta<typeof FeedFilterMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SelectOne: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Filter" }));
    const menu = await within(document.body).findByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Raids" }));
    await expect(within(menu).getByRole("menuitemcheckbox", { name: "Raids" })).not.toBeChecked();
  },
};
