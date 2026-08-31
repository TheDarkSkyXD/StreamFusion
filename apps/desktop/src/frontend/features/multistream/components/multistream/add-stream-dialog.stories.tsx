import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { AddStreamDialog } from "./add-stream-dialog";
import {
  installMultistreamMocks,
  multistreamFavoriteFixtures,
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
    resetMultistreamStore({
      streams: multistreamFixtures.slice(0, 2),
      favoriteStreams: multistreamFavoriteFixtures.slice(0, 1),
      playbackBudget: 4,
    });
    return <AddStreamDialog />;
  },
};

export const UnifiedSearchWithFavoriteActions: Story = {
  render: () => {
    installMultistreamMocks();
    resetMultistreamStore({
      streams: multistreamFixtures.slice(0, 2),
      favoriteStreams: multistreamFavoriteFixtures.slice(0, 1),
      playbackBudget: 4,
    });
    return <AddStreamDialog />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Add Stream" }));
    await userEvent.type(canvas.getByRole("textbox"), "Nova");
  },
};

export const LiveFavorites: Story = {
  render: () => {
    installMultistreamMocks();
    resetMultistreamStore({
      streams: multistreamFixtures.slice(0, 1),
      favoriteStreams: multistreamFavoriteFixtures,
      playbackBudget: 4,
    });
    return <AddStreamDialog />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Add Stream" }));
    await userEvent.click(canvas.getByRole("tab", { name: "Favorites" }));
  },
};

export const AtCapacity: Story = {
  render: () => {
    installMultistreamMocks();
    resetMultistreamStore({ streams: multistreamFixtures.slice(0, 2), playbackBudget: 2 });
    return <AddStreamDialog />;
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Add Stream" }));
  },
};
