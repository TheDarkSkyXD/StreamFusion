import { act, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

import { PinnedMessageBanner } from "@/components/chat/PinnedMessageBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NormalizedPinnedMessage } from "@/shared/chat-types";

// Radix's Tooltip needs a TooltipProvider in the React tree. The app mounts
// one at the root; tests wrap each render here. Override the returned
// `rerender` so calls to it also wrap the new JSX with the provider.
function render(ui: React.ReactElement) {
  const result = rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
  const wrappedRerender = (newUi: React.ReactElement) =>
    result.rerender(<TooltipProvider>{newUi}</TooltipProvider>);
  return { ...result, rerender: wrappedRerender };
}

async function expectWhiteTooltip(label: string) {
  const tooltips = await screen.findAllByText(label);
  expect(tooltips).not.toHaveLength(0);
  expect(tooltips[0].className).toContain("!bg-white");
  expect(tooltips[0].className).toContain("!text-[#0e0e10]");
  expect(tooltips[0].querySelector("svg")?.className.baseVal).toContain("!fill-white");
}

async function expectWhiteTooltipMatching(pattern: RegExp) {
  const tooltips = await screen.findAllByText((text) => pattern.test(text));
  expect(tooltips).not.toHaveLength(0);
  expect(tooltips[0].className).toContain("!bg-white");
  expect(tooltips[0].className).toContain("!text-[#0e0e10]");
  expect(tooltips[0].querySelector("svg")?.className.baseVal).toContain("!fill-white");
}

function makePin(overrides: Partial<NormalizedPinnedMessage> = {}): NormalizedPinnedMessage {
  return {
    platform: "kick",
    messageId: "msg-1",
    pinRecordId: "msg-1",
    author: { username: "alice", displayName: "Alice", color: "#FF7F50", badges: [] },
    content: [{ type: "text", content: "check the bracket" }],
    pinnedBy: { username: "modbot", color: "#FF6F61", badges: [] },
    pinnedAt: "2026-05-17T12:00:00.000Z",
    sentAt: "2026-05-17T11:59:00.000Z",
    expiresAt: null,
    ...overrides,
  };
}

// Guards: pin metadata empty paths (pinnedBy=null → "Pinned message" fallback; sentAt=null → timestamp omitted; no badges → header still renders) must never throw — the banner is rendered eagerly while the GQL pin poller resolves
// Guards: viewer vs mod role gating — viewers see the expanded hide-eye button, while Twitch mods get Hide for yourself and Unpin message inside the options menu
// Guards: Unpin is a direct action and never swaps to a separate confirmation button
// Guards: long-content paths (truncate-safe usernames, collapsed preview, expanded Twitch-style scroll area, break-all on link fragments) — the banner must not push siblings off-screen at multistream's ~280px slot floor
// Exempt: no async branch in source — pin data is delivered via prop from the upstream Twitch GQL pin poller / Kick Pusher event. Loading/error live in the poller; the empty state ("no pinned message") is "parent omits the banner entirely", validated at PinnedMessageBanner's consumer (TwitchChat / KickChat).
// Guards: mention fragments render as @username in pinned-message bodies without duplicating an existing @ prefix
// Guards: pinned-message cards use the same neutral-800 surface as the global search input across platforms
// Guards: pinned-by usernames render every visible badge the user has instead of only the highest-priority role badge
// Guards: pinned-message banner floats over the chat list instead of consuming scroll layout space
// Guards: pinned-message usernames stay keyboard/click accessible so they can open the user popout when chat provides channel context
// Guards: timed Twitch pins render the native-style duration progress bar with hover time-left tooltip while Kick pins never show duration UI.
// Guards: pinned-message banners never render a Reply action; replies belong to regular chat rows only.
// Guards: "Pinned by" renders platform display-name casing while preserving the login for user identity.
// Guards: Twitch mod pins put duration controls and Unpin behind a three-dot menu, with Apply required for preset and custom duration changes.
// Guards: emote fragments in pinned messages render as actual emote images instead of plain text codes.
describe("PinnedMessageBanner", () => {
  it("renders pinnedBy label and content (no author prefix on body — Twitch-faithful)", () => {
    render(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/Pinned by/)).toBeInTheDocument();
    expect(screen.getByText("modbot")).toBeInTheDocument();
    // Body shows just the message content — no "alice:" prefix. Twitch's
    // native pin card omits the sender entirely in collapsed state; the
    // "Pinned by X" header is the only attribution.
    expect(screen.queryByText("alice:")).not.toBeInTheDocument();
    expect(screen.getByTestId("pinned-message-content")).toHaveTextContent("check the bracket");
  });

  it("renders mention fragments with a single @ prefix", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          content: [
            { type: "text", content: "hey " },
            { type: "mention", username: "alice" },
            { type: "text", content: " " },
            { type: "mention", username: "@bob" },
          ],
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />
    );

    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(screen.queryByText("@@bob")).not.toBeInTheDocument();
  });

  it("renders emote fragments as actual emote images", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          platform: "twitch",
          content: [
            { type: "text", content: "look " },
            {
              type: "emote",
              id: "25",
              name: "Kappa",
              url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0",
            },
          ],
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />
    );

    const emote = screen.getByRole("img", { name: "Kappa" });
    expect(emote).toHaveAttribute(
      "src",
      "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0"
    );
    expect(screen.queryByText("Kappa")).toBeNull();
  });

  it("floats as an overlay while only the card captures pointer events", () => {
    render(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />
    );

    const banner = screen.getByTestId("pinned-message-banner");
    expect(banner.className).toContain("absolute");
    expect(banner.className).toContain("z-20");
    expect(banner.className).toContain("pointer-events-none");
    expect(banner.firstElementChild).toHaveClass("pointer-events-auto");
  });

  it("renders pinnedBy and pinned author usernames as clickable username controls", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          author: {
            userId: "author-1",
            username: "alice",
            displayName: "Alice",
            color: "#FF7F50",
            badges: [],
          },
          pinnedBy: {
            userId: "mod-1",
            username: "modbot",
            displayName: "ModBot",
            color: "#FF6F61",
            badges: [],
          },
        })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        currentChannelContext={{ channelId: "channel-1", channelSlug: "fitzbro" }}
      />
    );

    const pinnedByUsername = screen.getByRole("button", { name: "ModBot" });
    const authorUsername = screen.getByRole("button", { name: "Alice" });
    expect(pinnedByUsername).toHaveClass("cursor-pointer");
    expect(authorUsername).toHaveClass("cursor-pointer");
  });

  it("renders pinnedBy with platform display-name casing while keeping login identity", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          pinnedBy: {
            userId: "mod-1",
            username: "darkskyfullofstars",
            displayName: "DarkSkyFullOfStars",
            color: "#1E90FF",
            badges: [],
          },
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />
    );

    const pinnedByUsername = screen.getByRole("button", { name: "DarkSkyFullOfStars" });
    expect(pinnedByUsername).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "darkskyfullofstars" })).toBeNull();
    expect(pinnedByUsername.querySelector("[data-a-user]")).toHaveAttribute(
      "data-a-user",
      "darkskyfullofstars"
    );
  });

  it("shows every visible badge next to the pinnedBy username", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          pinnedBy: {
            username: "fitzbro",
            color: "#008000",
            badges: [
              {
                setId: "broadcaster",
                version: "1",
                imageUrl: "https://example/b/1",
                title: "Broadcaster",
              },
              {
                setId: "subscriber",
                version: "12",
                imageUrl: "https://example/s/1",
                title: "1-Year Sub",
              },
              {
                setId: "verified",
                version: "1",
                imageUrl: "https://example/v/1",
                title: "Verified",
              },
            ],
          },
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />
    );
    const header = screen.getByTestId("pinned-message-header");
    const headerImgs = header.querySelectorAll("img");
    expect(headerImgs.length).toBe(3);
    expect(headerImgs[0].getAttribute("alt")).toBe("Broadcaster");
    expect(headerImgs[1].getAttribute("alt")).toBe("1-Year Sub");
    expect(headerImgs[2].getAttribute("alt")).toBe("Verified");
  });

  it("renders all Twitch pinnedBy badges in their payload order", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          platform: "twitch",
          pinnedBy: {
            username: "fitzbro",
            color: "#008000",
            badges: [
              {
                setId: "broadcaster",
                version: "1",
                imageUrl: "https://example/b/1",
                title: "Broadcaster",
              },
              { setId: "partner", version: "1", imageUrl: "https://example/p/1", title: "Partner" },
            ],
          },
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />
    );

    const header = screen.getByTestId("pinned-message-header");
    const headerImgs = header.querySelectorAll("img");
    expect(headerImgs.length).toBe(2);
    expect(headerImgs[0].getAttribute("alt")).toBe("Broadcaster");
    expect(headerImgs[1].getAttribute("alt")).toBe("Partner");
  });

  it("renders all pinnedBy badges when no role badge is present", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          pinnedBy: {
            username: "alice",
            color: "#FF7F50",
            badges: [
              {
                setId: "subscriber",
                version: "12",
                imageUrl: "https://example/s/1",
                title: "1-Year Sub",
              },
              {
                setId: "unknown_set",
                version: "1",
                imageUrl: "https://example/u/1",
                title: "Unknown",
              },
            ],
          },
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />
    );
    const header = screen.getByTestId("pinned-message-header");
    const headerImgs = header.querySelectorAll("img");
    expect(headerImgs.length).toBe(2);
    expect(headerImgs[0].getAttribute("alt")).toBe("1-Year Sub");
    expect(headerImgs[1].getAttribute("alt")).toBe("Unknown");
  });

  it("renders the sender-attribution row only when expanded, with badges + timestamp", () => {
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({
          author: {
            username: "smokey",
            displayName: "Smokey",
            color: "#FF7F50",
            badges: [
              {
                setId: "partner",
                version: "1",
                imageUrl: "https://example/p/1",
                title: "Verified",
              },
            ],
          },
          sentAt: "2026-05-18T01:54:00.000Z",
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />
    );
    // Collapsed: no sender row.
    expect(screen.queryByTestId("pinned-message-sender-row")).not.toBeInTheDocument();

    rerender(
      <PinnedMessageBanner
        pin={makePin({
          author: {
            username: "smokey",
            displayName: "Smokey",
            color: "#FF7F50",
            badges: [
              {
                setId: "partner",
                version: "1",
                imageUrl: "https://example/p/1",
                title: "Verified",
              },
            ],
          },
          sentAt: "2026-05-18T01:54:00.000Z",
        })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
      />
    );
    // One combined row at the bottom: [badges] username sent at HH:MM PM.
    const senderRow = screen.getByTestId("pinned-message-sender-row");
    expect(senderRow).toBeInTheDocument();
    expect(senderRow.querySelector('img[alt="Verified"]')).toBeInTheDocument();
    expect(senderRow).toHaveTextContent("Smokey");
    // Timestamp lives inside the same sender row, after the username.
    expect(senderRow).toHaveTextContent(/sent at/);
    const timestamp = screen.getByTestId("pinned-message-timestamp");
    expect(senderRow).toContainElement(timestamp);
  });

  it("places the bottom attribution row AFTER the message body", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          content: [{ type: "text", content: "test message" }],
          sentAt: "2026-05-18T01:54:00.000Z",
        })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
      />
    );
    const content = screen.getByTestId("pinned-message-content");
    const senderRow = screen.getByTestId("pinned-message-sender-row");
    // DOM order: bottom attribution row follows the message body.
    expect(content.compareDocumentPosition(senderRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("omits the timestamp entirely when sentAt is null (sender row still renders)", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({ sentAt: null })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
      />
    );
    // Bottom attribution row still renders for badges + username.
    expect(screen.getByTestId("pinned-message-sender-row")).toBeInTheDocument();
    // But the timestamp inside it is omitted.
    expect(screen.queryByTestId("pinned-message-timestamp")).not.toBeInTheDocument();
  });

  it("renders pinnedBy badges inline before the username", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          pinnedBy: {
            username: "fitzbro",
            color: "#008000",
            badges: [
              {
                setId: "broadcaster",
                version: "1",
                imageUrl: "https://static-cdn.jtvnw.net/badges/v1/5527c58c/1",
                title: "Broadcaster",
              },
            ],
          },
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />
    );
    const badgeImg = screen.getByAltText("Broadcaster");
    expect(badgeImg).toBeInTheDocument();
    expect(badgeImg.getAttribute("src")).toContain("static-cdn.jtvnw.net");
    // Badge is in the header (left of the username), not in the message body.
    const header = screen.getByTestId("pinned-message-header");
    expect(header).toContainElement(badgeImg);
  });

  it('falls back to "Pinned message" when pinnedBy is null', () => {
    render(
      <PinnedMessageBanner
        pin={makePin({ pinnedBy: null })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText("Pinned message")).toBeInTheDocument();
    expect(screen.queryByText(/Pinned by/)).not.toBeInTheDocument();
  });

  it("AE1: renders the same shared component shape for Twitch and Kick", () => {
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({ platform: "kick" })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    const kickBanner = screen.getByTestId("pinned-message-banner");
    expect(kickBanner.getAttribute("data-platform")).toBe("kick");
    const kickClasses = kickBanner.className;

    rerender(
      <PinnedMessageBanner
        pin={makePin({ platform: "twitch" })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    const twitchBanner = screen.getByTestId("pinned-message-banner");
    expect(twitchBanner.getAttribute("data-platform")).toBe("twitch");
    // Same component, same outer classes — only the data-platform attr varies.
    expect(twitchBanner.className).toBe(kickClasses);
  });

  it("uses the shared global-search neutral-800 card surface for both platforms", () => {
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({ platform: "kick" })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    const kickCard = screen.getByTestId("pinned-message-banner").firstElementChild;
    expect(kickCard).toHaveClass("bg-neutral-800");
    expect(kickCard).toHaveClass("cursor-pointer");
    expect(kickCard).toHaveStyle({
      borderColor: "rgba(240, 241, 242, 0.16)",
    });

    rerender(
      <PinnedMessageBanner
        pin={makePin({ platform: "twitch" })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    const twitchCard = screen.getByTestId("pinned-message-banner").firstElementChild;
    expect(twitchCard).toHaveClass("bg-neutral-800");
    expect(twitchCard).toHaveClass("cursor-pointer");
  });

  it("renders Twitch timed-pin duration progress with Twitch-native sizing and colors when expanded", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:05:00.000Z"));

    try {
      render(
        <PinnedMessageBanner
          pin={makePin({
            platform: "twitch",
            pinnedAt: "2026-05-17T12:00:00.000Z",
            expiresAt: "2026-05-17T12:10:00.000Z",
          })}
          viewerRole="viewer"
          isExpanded={true}
          onExpandToggle={() => {}}
        />
      );

      const progress = screen.getByRole("progressbar", { name: "Pinned message duration" });
      const fill = screen.getByTestId("pinned-message-duration-progress-fill");
      expect(progress).toHaveAttribute("aria-valuemin", "0");
      expect(progress).toHaveAttribute("aria-valuemax", "100");
      expect(progress).toHaveAttribute("aria-valuenow", "50");
      expect(progress).toHaveAttribute("aria-valuetext", "5m 0s left");
      expect(progress).toHaveClass("h-1");
      expect(progress).toHaveClass("rounded-[9000px]");
      expect(progress).toHaveClass("bg-[rgba(83,83,95,0.55)]");
      expect(progress.className).toContain("group-hover:bg-[rgba(83,83,95,0.78)]");
      expect(fill).toHaveClass("bg-[#A970FF]");
      expect(fill.className).toContain("group-hover:bg-[#BF94FF]");
      expect(fill.className).toContain("duration-[250ms]");
      expect(fill.className).toContain("ease-linear");
      expect(fill).toHaveStyle({ width: "50%" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows remaining time in a Twitch-style tooltip when hovering the duration progress", async () => {
    const now = Date.now();
    render(
      <PinnedMessageBanner
        pin={makePin({
          platform: "twitch",
          pinnedAt: new Date(now - 5 * 60_000).toISOString(),
          expiresAt: new Date(now + 5 * 60_000).toISOString(),
        })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
      />
    );

    const progressSlot = screen.getByTestId("pinned-message-duration-progress-slot");
    expect(progressSlot).toHaveClass("cursor-pointer");
    fireEvent.pointerMove(progressSlot);
    fireEvent.pointerEnter(progressSlot);

    await expectWhiteTooltipMatching(/[45]m \d+s left/);
  });

  it("updates the Twitch timed-pin progress while the banner stays mounted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:05:00.000Z"));

    try {
      render(
        <PinnedMessageBanner
          pin={makePin({
            platform: "twitch",
            pinnedAt: "2026-05-17T12:00:00.000Z",
            expiresAt: "2026-05-17T12:10:00.000Z",
          })}
          viewerRole="viewer"
          isExpanded={true}
          onExpandToggle={() => {}}
        />
      );

      vi.setSystemTime(new Date("2026-05-17T12:07:29.000Z"));
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(screen.getByRole("progressbar", { name: "Pinned message duration" })).toHaveAttribute(
        "aria-valuenow",
        "25"
      );
      expect(screen.getByRole("progressbar", { name: "Pinned message duration" })).toHaveAttribute(
        "aria-valuetext",
        "2m 30s left"
      );
      expect(screen.getByTestId("pinned-message-duration-progress-fill")).toHaveStyle({
        width: "25%",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not render duration progress for Kick pins or Twitch pins without valid timing", () => {
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({
          platform: "kick",
          pinnedAt: "2026-05-17T12:00:00.000Z",
          expiresAt: "2026-05-17T12:10:00.000Z",
        })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
      />
    );
    expect(screen.queryByRole("progressbar", { name: "Pinned message duration" })).toBeNull();

    rerender(
      <PinnedMessageBanner
        pin={makePin({
          platform: "twitch",
          pinnedAt: "not-a-date",
          expiresAt: "2026-05-17T12:10:00.000Z",
        })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
      />
    );
    expect(screen.queryByRole("progressbar", { name: "Pinned message duration" })).toBeNull();
  });

  it("does not render Twitch timed-pin duration progress while collapsed", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          platform: "twitch",
          pinnedAt: "2026-05-17T12:00:00.000Z",
          expiresAt: "2026-05-17T12:10:00.000Z",
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />
    );

    expect(screen.queryByRole("progressbar", { name: "Pinned message duration" })).toBeNull();
    expect(screen.queryByTestId("pinned-message-duration-progress-slot")).toBeNull();
  });

  it("does NOT render the hide button in collapsed state (matches Twitch native)", () => {
    render(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
        onUnpin={() => {}}
      />
    );
    // Twitch's collapsed pin card has only the Expand chevron — the
    // "Hide for yourself" button appears only after expanding.
    expect(screen.queryByLabelText("Hide for yourself")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Unpin/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Expand pinned message")).toBeInTheDocument();
  });

  it('renders "Hide for yourself" eye button when expanded', () => {
    render(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByLabelText("Hide for yourself")).toBeInTheDocument();
  });

  it("renders Unpin for mod role and never renders the viewer hide button", () => {
    render(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="mod"
        isExpanded={true}
        onExpandToggle={() => {}}
        onUnpin={() => {}}
        onDismiss={() => {}}
      />
    );
    const unpinButton = screen.getByLabelText("Unpin");
    expect(unpinButton).toBeInTheDocument();
    expect(unpinButton).toHaveTextContent("");
    expect(unpinButton).not.toHaveAttribute("title");
    const icon = unpinButton.querySelector("svg");
    expect(icon).toBeInTheDocument();
    expect(icon?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(icon?.querySelector("path")?.getAttribute("d")).toContain("m2.293 3.707");
    expect(screen.queryByLabelText("Hide for yourself")).not.toBeInTheDocument();
  });

  it("uses white Twitch-style tooltips for pinned message controls", async () => {
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );

    const hideButton = screen.getByLabelText("Hide for yourself");
    fireEvent.pointerMove(hideButton);
    fireEvent.pointerEnter(hideButton);
    await expectWhiteTooltip("Hide for yourself");

    rerender(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );

    rerender(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="mod"
        isExpanded={false}
        onExpandToggle={() => {}}
        onUnpin={() => {}}
      />
    );

    const unpinButton = screen.getByLabelText("Unpin");
    fireEvent.pointerMove(unpinButton);
    fireEvent.pointerEnter(unpinButton);
    await expectWhiteTooltip("Unpin");
  });

  it("renders the expand chevron bold without a tooltip", () => {
    render(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );

    const expandButton = screen.getByLabelText("Expand pinned message");
    expect(expandButton).not.toHaveAttribute("aria-describedby");
    expect(screen.getByTestId("pinned-message-expand-icon")).toHaveStyle({
      stroke: "currentColor",
      strokeWidth: "1.35",
    });

    fireEvent.pointerMove(expandButton);
    fireEvent.pointerEnter(expandButton);
    fireEvent.focus(expandButton);

    expect(screen.queryByText("Expand")).toBeNull();
  });

  it("calls onDismiss when viewer clicks the hide button (in expanded state)", () => {
    const onDismiss = vi.fn();
    render(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByLabelText("Hide for yourself"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onExpandToggle when expand chevron is clicked", () => {
    const onExpandToggle = vi.fn();
    render(
      <PinnedMessageBanner
        pin={makePin()}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={onExpandToggle}
        onDismiss={() => {}}
      />
    );
    fireEvent.click(screen.getByLabelText("Expand pinned message"));
    expect(onExpandToggle).toHaveBeenCalledTimes(1);
  });

  describe("Unpin direct action", () => {
    it("clicking Unpin fires onUnpin immediately", () => {
      const onUnpin = vi.fn();
      render(
        <PinnedMessageBanner
          pin={makePin()}
          viewerRole="mod"
          isExpanded={false}
          onExpandToggle={() => {}}
          onUnpin={onUnpin}
        />
      );
      fireEvent.click(screen.getByLabelText("Unpin"));
      expect(onUnpin).toHaveBeenCalledTimes(1);
    });

    it("never renders a Confirm unpin button", () => {
      const onUnpin = vi.fn();
      render(
        <PinnedMessageBanner
          pin={makePin()}
          viewerRole="mod"
          isExpanded={false}
          onExpandToggle={() => {}}
          onUnpin={onUnpin}
        />
      );
      expect(screen.queryByLabelText("Confirm unpin")).not.toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("Unpin"));
      expect(screen.queryByLabelText("Confirm unpin")).not.toBeInTheDocument();
    });
  });

  it("renders Twitch mod pin options as a three-dot menu next to the expand arrow", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({ platform: "twitch" })}
        viewerRole="mod"
        isExpanded={false}
        onExpandToggle={() => {}}
        onUnpin={() => {}}
        onUpdateDuration={() => {}}
      />
    );

    const optionsButton = screen.getByLabelText("Pinned message options");
    const expandButton = screen.getByLabelText("Expand pinned message");
    expect(optionsButton).toBeInTheDocument();
    expect(optionsButton.compareDocumentPosition(expandButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.queryByLabelText("Unpin")).toBeNull();
  });

  it("requires Apply before changing a Twitch pinned-message duration", () => {
    const onUpdateDuration = vi.fn();
    render(
      <PinnedMessageBanner
        pin={makePin({ platform: "twitch" })}
        viewerRole="mod"
        isExpanded={false}
        onExpandToggle={() => {}}
        onUnpin={() => {}}
        onUpdateDuration={onUpdateDuration}
      />
    );

    fireEvent.click(screen.getByLabelText("Pinned message options"));
    fireEvent.click(screen.getByLabelText("5 minutes"));
    expect(onUpdateDuration).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Apply"));
    expect(onUpdateDuration).toHaveBeenCalledWith(5 * 60);
  });

  it("supports 1-minute and custom seconds/minutes Twitch pin durations", () => {
    const onUpdateDuration = vi.fn();
    render(
      <PinnedMessageBanner
        pin={makePin({ platform: "twitch" })}
        viewerRole="mod"
        isExpanded={false}
        onExpandToggle={() => {}}
        onUnpin={() => {}}
        onUpdateDuration={onUpdateDuration}
      />
    );

    fireEvent.click(screen.getByLabelText("Pinned message options"));
    fireEvent.click(screen.getByLabelText("1 minute"));
    fireEvent.click(screen.getByText("Apply"));
    expect(onUpdateDuration).toHaveBeenLastCalledWith(60);

    fireEvent.click(screen.getByLabelText("Pinned message options"));
    fireEvent.click(screen.getByLabelText("Custom"));
    fireEvent.change(screen.getByLabelText("Custom pin duration"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Custom pin duration unit"), {
      target: { value: "seconds" },
    });
    fireEvent.click(screen.getByText("Apply"));
    expect(onUpdateDuration).toHaveBeenLastCalledWith(45);

    fireEvent.click(screen.getByLabelText("Pinned message options"));
    fireEvent.click(screen.getByLabelText("Custom"));
    fireEvent.change(screen.getByLabelText("Custom pin duration"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Custom pin duration unit"), {
      target: { value: "minutes" },
    });
    fireEvent.click(screen.getByText("Apply"));
    expect(onUpdateDuration).toHaveBeenLastCalledWith(120);
  });

  it("keeps Twitch Unpin in a separate menu section after Apply", () => {
    const onUnpin = vi.fn();
    const onDismiss = vi.fn();
    render(
      <PinnedMessageBanner
        pin={makePin({ platform: "twitch" })}
        viewerRole="mod"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={onDismiss}
        onUnpin={onUnpin}
        onUpdateDuration={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText("Pinned message options"));
    const applyButton = screen.getByText("Apply");
    const hideButton = screen.getByText("Hide for yourself");
    const unpinButton = screen.getByText("Unpin message");
    expect(applyButton.compareDocumentPosition(hideButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(hideButton.compareDocumentPosition(unpinButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(applyButton.compareDocumentPosition(unpinButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(unpinButton.closest("button")?.querySelector("svg")).toBeInTheDocument();

    fireEvent.click(hideButton);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Pinned message options"));
    fireEvent.click(screen.getByText("Unpin message"));
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it("never renders a Reply action in the pinned-message banner", () => {
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({ platform: "kick" })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.queryByLabelText("Reply to pinned message")).not.toBeInTheDocument();

    rerender(
      <PinnedMessageBanner
        pin={makePin({ platform: "twitch" })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.queryByLabelText("Reply to pinned message")).not.toBeInTheDocument();
  });

  it("AE7: updates content in place when the pin prop changes without remount", () => {
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({ messageId: "msg-1", content: [{ type: "text", content: "first pin" }] })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    const bannerBefore = screen.getByTestId("pinned-message-banner");
    expect(screen.getByTestId("pinned-message-content")).toHaveTextContent("first pin");

    rerender(
      <PinnedMessageBanner
        pin={makePin({ messageId: "msg-2", content: [{ type: "text", content: "second pin" }] })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    const bannerAfter = screen.getByTestId("pinned-message-banner");
    expect(bannerAfter).toBe(bannerBefore); // same DOM node
    expect(screen.getByTestId("pinned-message-content")).toHaveTextContent("second pin");
  });

  it("AE8: collapsed body shows a preview and expanded body reveals the full message", () => {
    // Collapsed pins keep chat usable by showing a short preview; expansion
    // removes that cap and leaves the body wrapping normally.
    const longText = "this is a very long pinned message intended to overflow at narrow widths";
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({ content: [{ type: "text", content: longText }] })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    const content = screen.getByTestId("pinned-message-content");
    expect(content.className).toContain("break-words");
    expect(content.className).toContain("overflow-hidden");
    expect(content.className).not.toContain("truncate");
    expect(content).toHaveAttribute("data-expanded", "false");
    expect(content.getAttribute("style")).toContain("max-height: 3.25rem");
    expect(content.getAttribute("style")).toContain("mask-image:");
    // Collapsed state has only the Expand chevron (Twitch parity) — the hide
    // button only appears after expanding.
    expect(screen.getByLabelText("Expand pinned message")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hide for yourself")).not.toBeInTheDocument();

    rerender(
      <PinnedMessageBanner
        pin={makePin({ content: [{ type: "text", content: longText }] })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    // Expanded pins remove the preview cap.
    const expandedContent = screen.getByTestId("pinned-message-content");
    expect(expandedContent.className).toContain("break-words");
    expect(expandedContent.className).not.toContain("overflow-hidden");
    expect(expandedContent.className).not.toContain("truncate");
    expect(expandedContent).toHaveAttribute("data-expanded", "true");
    expect(expandedContent.getAttribute("style") ?? "").not.toContain("max-height");
  });

  it("caps expanded pins in a Twitch-style scroll area", () => {
    const longText = "expanded pinned message ".repeat(80);
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({ content: [{ type: "text", content: longText }] })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );

    const collapsedScrollArea = screen.getByTestId("pinned-message-scroll-area");
    expect(collapsedScrollArea).toHaveAttribute("data-expanded", "false");
    expect(collapsedScrollArea.getAttribute("style") ?? "").not.toContain("overflow");
    expect(collapsedScrollArea.getAttribute("style") ?? "").not.toContain("max-height");

    rerender(
      <PinnedMessageBanner
        pin={makePin({ content: [{ type: "text", content: longText }] })}
        viewerRole="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );

    const expandedScrollArea = screen.getByTestId("pinned-message-scroll-area");
    expect(expandedScrollArea).toHaveAttribute("data-expanded", "true");
    expect(expandedScrollArea.getAttribute("style")).toContain("max-height: 200px");
    expect(expandedScrollArea.getAttribute("style")).toContain("overflow-x: hidden");
    expect(expandedScrollArea.getAttribute("style")).toContain("overflow-y: scroll");
    expect(expandedScrollArea.getAttribute("style")).toContain("margin-inline-end: -10px");
    expect(expandedScrollArea.getAttribute("style")).toContain("scrollbar-color:");
    expect(expandedScrollArea.getAttribute("style")).not.toContain("mask-image:");
    expect(expandedScrollArea.className).toContain("pinned-message-scrollbar");
  });

  it("collapsed state keeps long URLs clickable inside the preview", () => {
    // The preview clips overall height, but link fragments still keep their
    // own break-all behavior so the visible URL text remains usable.
    const longUrl = "https://www.youtube.com/watch?v=averylonglongvideoidstringhere";
    render(
      <PinnedMessageBanner
        pin={makePin({ content: [{ type: "link", url: longUrl, text: longUrl }] })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    const content = screen.getByTestId("pinned-message-content");
    const anchor = content.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe(longUrl);
    expect(anchor?.className).toContain("break-all");
    // Parent must not force nowrap; break-all on the child can only fire when
    // the parent permits wrapping.
    expect(content.className).toContain("break-words");
    expect(content.className).toContain("overflow-hidden");
    expect(content).toHaveAttribute("data-expanded", "false");
  });

  it("only clips 'Pinned by' usernames longer than 20 characters", () => {
    const longUsername = "bobfarrfuturepopsuperstar";
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({
          pinnedBy: {
            username: "exactlytwentychars!!",
            color: "#FF6F61",
            badges: [],
          },
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );

    let usernameWrapper = screen.getByTestId("pinned-message-header-username");
    expect(usernameWrapper.className).not.toContain("overflow-hidden");
    let usernameEl = screen.getByText("exactlytwentychars!!");
    expect(usernameEl.className).not.toContain("truncate");
    expect(usernameEl.closest(".chat-line__username-container")?.className).toContain(
      "whitespace-nowrap"
    );

    rerender(
      <PinnedMessageBanner
        pin={makePin({
          pinnedBy: {
            username: longUsername,
            color: "#FF6F61",
            // Include a badge so the three-element header row (label + badge
            // + username) is exercised — that's the layout that most stresses
            // the shrink behavior in production.
            badges: [
              {
                setId: "broadcaster",
                version: "1",
                imageUrl: "https://example/b/1",
                title: "Broadcaster",
              },
            ],
          },
        })}
        viewerRole="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />
    );
    // Username wrapper is the only piece allowed to give up width. It clips
    // the clickable Username component so the inner text ellipsis can fire.
    usernameWrapper = screen.getByTestId("pinned-message-header-username");
    expect(usernameWrapper.className).toContain("min-w-0");
    expect(usernameWrapper.className).toContain("overflow-hidden");
    usernameEl = screen.getByText(longUsername);
    expect(usernameEl.className).toContain("truncate");
    expect(usernameEl.className).toContain("block");
    expect(usernameEl.className).toContain("max-w-full");
    expect(usernameEl.closest(".chat-line__username-container")?.className).toContain(
      "whitespace-nowrap"
    );
    // The "Pinned by" label and badge wrapper must NOT shrink — if either
    // absorbs the shrink budget, the username's truncate is bypassed and
    // overflow returns.
    expect(screen.getByText("Pinned by").className).toContain("flex-shrink-0");
    const header = screen.getByTestId("pinned-message-header");
    const badgeWrapper = header.querySelector("span.inline-flex");
    expect(badgeWrapper?.className).toContain("flex-shrink-0");
  });

  it("keeps the direct Unpin button when the pin changes", () => {
    const onUnpin = vi.fn();
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({ messageId: "msg-1" })}
        viewerRole="mod"
        isExpanded={false}
        onExpandToggle={() => {}}
        onUnpin={onUnpin}
      />
    );
    fireEvent.click(screen.getByLabelText("Unpin"));
    expect(onUnpin).toHaveBeenCalledTimes(1);

    rerender(
      <PinnedMessageBanner
        pin={makePin({ messageId: "msg-2" })}
        viewerRole="mod"
        isExpanded={false}
        onExpandToggle={() => {}}
        onUnpin={onUnpin}
      />
    );
    expect(screen.getByLabelText("Unpin")).toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm unpin")).not.toBeInTheDocument();
  });
});
