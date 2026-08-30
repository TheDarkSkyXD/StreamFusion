import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatBadge } from "@/features/chat/components/chat/ChatBadge";
import { renderWithProviders } from "../../test-utils";

// Guards: loading state (no imageUrl yet from badge-set fetch) renders null instead of a broken-image icon — the message line stays clean while the badge metadata resolves
// Guards: role and cosmetic badges retain deferred loading while subscription badges are prioritized (regression 67fdc95)
// Guards: mounted subscription badges load eagerly in virtualized live chat (regression 67fdc95)
// Guards: Kick subscription badges use the Electron image proxy in both the row and tooltip (regression 67fdc95)
describe("ChatBadge", () => {
  it("loading: renders nothing when no imageUrl is provided (badge metadata pending)", () => {
    const { container } = renderWithProviders(<ChatBadge badge={{ title: "mod" }} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the image with alt text from badge title", () => {
    renderWithProviders(
      <ChatBadge badge={{ imageUrl: "https://x.test/b.png", title: "Moderator" }} />
    );
    const image = screen.getByAltText("Moderator");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("fetchpriority", "low");
  });

  it("starts mounted Twitch subscription badges without lazy or low-priority hints", () => {
    renderWithProviders(
      <ChatBadge
        badge={{
          setId: "subscriber",
          version: "6",
          imageUrl: "https://static-cdn.jtvnw.net/badges/v1/subscriber/3",
          title: "6-Month Subscriber",
        }}
        platform="twitch"
      />
    );

    const image = screen.getByAltText("6-Month Subscriber");
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("fetchpriority", "auto");
  });

  it("proxies a Kick subscription badge for both the chat row and tooltip", () => {
    const sourceUrl = "https://files.kick.com/channel_subscriber_badges/97968/original";
    const badge = {
      setId: "subscriber",
      version: "12",
      imageUrl: sourceUrl,
      title: "12-Month Subscriber",
    };

    renderWithProviders(<ChatBadge badge={badge} platform="kick" />);

    const image = screen.getByAltText("12-Month Subscriber");
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("fetchpriority", "auto");
    expect(image.getAttribute("src")).toMatch(/^kick-image:\/\/image\?u=/);

    fireEvent.mouseEnter(image, { clientX: 10, clientY: 10 });
    const images = screen.getAllByAltText("12-Month Subscriber");
    expect(images).toHaveLength(2);
    expect(new Set(images.map((item) => item.getAttribute("src")))).toEqual(
      new Set([image.getAttribute("src")])
    );
    expect(badge.imageUrl).toBe(sourceUrl);
  });

  it("applies valid FFZ tile colors and ignores invalid values", () => {
    const view = renderWithProviders(
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
    renderWithProviders(
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
});
