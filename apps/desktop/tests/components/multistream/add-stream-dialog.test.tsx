import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, routerMock, screen } from "../../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

const mocks = vi.hoisted(() => ({
  addStream: vi.fn(),
  toggleFavorite: vi.fn(),
  refetchQueries: vi.fn(async () => undefined),
  store: {
    streams: [] as Array<{ id: string }>,
    multiviewCap: 4,
    favoriteStreams: [] as Array<{
      platform: "twitch" | "kick";
      channelId: string;
      channelName: string;
      displayName: string;
    }>,
  },
  liveFavorites: {
    streams: [] as Array<Record<string, unknown>>,
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ refetchQueries: mocks.refetchQueries }),
}));

vi.mock("@/store/multistream-store", () => ({
  useMultiStreamStore: (selector: (state: unknown) => unknown) =>
    selector({
      ...mocks.store,
      addStream: mocks.addStream,
      toggleFavorite: mocks.toggleFavorite,
      isFavorite: (favorite: { channelId: string }) =>
        mocks.store.favoriteStreams.some((candidate) => candidate.channelId === favorite.channelId),
    }),
}));

vi.mock("@/hooks/queries/useLiveFavoriteStreams", () => ({
  useLiveFavoriteStreams: () => mocks.liveFavorites,
}));

vi.mock("@/components/search/UnifiedSearchInput", () => ({
  UnifiedSearchInput: (props: {
    platform?: "twitch" | "kick";
    liveOnlyChannels?: boolean;
    inputClassName?: string;
    inputRef?: { current: HTMLInputElement | null };
    onSearch?: (term: string) => void;
    onSelectChannel?: (channel: Record<string, unknown>) => void;
    onToggleChannelFavorite?: (channel: Record<string, unknown>) => void;
    isChannelFavorite?: (channel: Record<string, unknown>) => boolean;
  }) => {
    const channel = {
      id: "channel-ninja",
      platform: "twitch",
      username: "ninja",
      displayName: "Ninja",
      avatarUrl: "",
    };
    const kickChannel = {
      id: "channel-lunar",
      platform: "kick",
      username: "lunar",
      displayName: "Lunar",
      avatarUrl: "",
    };
    return (
      <div>
        <input
          ref={props.inputRef}
          data-testid="mock-search"
          data-live-only={String(props.liveOnlyChannels)}
          data-input-class={props.inputClassName}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onSearch?.(event.currentTarget.value);
          }}
        />
        <div data-testid="twitch-result">
          <button type="button" onClick={() => props.onSelectChannel?.(channel)}>
            pick-ninja
          </button>
          <span>Twitch</span>
        </div>
        {!props.platform && (
          <div data-testid="kick-result">
            <button type="button" onClick={() => props.onSelectChannel?.(kickChannel)}>
              pick-lunar
            </button>
            <span>Kick</span>
          </div>
        )}
        <button
          type="button"
          aria-pressed={props.isChannelFavorite?.(channel)}
          aria-label="Add Ninja to favorites"
          onClick={() => props.onToggleChannelFavorite?.(channel)}
        >
          favorite-ninja
        </button>
      </div>
    );
  },
}));

import { AddStreamDialog } from "@/components/multistream/add-stream-dialog";

const liveFavorite = {
  id: "stream-nova",
  platform: "kick" as const,
  channelId: "channel-nova",
  channelName: "nova",
  channelDisplayName: "Nova",
  channelAvatar: "",
  title: "Late night ranked",
  viewerCount: 1200,
  thumbnailUrl: "",
  isLive: true,
  startedAt: null,
  language: "en",
  tags: [],
  categoryName: "VALORANT",
};

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Add Stream" }));
}

function openFavorites() {
  openDialog();
  fireEvent.click(screen.getByRole("tab", { name: "Favorites" }));
}

// Guards: Search and Favorites retain WAI-ARIA tab semantics and keyboard navigation.
// Guards: Search is unified across Twitch and Kick with platform-identified rows and no platform selector.
// Guards: search rows add while their star action only toggles the saved favorite.
// Guards: duplicate/capacity rejection stays in the dialog and is announced politely.
// Guards: favorite loading, error/retry, empty, and live-result states remain distinct.
describe("AddStreamDialog", () => {
  beforeEach(() => {
    mocks.addStream.mockClear();
    mocks.toggleFavorite.mockClear();
    mocks.refetchQueries.mockClear();
    mocks.store.streams = [];
    mocks.store.multiviewCap = 4;
    mocks.store.favoriteStreams = [];
    mocks.liveFavorites.streams = [];
    mocks.liveFavorites.isLoading = false;
    mocks.liveFavorites.error = null;
  });

  it("opens a 540px Dark Theater dialog with Search selected", () => {
    renderWithProviders(<AddStreamDialog />);
    openDialog();

    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-[540px]");
    expect(screen.getByRole("tablist", { name: "Add stream source" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Favorites" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
  });

  it("shows unified Twitch and Kick live results without a platform selector", () => {
    renderWithProviders(<AddStreamDialog />);
    openDialog();

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByTestId("twitch-result")).toHaveTextContent("Twitch");
    expect(screen.getByTestId("kick-result")).toHaveTextContent("Kick");
  });

  it("moves and wraps tab focus with arrows, Home, and End", async () => {
    renderWithProviders(<AddStreamDialog />);
    openDialog();
    const searchTab = screen.getByRole("tab", { name: "Search" });
    const favoritesTab = screen.getByRole("tab", { name: "Favorites" });

    fireEvent.keyDown(searchTab, { key: "ArrowLeft" });
    await waitFor(() => expect(favoritesTab).toHaveFocus());
    fireEvent.keyDown(favoritesTab, { key: "ArrowRight" });
    await waitFor(() => expect(searchTab).toHaveFocus());
    fireEvent.keyDown(searchTab, { key: "End" });
    await waitFor(() => expect(favoritesTab).toHaveFocus());
    fireEvent.keyDown(favoritesTab, { key: "Home" });
    await waitFor(() => expect(searchTab).toHaveFocus());
  });

  it("keeps the live-only search input icon padding contract", () => {
    renderWithProviders(<AddStreamDialog />);
    openDialog();
    const input = screen.getByTestId("mock-search");

    expect(input).toHaveAttribute("data-live-only", "true");
    expect(input.getAttribute("data-input-class")).not.toMatch(/\b(?:px|pl|pr)-/);
  });

  it("adds a selected search result and closes", () => {
    renderWithProviders(<AddStreamDialog />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "pick-ninja" }));

    expect(mocks.addStream).toHaveBeenCalledWith("twitch", "ninja");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles a search favorite without adding or closing", () => {
    renderWithProviders(<AddStreamDialog />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Add Ninja to favorites" }));

    expect(mocks.toggleFavorite).toHaveBeenCalledWith({
      platform: "twitch",
      channelId: "channel-ninja",
      channelName: "ninja",
      displayName: "Ninja",
      avatarUrl: "",
    });
    expect(mocks.addStream).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps a duplicate open, announces it, and returns focus to search", async () => {
    mocks.store.streams = [{ id: "twitch-ninja" }];
    renderWithProviders(<AddStreamDialog />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "pick-ninja" }));

    expect(mocks.addStream).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("ninja is already in this layout");
    await waitFor(() => expect(screen.getByTestId("mock-search")).toHaveFocus());
  });

  it("keeps an at-capacity add open with a quiet capacity status", async () => {
    mocks.store.streams = [{ id: "twitch-one" }, { id: "kick-two" }];
    mocks.store.multiviewCap = 2;
    renderWithProviders(<AddStreamDialog />);
    openDialog();
    expect(screen.getByText("2 / 2 streams")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "pick-ninja" }));

    expect(mocks.addStream).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Layout is full");
    await waitFor(() => expect(screen.getByTestId("mock-search")).toHaveFocus());
  });

  it("shows a Favorites loading state", () => {
    mocks.liveFavorites.isLoading = true;
    renderWithProviders(<AddStreamDialog />);
    openFavorites();
    expect(screen.getByLabelText("Loading live favorites")).toBeInTheDocument();
  });

  it("retries each exact saved-channel query from the error state", () => {
    mocks.store.favoriteStreams = [
      { platform: "twitch", channelId: "one", channelName: "alpha", displayName: "Alpha" },
      { platform: "kick", channelId: "two", channelName: "beta", displayName: "Beta" },
    ];
    mocks.liveFavorites.error = new Error("offline");
    renderWithProviders(<AddStreamDialog />);
    openFavorites();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(mocks.refetchQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["streams", "channel", "twitch", "alpha"],
      exact: true,
    });
    expect(mocks.refetchQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["streams", "channel", "kick", "beta"],
      exact: true,
    });
  });

  it("shows a distinct empty Favorites state", () => {
    renderWithProviders(<AddStreamDialog />);
    openFavorites();
    expect(screen.getByText("No live favorites")).toBeInTheDocument();
  });

  it("adds a live favorite from its main row while its star only unfavorites", () => {
    mocks.liveFavorites.streams = [liveFavorite];
    renderWithProviders(<AddStreamDialog />);
    openFavorites();

    fireEvent.click(screen.getByRole("button", { name: "Remove Nova from favorites" }));
    expect(mocks.toggleFavorite).toHaveBeenCalled();
    expect(mocks.addStream).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Nova.*VALORANT.*1,200/ }));
    expect(mocks.addStream).toHaveBeenCalledWith("kick", "nova");
  });

  it("lets Radix Escape close and restore focus to the trigger", async () => {
    renderWithProviders(<AddStreamDialog />);
    const trigger = screen.getByRole("button", { name: "Add Stream" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
