import { beforeEach, describe, expect, it, vi } from "vitest";

import { fixtures, renderWithProviders, routerMock, screen } from "../../test-utils";

type MockUserInfo = {
  twitchUser: unknown;
  kickUser: unknown;
  primaryUser: unknown;
  displayName: string;
  avatar: string | null;
  hasAnyUser: boolean;
};

const authMock = vi.hoisted(() => ({
  useUserInfo: vi.fn<() => MockUserInfo>(() => ({
    twitchUser: null,
    kickUser: null,
    primaryUser: null,
    displayName: "Guest",
    avatar: null,
    hasAnyUser: false,
  })),
}));

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/hooks/useAuth", () => ({
  useUserInfo: authMock.useUserInfo,
}));

vi.mock("@/components/ui/platform-avatar", () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

vi.mock("@/components/ui/follow-button", () => ({
  FollowButton: () => <button type="button">Follow</button>,
}));

import { StreamInfo } from "@/components/stream/stream-info";

// Guards: stream page channel heading renders the verified/partner badge larger than compact list badges.
// Guards: offline channel metadata shows known follower totals to every viewer instead of stale stream title/category data.
// Guards: offline channel metadata turns a valid last-live timestamp into readable relative time.
// Guards: offline channel metadata hides missing or malformed values instead of showing fabricated placeholders.
// Guards: a non-live stream payload uses offline metadata, while a live payload retains title, category, and viewer stats.
describe("StreamInfo", () => {
  beforeEach(() => {
    authMock.useUserInfo.mockReturnValue({
      twitchUser: null,
      kickUser: null,
      primaryUser: null,
      displayName: "Guest",
      avatar: null,
      hasAnyUser: false,
    });
  });

  it("renders skeletons while loading", () => {
    const { container } = renderWithProviders(
      <StreamInfo channel={null} stream={null} isLoading={true} />
    );
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("renders channel displayName and avatar", () => {
    renderWithProviders(
      <StreamInfo
        channel={fixtures.channel({ displayName: "NinjaX", isVerified: true })}
        stream={fixtures.stream({ isLive: true, title: "Going live" })}
        isLoading={false}
      />
    );
    expect(screen.getByRole("heading", { name: /ninjax/i })).toBeInTheDocument();
    expect(screen.getByTestId("avatar")).toHaveTextContent("NinjaX");
  });

  it("renders the stream page partner badge at the larger header size", () => {
    renderWithProviders(
      <StreamInfo
        channel={fixtures.channel({ displayName: "NinjaX", isPartner: true })}
        stream={fixtures.stream({ isLive: true, title: "Going live" })}
        isLoading={false}
      />
    );

    expect(screen.getByLabelText("Twitch verified")).toHaveClass("h-5", "w-5");
  });

  it("does not invent offline metadata placeholders", () => {
    renderWithProviders(
      <StreamInfo
        channel={fixtures.channel({ categoryName: undefined, lastStreamTitle: undefined })}
        stream={null}
        isLoading={false}
      />
    );

    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
    expect(screen.queryByText("No title set")).not.toBeInTheDocument();
    expect(screen.queryByText("Variety")).not.toBeInTheDocument();
  });

  it("shows follower count to a guest when the channel is offline", () => {
    renderWithProviders(
      <StreamInfo
        channel={fixtures.channel({
          followerCount: 196_800,
          lastStreamTitle: "Yesterday's title",
          categoryName: "Just Chatting",
        })}
        stream={null}
        isLoading={false}
      />
    );

    expect(screen.getByText("196.8K followers")).toBeInTheDocument();
    expect(screen.queryByText("Yesterday's title")).not.toBeInTheDocument();
    expect(screen.queryByText("Just Chatting")).not.toBeInTheDocument();
  });

  it("shows when an offline channel was last live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T18:00:00Z"));

    try {
      const channel = {
        ...fixtures.channel(),
        lastLiveAt: "2026-08-02T07:00:00Z",
      };

      renderWithProviders(<StreamInfo channel={channel} stream={null} isLoading={false} />);

      expect(screen.getByText("Last live 11 hours ago")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides a malformed last-live timestamp", () => {
    const channel = {
      ...fixtures.channel(),
      lastLiveAt: "not-a-timestamp",
    };

    renderWithProviders(<StreamInfo channel={channel} stream={null} isLoading={false} />);

    expect(screen.queryByText(/Last live/i)).not.toBeInTheDocument();
  });

  it("treats a non-live stream payload as offline", () => {
    renderWithProviders(
      <StreamInfo
        channel={fixtures.channel({ followerCount: 42 })}
        stream={fixtures.stream({
          isLive: false,
          title: "Ended stream title",
          categoryName: "Ended category",
        })}
        isLoading={false}
      />
    );

    expect(screen.getByText("42 followers")).toBeInTheDocument();
    expect(screen.queryByText("Ended stream title")).not.toBeInTheDocument();
    expect(screen.queryByText("Ended category")).not.toBeInTheDocument();
  });

  it("keeps live title, category, and viewer stats in place", () => {
    renderWithProviders(
      <StreamInfo
        channel={fixtures.channel({
          followerCount: 999,
          lastLiveAt: "2026-08-01T07:00:00Z",
        })}
        stream={fixtures.stream({
          isLive: true,
          title: "Current stream title",
          categoryName: "Current category",
          viewerCount: 1_234,
        })}
        isLoading={false}
      />
    );

    expect(screen.getByText("Current stream title")).toBeInTheDocument();
    expect(screen.getByText("Current category")).toBeInTheDocument();
    expect(screen.getByText("1.2K")).toBeInTheDocument();
    expect(screen.queryByText("999 followers")).not.toBeInTheDocument();
    expect(screen.queryByText(/Last live/i)).not.toBeInTheDocument();
  });

  it("renders owner Kick profile with followers instead of follow action or stream metadata", () => {
    authMock.useUserInfo.mockReturnValue({
      twitchUser: null,
      kickUser: {
        id: 15132726,
        username: "anonsociety",
        slug: "anonsociety",
        profilePic: "https://example.com/kick-avatar.png",
        verified: true,
      },
      primaryUser: null,
      displayName: "anonsociety",
      avatar: "https://example.com/kick-avatar.png",
      hasAnyUser: true,
    });

    renderWithProviders(
      <StreamInfo
        channel={fixtures.channel({
          platform: "kick",
          username: "anonsociety",
          displayName: "anonsociety",
          followerCount: 4,
          kickUserId: "15132726",
          lastStreamTitle: "Real stream title",
          categoryName: "Just Chatting",
        })}
        stream={fixtures.stream({
          platform: "kick",
          title: "Live title",
          categoryName: "Minecraft",
          tags: ["English"],
          isLive: true,
        })}
        isLoading={false}
      />
    );

    const heading = screen.getByRole("heading", { name: /anonsociety/i });
    const followerCount = screen.getByText("4 followers");
    expect(heading.parentElement).toContainElement(followerCount);
    expect(screen.queryByRole("button", { name: "Follow" })).not.toBeInTheDocument();
    expect(screen.queryByText("Live title")).not.toBeInTheDocument();
    expect(screen.queryByText("Minecraft")).not.toBeInTheDocument();
    expect(screen.queryByText("Real stream title")).not.toBeInTheDocument();
    expect(screen.queryByText("Just Chatting")).not.toBeInTheDocument();
  });
});
