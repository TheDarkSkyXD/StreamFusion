import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtures, renderWithProviders, routerMock, screen } from "../../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/hooks/useAuth", () => ({
  useUserInfo: () => ({
    twitchUser: null,
    kickUser: null,
    primaryUser: null,
    displayName: "Guest",
    avatar: null,
    hasAnyUser: false,
  }),
}));

vi.mock("@/components/ui/platform-avatar", () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

vi.mock("@/components/ui/follow-button", () => ({
  FollowButton: () => <button type="button">Follow</button>,
}));

import { StreamInfo } from "@/components/stream/stream-info";

// Guards: an offline channel's last-live age is measured from the stream end, not its start.
// Guards: a live channel never presents historical last-live metadata as its current state.
// Guards: unknown or malformed end metadata stays hidden instead of producing a false age.
describe("StreamInfo last-live regression", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows minutes since an eight-hour stream ended", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T13:49:08Z"));

    renderWithProviders(
      <StreamInfo
        channel={fixtures.channel({
          platform: "kick",
          username: "iceposeidon",
          displayName: "IcePoseidon",
          lastLiveAt: "2026-08-03T13:36:17Z",
        })}
        stream={null}
        isLoading={false}
      />
    );

    expect(screen.getByText("Last live 12 minutes ago")).toBeInTheDocument();
    expect(screen.queryByText("Last live 8 hours ago")).not.toBeInTheDocument();
  });

  it("hides the offline last-live label while the channel is live", () => {
    renderWithProviders(
      <StreamInfo
        channel={fixtures.channel({
          platform: "kick",
          username: "iceposeidon",
          displayName: "IcePoseidon",
          lastLiveAt: "2026-08-03T13:36:17Z",
        })}
        stream={fixtures.stream({
          platform: "kick",
          isLive: true,
          startedAt: "2026-08-03T14:00:00Z",
        })}
        isLoading={false}
      />
    );

    expect(screen.queryByText(/Last live/i)).not.toBeInTheDocument();
  });

  it("hides the last-live label when the stream end is unknown or invalid", () => {
    const channel = fixtures.channel({
      platform: "kick",
      username: "iceposeidon",
      displayName: "IcePoseidon",
      lastLiveAt: undefined,
    });
    const view = renderWithProviders(
      <StreamInfo channel={channel} stream={null} isLoading={false} />
    );

    expect(screen.queryByText(/Last live/i)).not.toBeInTheDocument();

    view.rerender(
      <StreamInfo
        channel={{ ...channel, lastLiveAt: "not-a-timestamp" }}
        stream={null}
        isLoading={false}
      />
    );

    expect(screen.queryByText(/Last live/i)).not.toBeInTheDocument();
  });
});
