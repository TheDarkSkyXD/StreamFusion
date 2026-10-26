import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import { getCommandsForAccess } from "../../../components/commands/chat-command-registry";
import { CommandAutocomplete } from "../../../components/chat/CommandAutocomplete";

const commands = getCommandsForAccess({
  kind: "authenticated",
  platform: "twitch",
  role: "moderator",
}).slice(0, 5);

const meta = {
  title: "Components/Chat/Commands/CommandAutocomplete",
  component: CommandAutocomplete,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="relative mt-80 w-[540px] bg-[#1a1a1a] p-4 text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    commands,
    selectedKey: commands[0]?.key ?? null,
    onSelect: fn(),
    onSelectedKeyChange: fn(),
  },
} satisfies Meta<typeof CommandAutocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ModeratorCommands: Story = {
  render: (args) => {
    function Preview() {
      const [selectedKey, setSelectedKey] = useState(args.selectedKey);
      return (
        <CommandAutocomplete
          {...args}
          selectedKey={selectedKey}
          onSelectedKeyChange={setSelectedKey}
        />
      );
    }
    return <Preview />;
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const options = canvas.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    await userEvent.hover(options[1]);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(options[1]);
    expect(args.onSelect).toHaveBeenCalledWith(commands[1]);
  },
};
