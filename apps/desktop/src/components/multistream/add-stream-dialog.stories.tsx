import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { AddStreamDialog } from "./add-stream-dialog";
import {
  installMultistreamMocks,
  multistreamFixtures,
  resetMultistreamStore,
} from "./multistream-story-fixtures";

const meta = {
  title: "Components/Multistream/Add Stream Dialog",
  component: AddStreamDialog,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AddStreamDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Trigger: Story = {
  render: () => {
    installMultistreamMocks();
    resetMultistreamStore({ streams: multistreamFixtures.slice(0, 2), multiviewCap: 4 });
    return <AddStreamDialog />;
  },
};

export const Open: Story = {
  render: () => {
    installMultistreamMocks();
    resetMultistreamStore({ streams: multistreamFixtures.slice(0, 2), multiviewCap: 4 });
    return <AddStreamDialog />;
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Add Stream" }));
  },
};

export const AtCapacity: Story = {
  render: () => {
    installMultistreamMocks();
    resetMultistreamStore({ streams: multistreamFixtures.slice(0, 2), multiviewCap: 2 });
    return <AddStreamDialog />;
  },
};
