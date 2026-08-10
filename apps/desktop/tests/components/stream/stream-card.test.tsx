import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
} from "../../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div data-testid="thumb">{alt}</div>,
}));

vi.mock("@/components/ui/platform-avatar", () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

import { StreamCard } from "@/components/stream/stream-card";

// Guards: title/viewer-count must surface — the card is the primary way users see what's live; missing data here makes the grid look like a placeholder maze
// Guards: live badge gating — only `isLive` streams render the "Live" badge; degrading this would let offline thumbnails look live
// Guards: stream start time must not render as a thumbnail freshness badge; "3h ago" on live Kick streams reads like stale/degraded data even when it is just uptime.
// Note: image-onError fallback path is delegated to ProxiedImage (the leaf with the actual onError handler). ProxiedImage is mocked here to keep the test fast; its fallback contract is covered in proxied-image's own tests.
// Guards: verified streams render the platform-specific verified badge beside the channel username.
// Guards: watched-state cards render a distinct selected state so a live followed stream remains visibly selected while playback continues in the mini player.
// Guards: duplicate stream tags render once in first-seen order so feed cards cannot emit duplicate React keys or repeat pills.
describe("StreamCard", () => {
  beforeEach(() => {
    installElectronAPIMock();
  });

  it("renders the stream title and channel display name", () => {
    renderWithProviders(
      <StreamCard stream={fixtures.stream({ title: "My title", channelDisplayName: "NinjaX" })} />
    );
    expect(screen.getByTestId("thumb")).toHaveTextContent("My title");
    expect(screen.getAllByText("NinjaX").length).toBeGreaterThan(0);
  });

  it("renders a live badge for live streams", () => {
    renderWithProviders(<StreamCard stream={fixtures.stream({ isLive: true })} />);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("renders viewer count", () => {
    renderWithProviders(<StreamCard stream={fixtures.stream({ viewerCount: 1234 })} />);
    expect(screen.getByText(/1\.2K/i)).toBeInTheDocument();
  });

  it("renders duplicate tag labels once while preserving first-seen order", () => {
    renderWithProviders(
      <StreamCard
        stream={fixtures.stream({
          language: undefined,
          tags: ["Tactical", "Tactical", "RTS", "RTS"],
        })}
      />
    );

    expect(screen.getAllByText(/^(Tactical|RTS)$/).map((tag) => tag.textContent)).toEqual([
      "Tactical",
      "RTS",
    ]);
  });

  it("renders the Twitch verified badge beside a verified Twitch stream username", () => {
    renderWithProviders(
      <StreamCard
        stream={fixtures.stream({
          platform: "twitch",
          channelDisplayName: "PartnerStreamer",
          channelIsVerified: true,
        })}
      />
    );

    expect(screen.getByLabelText("Twitch verified")).toBeInTheDocument();
  });

  it("renders the Kick verified badge beside a verified Kick stream username", () => {
    renderWithProviders(
      <StreamCard
        stream={fixtures.stream({
          platform: "kick",
          channelDisplayName: "KickPartner",
          channelIsVerified: true,
        })}
      />
    );

    expect(screen.getByAltText("Kick verified")).toBeInTheDocument();
  });

  it("opens stream pages on the Home tab by default", () => {
    const { container } = renderWithProviders(
      <StreamCard stream={fixtures.stream({ platform: "twitch", channelName: "ninja" })} />
    );

    const link = container.querySelector('[data-testid="stream-card"]')?.closest("a");
    expect(link).toHaveAttribute("data-to", "/stream/$platform/$channel");
    expect(link).toHaveAttribute(
      "data-params",
      JSON.stringify({ platform: "twitch", channel: "ninja" })
    );
    expect(link).toHaveAttribute("data-search", JSON.stringify({ tab: "home" }));
  });

  it("renders a selected watching state when it is the current mini-player stream", () => {
    const { container } = renderWithProviders(
      <StreamCard stream={fixtures.stream({ title: "Selected stream" })} isWatching={true} />
    );

    const link = container.querySelector('[data-testid="stream-card"]')?.closest("a");
    expect(link).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("watching-badge")).toHaveTextContent("Watching");
  });

  describe("freshness badges", () => {
    it("does not show stream uptime as a last-updated badge", () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
      const { container } = renderWithProviders(
        <StreamCard stream={fixtures.stream({ platform: "kick", startedAt: threeHoursAgo })} />
      );
      const card = container.querySelector('[data-testid="stream-card"]')!;
      expect(card).not.toHaveClass("opacity-75");
      expect(screen.queryByTestId("staleness-badge")).toBeNull();
      expect(screen.queryByText("3h ago")).toBeNull();
    });
  });
});
