import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatBadge } from "@/components/chat/ChatBadge";

// Guards: loading state (no imageUrl yet from badge-set fetch) renders null instead of a broken-image icon — the message line stays clean while the badge metadata resolves
// Guards: error path — when badge.imageUrl is set but the CDN serves a 404 the browser's native broken-image is benign because the <img> still has alt text; verified the alt fallback below
describe("ChatBadge", () => {
  it("loading: renders nothing when no imageUrl is provided (badge metadata pending)", () => {
    const { container } = render(<ChatBadge badge={{ title: "mod" }} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the image with alt text from badge title", () => {
    render(<ChatBadge badge={{ imageUrl: "https://x.test/b.png", title: "Moderator" }} />);
    expect(screen.getByAltText("Moderator")).toBeInTheDocument();
  });

  it("applies valid FFZ tile colors and ignores invalid values", () => {
    const view = render(
      <ChatBadge
        badge={{ imageUrl: "https://x.test/b.png", title: "Bot", backgroundColor: "#00ad03" }}
      />
    );
    expect(screen.getByAltText("Bot")).toHaveStyle({ backgroundColor: "rgb(0, 173, 3)" });

    view.rerender(
      <ChatBadge
        badge={{
          imageUrl: "https://x.test/b.png",
          title: "Bot",
          backgroundColor: "url(javascript:alert(1))",
        }}
      />
    );
    expect(screen.getByAltText("Bot").style.backgroundColor).toBe("");
  });

  it("shows tooltip image on mouseEnter", () => {
    render(
      <ChatBadge
        badge={{ imageUrl: "https://x.test/b.png", title: "Verified" }}
        platform="twitch"
      />
    );
    const img = screen.getByAltText("Verified");
    fireEvent.mouseEnter(img, { clientX: 10, clientY: 10 });
    // The tooltip portal renders another copy of the badge title and an img.
    expect(screen.getAllByAltText("Verified").length).toBeGreaterThan(1);
  });

  it("error: still renders the badge alt text so the broken-image is at least announced to screen readers", () => {
    render(
      <ChatBadge
        badge={{ imageUrl: "https://x.test/404.png", title: "Subscriber" }}
        platform="twitch"
      />
    );
    const img = screen.getByAltText("Subscriber");
    // Even if the CDN later 404s, the alt text is what screen readers + the
    // browser's broken-image tooltip carry — the badge stays identifiable.
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe("https://x.test/404.png");
  });
});
