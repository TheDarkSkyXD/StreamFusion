import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { NotificationsDropdown } from "./NotificationsDropdown";

async function openDropdown(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByTitle("Notifications"));
}

const meta = {
  title: "Components/Top Navigation/NotificationsDropdown",
  component: NotificationsDropdown,
  parameters: {
    layout: "centered",
    docs: {
      description: { component: "The app notification menu with dismiss and clear actions." },
    },
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-[420px] w-[400px] max-w-[calc(100vw-2rem)] justify-end pt-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotificationsDropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithNotifications: Story = {
  play: ({ canvasElement }) => openDropdown(canvasElement),
};

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDropdown(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Clear all notifications" }));
  },
};
