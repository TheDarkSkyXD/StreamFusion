import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { withAppRouter } from "../../../../.storybook/story-router";
import {
  installMultistreamMocks,
  multistreamFavoriteFixtures,
  multistreamFixtures,
  resetMultistreamStore,
} from "../../features/multistream/components/multistream/multistream-story-fixtures";
import { useMultiStreamStore } from "../../features/multistream/data/multistream-store";

import { MultiStreamPage } from "./index";

type MultiStreamStoryState =
  "default" | "empty" | "populated" | "focus" | "at-limit" | "favorites-error";

function installPageMocks(state: MultiStreamStoryState): () => void {
  const previousStore = useMultiStreamStore.getState();
  const restoreBridge = installMultistreamMocks();

  if (state === "favorites-error") {
    window.electronAPI.streams.getByChannel = async () => ({
      success: false,
      error: "Live favorite status is unavailable in this fixture.",
    });
  }

  configureMultiStreamStore(state);

  return () => {
    useMultiStreamStore.setState(previousStore, true);
    restoreBridge();
  };
}

function configureMultiStreamStore(state: MultiStreamStoryState): void {
  if (state === "empty") {
    resetMultistreamStore({ streams: [], isChatOpen: false });
    return;
  }

  if (state === "populated") {
    resetMultistreamStore({
      streams: multistreamFixtures,
      isChatOpen: false,
    });
    return;
  }

  if (state === "focus") {
    resetMultistreamStore({
      streams: multistreamFixtures,
      layout: "focus",
      focusedStreamId: multistreamFixtures[0].id,
      isChatOpen: false,
    });
    return;
  }

  if (state === "at-limit") {
    resetMultistreamStore({
      streams: multistreamFixtures.slice(0, 2),
      favoriteStreams: multistreamFavoriteFixtures.slice(0, 1),
      isChatOpen: false,
      multiviewCap: 2,
    });
    return;
  }

  if (state === "favorites-error") {
    resetMultistreamStore({
      streams: multistreamFixtures.slice(0, 1),
      favoriteStreams: multistreamFavoriteFixtures.slice(0, 1),
      isChatOpen: false,
      multiviewCap: 4,
    });
    return;
  }

  resetMultistreamStore({
    streams: multistreamFixtures.slice(0, 2),
    isChatOpen: false,
  });
}

function MultiStreamPageFixture() {
  return (
    <div className="h-[48rem] min-w-[64rem] overflow-hidden bg-[var(--color-background)]">
      <MultiStreamPage />
    </div>
  );
}

const meta = {
  title: "Pages/MultiStream/MultiStreamPage",
  component: MultiStreamPage,
  decorators: [withAppRouter],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "MultiStream layouts in an in-memory router with deterministic Zustand and Electron fixtures. Playback is deliberately unavailable, so no HLS, chat connection, network request, or real IPC can start.",
      },
    },
  },
} satisfies Meta<typeof MultiStreamPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: () => installPageMocks("default"),
  render: () => <MultiStreamPageFixture />,
};

export const Empty: Story = {
  beforeEach: () => installPageMocks("empty"),
  render: () => <MultiStreamPageFixture />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("No active streams")).toBeInTheDocument();
  },
};

export const PopulatedGrid: Story = {
  beforeEach: () => installPageMocks("populated"),
  render: () => <MultiStreamPageFixture />,
};

export const FocusLayout: Story = {
  beforeEach: () => installPageMocks("focus"),
  render: () => <MultiStreamPageFixture />,
};

export const AtSupportedLimit: Story = {
  beforeEach: () => installPageMocks("at-limit"),
  render: () => <MultiStreamPageFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Add Stream" }));
    const dialog = within(document.body);
    await userEvent.click(dialog.getByRole("tab", { name: "Favorites" }));
    await userEvent.click(await dialog.findByRole("button", { name: /NovaArcade/i }));
    await expect(dialog.getByRole("status")).toHaveTextContent(
      "Layout is full. Remove a stream before adding another (2/2)."
    );
  },
};

export const LiveFavoritesUnavailable: Story = {
  beforeEach: () => installPageMocks("favorites-error"),
  render: () => <MultiStreamPageFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Add Stream" }));
    const dialog = within(document.body);
    await userEvent.click(dialog.getByRole("tab", { name: "Favorites" }));
    await expect(await dialog.findByText("Couldn't refresh every favorite.")).toBeInTheDocument();
  },
};
