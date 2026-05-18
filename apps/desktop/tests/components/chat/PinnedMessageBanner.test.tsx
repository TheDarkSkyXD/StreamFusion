import { act, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("PinnedMessageBanner", () => {
  it("renders pinnedBy label and content (no author prefix on body — Twitch-faithful)", () => {
    render(
      <PinnedMessageBanner
        pin={makePin()}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/Pinned by/)).toBeInTheDocument();
    expect(screen.getByText("modbot")).toBeInTheDocument();
    // Body shows just the message content — no "alice:" prefix. Twitch's
    // native pin card omits the sender entirely in collapsed state; the
    // "Pinned by X" header is the only attribution.
    expect(screen.queryByText("alice:")).not.toBeInTheDocument();
    expect(screen.getByTestId("pinned-message-content")).toHaveTextContent("check the bracket");
  });

  it("shows only ONE primary badge next to pinnedBy username (matches twitch.tv)", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          pinnedBy: {
            username: "fitzbro",
            color: "#008000",
            badges: [
              // Highest-priority role badge — should be the one rendered
              { setId: "broadcaster", version: "1", imageUrl: "https://example/b/1", title: "Broadcaster" },
              { setId: "subscriber", version: "12", imageUrl: "https://example/s/1", title: "1-Year Sub" },
              { setId: "partner", version: "1", imageUrl: "https://example/p/1", title: "Verified" },
            ],
          },
        })}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />,
    );
    // Only one badge image — the Broadcaster — should appear in the header.
    const header = screen.getByTestId("pinned-message-header");
    const headerImgs = header.querySelectorAll("img");
    expect(headerImgs.length).toBe(1);
    expect(headerImgs[0].getAttribute("alt")).toBe("Broadcaster");
  });

  it("falls back to the lowest priority badge when no role badge is present", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({
          pinnedBy: {
            username: "alice",
            color: "#FF7F50",
            badges: [
              { setId: "subscriber", version: "12", imageUrl: "https://example/s/1", title: "1-Year Sub" },
              { setId: "unknown_set", version: "1", imageUrl: "https://example/u/1", title: "Unknown" },
            ],
          },
        })}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />,
    );
    // Subscriber is in the priority list (lowest) — picked because no higher
    // role-badge exists in the user's set.
    const header = screen.getByTestId("pinned-message-header");
    expect(header.querySelectorAll("img").length).toBe(1);
    expect(header.querySelector("img")?.getAttribute("alt")).toBe("1-Year Sub");
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
              { setId: "partner", version: "1", imageUrl: "https://example/p/1", title: "Verified" },
            ],
          },
          sentAt: "2026-05-18T01:54:00.000Z",
        })}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />,
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
              { setId: "partner", version: "1", imageUrl: "https://example/p/1", title: "Verified" },
            ],
          },
          sentAt: "2026-05-18T01:54:00.000Z",
        })}
        role="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
      />,
    );
    // One combined row at the bottom: [badges] username sent at HH:MM PM.
    const senderRow = screen.getByTestId("pinned-message-sender-row");
    expect(senderRow).toBeInTheDocument();
    expect(senderRow.querySelector('img[alt="Verified"]')).toBeInTheDocument();
    expect(senderRow).toHaveTextContent("smokey");
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
        role="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
      />,
    );
    const content = screen.getByTestId("pinned-message-content");
    const senderRow = screen.getByTestId("pinned-message-sender-row");
    // DOM order: bottom attribution row follows the message body.
    expect(content.compareDocumentPosition(senderRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("omits the timestamp entirely when sentAt is null (sender row still renders)", () => {
    render(
      <PinnedMessageBanner
        pin={makePin({ sentAt: null })}
        role="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
      />,
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
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
      />,
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
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("Pinned message")).toBeInTheDocument();
    expect(screen.queryByText(/Pinned by/)).not.toBeInTheDocument();
  });

  it("AE1: renders the same shared component shape for Twitch and Kick", () => {
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({ platform: "kick" })}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />,
    );
    const kickBanner = screen.getByTestId("pinned-message-banner");
    expect(kickBanner.getAttribute("data-platform")).toBe("kick");
    const kickClasses = kickBanner.className;

    rerender(
      <PinnedMessageBanner
        pin={makePin({ platform: "twitch" })}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />,
    );
    const twitchBanner = screen.getByTestId("pinned-message-banner");
    expect(twitchBanner.getAttribute("data-platform")).toBe("twitch");
    // Same component, same outer classes — only the data-platform attr varies.
    expect(twitchBanner.className).toBe(kickClasses);
  });

  it("does NOT render the hide button in collapsed state (matches Twitch native)", () => {
    render(
      <PinnedMessageBanner
        pin={makePin()}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
        onUnpin={() => {}}
      />,
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
        role="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByLabelText("Hide for yourself")).toBeInTheDocument();
  });

  it("renders Unpin for mod role and never renders the viewer hide button", () => {
    render(
      <PinnedMessageBanner
        pin={makePin()}
        role="mod"
        isExpanded={true}
        onExpandToggle={() => {}}
        onUnpin={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByLabelText("Unpin")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hide for yourself")).not.toBeInTheDocument();
  });

  it("calls onDismiss when viewer clicks the hide button (in expanded state)", () => {
    const onDismiss = vi.fn();
    render(
      <PinnedMessageBanner
        pin={makePin()}
        role="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByLabelText("Hide for yourself"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onExpandToggle when expand chevron is clicked", () => {
    const onExpandToggle = vi.fn();
    render(
      <PinnedMessageBanner
        pin={makePin()}
        role="viewer"
        isExpanded={false}
        onExpandToggle={onExpandToggle}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Expand pinned message"));
    expect(onExpandToggle).toHaveBeenCalledTimes(1);
  });

  describe("AE3: Unpin confirm flow", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("first click arms the confirm step without firing onUnpin", () => {
      const onUnpin = vi.fn();
      render(
        <PinnedMessageBanner
          pin={makePin()}
          role="mod"
          isExpanded={false}
          onExpandToggle={() => {}}
          onUnpin={onUnpin}
        />,
      );
      fireEvent.click(screen.getByLabelText("Unpin"));
      expect(onUnpin).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Confirm unpin")).toBeInTheDocument();
    });

    it("second click within the window fires onUnpin", () => {
      const onUnpin = vi.fn();
      render(
        <PinnedMessageBanner
          pin={makePin()}
          role="mod"
          isExpanded={false}
          onExpandToggle={() => {}}
          onUnpin={onUnpin}
        />,
      );
      fireEvent.click(screen.getByLabelText("Unpin"));
      fireEvent.click(screen.getByLabelText("Confirm unpin"));
      expect(onUnpin).toHaveBeenCalledTimes(1);
    });

    it("auto-reverts after 5s without a second click", () => {
      const onUnpin = vi.fn();
      render(
        <PinnedMessageBanner
          pin={makePin()}
          role="mod"
          isExpanded={false}
          onExpandToggle={() => {}}
          onUnpin={onUnpin}
        />,
      );
      fireEvent.click(screen.getByLabelText("Unpin"));
      expect(screen.getByLabelText("Confirm unpin")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByLabelText("Unpin")).toBeInTheDocument();
      expect(onUnpin).not.toHaveBeenCalled();
    });
  });

  it("renders Reply action only when expanded and onReply is provided", () => {
    const onReply = vi.fn();
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin()}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
        onReply={onReply}
      />,
    );
    expect(screen.queryByLabelText("Reply to pinned message")).not.toBeInTheDocument();

    rerender(
      <PinnedMessageBanner
        pin={makePin()}
        role="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
        onReply={onReply}
      />,
    );
    const replyButton = screen.getByLabelText("Reply to pinned message");
    fireEvent.click(replyButton);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("omits the Reply button entirely when onReply is not provided", () => {
    render(
      <PinnedMessageBanner
        pin={makePin()}
        role="viewer"
        isExpanded={true}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Reply to pinned message")).not.toBeInTheDocument();
  });

  it("AE7: updates content in place when the pin prop changes without remount", () => {
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({ messageId: "msg-1", content: [{ type: "text", content: "first pin" }] })}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />,
    );
    const bannerBefore = screen.getByTestId("pinned-message-banner");
    expect(screen.getByTestId("pinned-message-content")).toHaveTextContent("first pin");

    rerender(
      <PinnedMessageBanner
        pin={makePin({ messageId: "msg-2", content: [{ type: "text", content: "second pin" }] })}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />,
    );
    const bannerAfter = screen.getByTestId("pinned-message-banner");
    expect(bannerAfter).toBe(bannerBefore); // same DOM node
    expect(screen.getByTestId("pinned-message-content")).toHaveTextContent("second pin");
  });

  it("AE8: collapsed content uses the truncate utility for narrow-width safety", () => {
    const longText = "this is a very long pinned message intended to overflow at narrow widths";
    render(
      <PinnedMessageBanner
        pin={makePin({ content: [{ type: "text", content: longText }] })}
        role="viewer"
        isExpanded={false}
        onExpandToggle={() => {}}
        onDismiss={() => {}}
      />,
    );
    const content = screen.getByTestId("pinned-message-content");
    expect(content.className).toContain("truncate");
    // Collapsed state has only the Expand chevron (Twitch parity) — the hide
    // button only appears after expanding.
    expect(screen.getByLabelText("Expand pinned message")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hide for yourself")).not.toBeInTheDocument();
  });

  it("resets the unpin confirm-armed state when the pin changes", () => {
    const onUnpin = vi.fn();
    const { rerender } = render(
      <PinnedMessageBanner
        pin={makePin({ messageId: "msg-1" })}
        role="mod"
        isExpanded={false}
        onExpandToggle={() => {}}
        onUnpin={onUnpin}
      />,
    );
    fireEvent.click(screen.getByLabelText("Unpin"));
    expect(screen.getByLabelText("Confirm unpin")).toBeInTheDocument();

    rerender(
      <PinnedMessageBanner
        pin={makePin({ messageId: "msg-2" })}
        role="mod"
        isExpanded={false}
        onExpandToggle={() => {}}
        onUnpin={onUnpin}
      />,
    );
    // New pin: armed state cleared so a single click would NOT immediately unpin.
    expect(screen.getByLabelText("Unpin")).toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm unpin")).not.toBeInTheDocument();
  });
});
