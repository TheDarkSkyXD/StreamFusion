import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: React.PropsWithChildren) => <a href="#category">{children}</a>,
}));

import { ClipCard } from "@/features/playback/components/related-content/ClipCard";

describe("ClipCard", () => {
  it("exposes clip playback as a keyboard-accessible button", () => {
    const onClick = vi.fn();

    render(
      <ClipCard
        clip={{
          id: "clip-1",
          title: "Final round",
          duration: "0:30",
          views: "1200",
          date: "2026-08-30T00:00:00.000Z",
          thumbnailUrl: "https://example.test/clip.jpg",
          category: "League of Legends",
          gameId: "21779",
        }}
        onClick={onClick}
        platform="twitch"
        channelName="streamer"
        channelData={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Play clip Final round" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
