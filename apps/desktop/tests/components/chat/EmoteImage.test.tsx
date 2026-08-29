import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmoteImage } from "@/features/chat/components/chat/EmoteImage";

const emote = {
  id: "e1",
  name: "Kappa",
  provider: "twitch" as const,
  isGlobal: false,
  isAnimated: false,
  isZeroWidth: false,
  urls: {
    url1x: "https://x.test/1x.png",
    url2x: "https://x.test/2x.png",
    url4x: "https://x.test/4x.png",
  },
};

// Guards: loading state hides the emote behind a pulsing placeholder and reveals it only after onLoad — prevents zero-width emote flash before the CDN responds
// Guards: error state (CDN 404 / blocked) renders the emote name as text fallback so the message stays readable even when 7TV/BTTV serves a 404
// Guards: 7TV picker/grid images retry once on the official IPv4 edge before the readable-name fallback
// Guards: deferred loading reserves emote layout without attaching a src while the picker is fast-scrolling, preventing CDN request bursts
// Guards: loaded emote URLs remount without returning to a loading skeleton, preventing virtualized-picker flash during fast scroll
// Guards: a successfully loaded official 7TV fallback is reused from cache so remounts do not retry the failed canonical host
// Guards: a virtualized picker cell reused for a new emote URL resets prior load/error state instead of showing stale content
describe("EmoteImage", () => {
  it("renders the emote with name as alt", () => {
    render(<EmoteImage emote={emote} />);
    expect(screen.getByAltText("Kappa")).toBeInTheDocument();
  });

  it("selects the URL appropriate to the size", () => {
    render(<EmoteImage emote={emote} size="xlarge" />);
    expect(screen.getByAltText("Kappa")).toHaveAttribute("src", "https://x.test/4x.png");
  });

  it("fires onClick when provided", () => {
    const onClick = vi.fn();
    render(<EmoteImage emote={emote} onClick={onClick} />);
    fireEvent.click(screen.getByAltText("Kappa"));
    expect(onClick).toHaveBeenCalledWith(emote);
  });

  it("error: shows the emote name as text fallback when the CDN serves a 404 / blocked image", () => {
    render(<EmoteImage emote={emote} />);
    fireEvent.error(screen.getByAltText("Kappa"));
    expect(screen.getByText("Kappa")).toBeInTheDocument();
  });

  it("retries a failed 7TV picker image once on the official IPv4 edge", () => {
    const sevenTvEmote = {
      ...emote,
      id: "seven",
      name: "SevenTV",
      provider: "7tv" as const,
      urls: {
        url1x: "https://cdn.7tv.app/emote/seven/1x.webp",
        url2x: "https://cdn.7tv.app/emote/seven/2x.webp?animated=true",
        url4x: "https://cdn.7tv.app/emote/seven/4x.webp",
      },
    };
    render(<EmoteImage emote={sevenTvEmote} />);

    fireEvent.error(screen.getByAltText("SevenTV"));
    expect(screen.getByAltText("SevenTV")).toHaveAttribute(
      "src",
      "https://ipv4-1.eu.cdn.7tv.app/emote/seven/2x.webp?animated=true"
    );
  });

  it("resets a failed image attempt when a virtualized cell receives a new URL", () => {
    const failedEmote = {
      ...emote,
      id: "failed-seven",
      name: "FailedSeven",
      provider: "7tv" as const,
      urls: {
        url1x: "https://cdn.7tv.app/emote/failed/1x.webp",
        url2x: "https://cdn.7tv.app/emote/failed/2x.webp",
        url4x: "https://cdn.7tv.app/emote/failed/4x.webp",
      },
    };
    const nextEmote = {
      ...emote,
      id: "next-seven",
      name: "NextSeven",
      provider: "7tv" as const,
      urls: {
        url1x: "https://cdn.7tv.app/emote/next/1x.webp",
        url2x: "https://cdn.7tv.app/emote/next/2x.webp",
        url4x: "https://cdn.7tv.app/emote/next/4x.webp",
      },
    };
    const view = render(<EmoteImage emote={failedEmote} />);

    fireEvent.error(screen.getByAltText("FailedSeven"));
    fireEvent.error(screen.getByAltText("FailedSeven"));
    expect(screen.getByText("FailedSeven")).toBeInTheDocument();

    view.rerender(<EmoteImage emote={nextEmote} />);
    expect(screen.getByAltText("NextSeven")).toHaveAttribute(
      "src",
      "https://cdn.7tv.app/emote/next/2x.webp"
    );
  });

  it("loading: keeps the loading placeholder (animate-pulse) on screen until onLoad fires", () => {
    const { container } = render(<EmoteImage emote={emote} />);
    // The placeholder span is rendered with animate-pulse until the image's
    // onLoad fires. We never fire it here, so the placeholder stays.
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("deferred loading: reserves a placeholder without creating an image request until released", () => {
    const { container, rerender } = render(<EmoteImage emote={emote} deferLoad={true} />);

    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByAltText("Kappa")).not.toBeInTheDocument();

    rerender(<EmoteImage emote={emote} deferLoad={false} />);

    expect(screen.getByAltText("Kappa")).toHaveAttribute("src", "https://x.test/2x.png");
  });

  it("deferred loading: can reserve static layout without running placeholder animation", () => {
    const staticEmote = {
      ...emote,
      id: "e-static",
      urls: {
        url1x: "https://static.test/1x.png",
        url2x: "https://static.test/2x.png",
        url4x: "https://static.test/4x.png",
      },
    };

    const { container } = render(
      <EmoteImage emote={staticEmote} deferLoad={true} deferredPlaceholder="static" />
    );

    expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument();
    expect(container.querySelector(".bg-neutral-700")).toBeInTheDocument();
    expect(screen.queryByAltText("Kappa")).not.toBeInTheDocument();
  });

  it("loaded URL cache: remounts a loaded emote without flashing a skeleton", () => {
    const cachedEmote = {
      ...emote,
      id: "e-cached",
      urls: {
        url1x: "https://cached.test/1x.png",
        url2x: "https://cached.test/2x.png",
        url4x: "https://cached.test/4x.png",
      },
    };

    const { unmount } = render(<EmoteImage emote={cachedEmote} />);
    fireEvent.load(screen.getByAltText("Kappa"));
    unmount();

    const remount = render(<EmoteImage emote={cachedEmote} />);

    expect(remount.container.querySelector(".animate-pulse")).not.toBeInTheDocument();
    expect(screen.getByAltText("Kappa")).toHaveAttribute("src", "https://cached.test/2x.png");
  });

  it("loaded URL cache: remounts a successful 7TV fallback without retrying the failed host", () => {
    const fallbackCachedEmote = {
      ...emote,
      id: "fallback-cached",
      name: "FallbackCached",
      provider: "7tv" as const,
      urls: {
        url1x: "https://cdn.7tv.app/emote/fallback-cached/1x.webp",
        url2x: "https://cdn.7tv.app/emote/fallback-cached/2x.webp",
        url4x: "https://cdn.7tv.app/emote/fallback-cached/4x.webp",
      },
    };
    const { unmount } = render(<EmoteImage emote={fallbackCachedEmote} />);
    fireEvent.error(screen.getByAltText("FallbackCached"));
    const fallback = screen.getByAltText("FallbackCached");
    fireEvent.load(fallback);
    unmount();

    const remount = render(<EmoteImage emote={fallbackCachedEmote} />);
    expect(remount.container.querySelector(".animate-pulse")).not.toBeInTheDocument();
    expect(screen.getByAltText("FallbackCached")).toHaveAttribute(
      "src",
      "https://ipv4-1.eu.cdn.7tv.app/emote/fallback-cached/2x.webp"
    );
  });
});
