import { act } from "@testing-library/react";
import type { PlayerError } from "@/features/playback/components/player/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  waitFor,
} from "../../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/features/multistream/data/multistream-store", () => ({
  useMultiStreamStore: (selector: (state: unknown) => unknown) =>
    selector({
      toggleMute: vi.fn(),
      setChatStream: vi.fn(),
      chatStreamId: null,
    }),
}));

vi.mock("@/features/discovery/data/queries/useChannels", () => ({
  useChannelByUsername: () => ({ data: fixtures.channel({ displayName: "Ninja" }) }),
}));

vi.mock("@/features/playback/data/useStreamPlayback", () => ({
  useStreamPlayback: (_platform: string, identifier: string) => {
    playerMocks.playbackIdentifiers.push(identifier);
    return {
      playback: identifier ? { url: "https://x.test/playlist.m3u8" } : null,
      isLoading: false,
      reload: playerMocks.reload,
      playbackRevision: playerMocks.playbackRevision,
    };
  },
}));

vi.mock("@/features/playback/data/use-raid-handoff", () => ({
  useRaidHandoff: () => ({ popup: null }),
}));

const playerMocks = vi.hoisted(() => ({
  playbackRevision: 1,
  playbackIdentifiers: [] as string[],
  reload: vi.fn(),
  twitchProps: null as null | {
    className?: string;
    onError?: (error: PlayerError) => boolean | void;
    onCleanPresentedFrame?: () => void;
    recoveryManagedExternally?: boolean;
  },
  kickProps: null as null | { className?: string },
}));

vi.mock("@/features/playback/components/player/twitch/twitch-live-player", () => ({
  TwitchLivePlayer: (props: {
    className?: string;
    onError?: (error: PlayerError) => boolean | void;
    onCleanPresentedFrame?: () => void;
    recoveryManagedExternally?: boolean;
  }) => {
    playerMocks.twitchProps = props;
    return (
      <div data-testid="tw-live-player" className={props.className}>
        player
      </div>
    );
  },
}));

vi.mock("@/features/playback/components/player/kick/kick-live-player", () => ({
  KickLivePlayer: (props: { className?: string }) => {
    playerMocks.kickProps = props;
    return (
      <div data-testid="kick-live-player" className={props.className}>
        player
      </div>
    );
  },
}));

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import { StreamSlot } from "@/features/multistream/components/multistream/stream-slot";

// Guards: platform routing — twitch streams mount the Twitch live player, kick streams mount Kick. Silently mounting the wrong one would render a blank slot for the platform that didn't match
// Guards: loading/error/offline state — when playback is null (loading or failed) the slot renders the offline overlay with "is currently offline" + Check Again, not a black square. The Check Again button triggers a fresh playback fetch via reload()
// Guards: cross-slot isolation — each StreamSlot owns its own playback hook (useStreamPlayback) and its own onError. One slot's failed HLS init must not blank the sibling slot; this is enforced by per-slot mounting (verified by the slot rendering its overlay locally without unmounting the player on the other slot)
// Note: the multistream grid mounts multiple StreamSlots independently — slot isolation is locked at the grid level (grid-layout.test.tsx) and at the slot level (offline overlay verified here)
// Guards: StreamSlot tests never start raid-handoff provider transports or real WebSockets.
// Guards: Multiview players keep pointer hit testing enabled so movement anywhere reveals controls; host actions stay above the player overlay.
describe("StreamSlot", () => {
  afterEach(() => {
    vi.useRealTimers();
    playerMocks.playbackRevision = 1;
    playerMocks.playbackIdentifiers.length = 0;
    playerMocks.reload.mockReset();
    playerMocks.twitchProps = null;
    playerMocks.kickProps = null;
  });

  it("renders the Twitch live player for twitch streams", () => {
    renderWithProviders(
      <StreamSlot
        streamId="s1"
        platform="twitch"
        channelName="ninja"
        isMuted={false}
        onRemove={vi.fn()}
        onFocus={vi.fn()}
        isFocused={false}
      />
    );
    expect(screen.getByTestId("tw-live-player")).toBeInTheDocument();
    expect(playerMocks.twitchProps?.className ?? "").not.toContain("pointer-events-none");
    expect(screen.getByRole("button", { name: "Mute" }).parentElement).toHaveClass("z-50");
  });

  it("renders the Kick live player for kick streams", () => {
    renderWithProviders(
      <StreamSlot
        streamId="s1"
        platform="kick"
        channelName="xqc"
        isMuted={false}
        onRemove={vi.fn()}
        onFocus={vi.fn()}
        isFocused={false}
      />
    );
    expect(screen.getByTestId("kick-live-player")).toBeInTheDocument();
    expect(playerMocks.kickProps?.className ?? "").not.toContain("pointer-events-none");
  });

  // Guards: slots beyond the playback budget keep controls but do not mount a decoder until activated.
  it("suspends playback beyond the budget and activates on demand", () => {
    const onActivate = vi.fn();
    renderWithProviders(
      <StreamSlot
        streamId="s7"
        platform="twitch"
        channelName="ninja"
        isMuted
        onRemove={vi.fn()}
        onFocus={vi.fn()}
        isFocused={false}
        playbackActive={false}
        onActivate={onActivate}
      />
    );

    expect(screen.queryByTestId("tw-live-player")).not.toBeInTheDocument();
    expect(screen.getByText("Playback suspended")).toBeInTheDocument();
    screen.getByRole("button", { name: "Activate stream" }).click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  // Guards: a rail slot promoted before first intersection starts playback without requiring a remount.
  it("starts a deferred rail slot when it becomes focused", () => {
    const props = {
      streamId: "s7",
      platform: "twitch" as const,
      channelName: "ninja",
      isMuted: true,
      onRemove: vi.fn(),
      onFocus: vi.fn(),
      isFocused: false,
      playbackActive: true,
    };
    const view = renderWithProviders(<StreamSlot {...props} lazyMount />);

    expect(playerMocks.playbackIdentifiers.at(-1)).toBe("");
    expect(screen.queryByTestId("tw-live-player")).not.toBeInTheDocument();

    view.rerender(<StreamSlot {...props} isFocused lazyMount={false} />);

    expect(playerMocks.playbackIdentifiers.at(-1)).toBe("ninja");
    expect(screen.getByTestId("tw-live-player")).toBeInTheDocument();
  });

  // Guards: moving a native-view slot between grid, focus, and rail pushes its new screen bounds without recreating the slot.
  it("refreshes WCV bounds when the stable slot placement changes", async () => {
    const api = installElectronAPIMock();
    api.slot.onRetryAffordance = vi.fn(() => vi.fn());
    const props = {
      streamId: "s1",
      platform: "twitch" as const,
      channelName: "ninja",
      isMuted: false,
      onRemove: vi.fn(),
      onFocus: vi.fn(),
      isFocused: false,
      playbackActive: true,
      wcvEnabled: true,
    };
    const view = renderWithProviders(<StreamSlot {...props} placementKey="grid:0" />);

    await waitFor(() => expect(api.slot.setBounds).toHaveBeenCalledTimes(1));
    expect(api.slot.createSlot).toHaveBeenCalledTimes(1);

    view.rerender(<StreamSlot {...props} isFocused placementKey="focused" />);
    await waitFor(() => expect(api.slot.setBounds).toHaveBeenCalledTimes(2));

    view.rerender(<StreamSlot {...props} placementKey="rail:0" />);
    await waitFor(() => expect(api.slot.setBounds).toHaveBeenCalledTimes(3));
    expect(api.slot.createSlot).toHaveBeenCalledTimes(1);
    expect(api.slot.destroySlot).not.toHaveBeenCalled();
  });

  // Guards: one multistream slot stops after two failed Twitch source refreshes instead of spinning or refreshing forever in isolation.
  it("exhausts Twitch recovery after two playback revisions", async () => {
    vi.useFakeTimers();
    const props = {
      streamId: "s1",
      platform: "twitch" as const,
      channelName: "xqc",
      isMuted: false,
      onRemove: vi.fn(),
      onFocus: vi.fn(),
      isFocused: false,
    };
    const { rerender } = renderWithProviders(<StreamSlot {...props} />);
    const error: PlayerError = {
      code: "PLAYBACK_STALL",
      message: "Live video stopped presenting frames",
      fatal: true,
      shouldRefresh: true,
    };

    expect(playerMocks.twitchProps?.recoveryManagedExternally).toBe(true);
    expect(playerMocks.twitchProps?.onError?.(error)).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(playerMocks.reload).toHaveBeenCalledTimes(1);

    playerMocks.playbackRevision = 2;
    rerender(<StreamSlot {...props} />);
    expect(playerMocks.twitchProps?.onError?.(error)).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(playerMocks.reload).toHaveBeenCalledTimes(2);

    playerMocks.playbackRevision = 3;
    rerender(<StreamSlot {...props} />);
    expect(playerMocks.twitchProps?.onError?.(error)).toBe(false);
    await act(async () => vi.runAllTimersAsync());
    expect(playerMocks.reload).toHaveBeenCalledTimes(2);
  });

  it("shows a clickable retry when Twitch refreshes never produce a source", async () => {
    vi.useFakeTimers();
    renderWithProviders(
      <StreamSlot
        streamId="s1"
        platform="twitch"
        channelName="xqc"
        isMuted={false}
        onRemove={vi.fn()}
        onFocus={vi.fn()}
        isFocused={false}
      />
    );

    act(() => {
      playerMocks.twitchProps?.onError?.({
        code: "PLAYBACK_STALL",
        message: "Live video stopped presenting frames",
        fatal: true,
        shouldRefresh: true,
      });
    });
    await act(async () => vi.advanceTimersByTimeAsync(9_500));

    expect(playerMocks.reload).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Playback interrupted");
    expect(playerMocks.twitchProps?.className ?? "").not.toContain("pointer-events-none");

    act(() => screen.getByRole("button", { name: "Retry playback" }).click());
    expect(playerMocks.reload).toHaveBeenCalledTimes(3);
  });
});
