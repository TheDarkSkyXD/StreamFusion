import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ModWorkspace } from "../../../../../../components/screens/Mod/channel/workspace/ModWorkspace";
import type { ModWidget } from "../../../../../../components/screens/Mod/channel/workspace/ModWorkspace";

const storageKey = "storybook:moderation:workspace";
const widgets = [
  {
    id: "video",
    title: "Stream",
    icon: <span aria-hidden="true">S</span>,
    content: <p>Live stream content</p>,
  },
  {
    id: "chat",
    title: "Chat",
    icon: <span aria-hidden="true">C</span>,
    content: <p>Live chat content</p>,
  },
  {
    id: "mod-log",
    title: "Mod Actions",
    icon: <span aria-hidden="true">M</span>,
    content: <p>Recent moderation actions</p>,
  },
  {
    id: "automod",
    title: "AutoMod Queue",
    icon: <span aria-hidden="true">A</span>,
    content: <p>Held messages</p>,
  },
] satisfies ModWidget[];

const meta = {
  title: "Pages/Moderation/Workspace/Layout",
  component: ModWorkspace,
  args: { platform: "twitch", storageKey, widgets },
  beforeEach: () => {
    const previous = localStorage.getItem(storageKey);
    localStorage.removeItem(storageKey);
    return () =>
      previous === null
        ? localStorage.removeItem(storageKey)
        : localStorage.setItem(storageKey, previous);
  },
  render: (args) => (
    <div className="h-[700px] min-w-[760px]">
      <ModWorkspace {...args} />
    </div>
  ),
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ModWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LockLayout: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Live stream content")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Lock layout" }));
    await expect(canvas.getByRole("button", { name: "Unlock layout" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Reset layout" })).toBeDisabled();
  },
};
