import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InfoBanner } from "@/components/chat/InfoBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useChatRoomState } from "@/hooks/useChatRoomState";
import { DEFAULT_ROOM_STATE, type RoomState } from "@/store/room-state-store";

// Mock the hook — we feed RoomState directly per test rather than priming
// the real Zustand store.
vi.mock("@/hooks/useChatRoomState", () => ({
  useChatRoomState: vi.fn(),
}));

const useChatRoomStateMock = vi.mocked(useChatRoomState);

function mockRoomState(patch: Partial<RoomState>): void {
  useChatRoomStateMock.mockReturnValue({ ...DEFAULT_ROOM_STATE, ...patch });
}

// Wrap renders in TooltipProvider — Radix Tooltip requires one in the tree.
function render(ui: React.ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

// Radix Tooltip mirrors content into a visually-hidden sr-only span for
// `aria-describedby`. Both copies carry the same data-testid, so use the
// first match for content assertions.
const tooltipRow = (key: string): HTMLElement =>
  screen.getAllByTestId(`info-banner-tooltip-row-${key}`)[0];

afterEach(() => {
  useChatRoomStateMock.mockReset();
});

describe("InfoBanner", () => {
  it("returns null when no mode is active", () => {
    mockRoomState({});
    const { container } = render(<InfoBanner platform="twitch" channelId="123" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Followers Only Mode [5m] when only followersOnly: 5", () => {
    mockRoomState({ followersOnly: 5 });
    render(<InfoBanner platform="twitch" channelId="123" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Followers Only Mode [5m]",
    );
    // Tooltip lists it (even when collapsed it's rendered as a Radix portal
    // when open — but Radix mounts content lazily; we still verify the
    // row exists in the DOM by querying the testid that's rendered when
    // the Tooltip opens. We open via focus below.)
    const icon = screen.getByTestId("info-banner-icon");
    fireEvent.focus(icon);
    expect(tooltipRow("followers")).toHaveTextContent(
      "Followers Only Mode Enabled [5m]",
    );
  });

  it("renders Followers Only Mode (no bracket) when followersOnly: 0", () => {
    mockRoomState({ followersOnly: 0 });
    render(<InfoBanner platform="twitch" channelId="123" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Followers Only Mode",
    );
    expect(screen.getByTestId("info-banner-primary").textContent).not.toContain("[");
  });

  it("followers precedence wins over slow when both active; tooltip lists both", () => {
    mockRoomState({ followersOnly: 5, slowMode: 30 });
    render(<InfoBanner platform="twitch" channelId="123" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Followers Only Mode [5m]",
    );
    fireEvent.focus(screen.getByTestId("info-banner-icon"));
    expect(tooltipRow("followers")).toBeInTheDocument();
    expect(tooltipRow("slow")).toHaveTextContent("Slow Mode Enabled [30s]");
  });

  it("subscribers precedence wins over emoteOnly; tooltip lists both", () => {
    mockRoomState({ subscribersOnly: true, emoteOnly: true });
    render(<InfoBanner platform="twitch" channelId="123" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Subscribers Only Mode",
    );
    fireEvent.focus(screen.getByTestId("info-banner-icon"));
    expect(tooltipRow("subscribers")).toBeInTheDocument();
    expect(tooltipRow("emoteOnly")).toBeInTheDocument();
  });

  it("renders Account Age Mode [3m] on Kick when accountAge: 3", () => {
    mockRoomState({ accountAge: 3 });
    render(<InfoBanner platform="kick" channelId="42" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Account Age Mode [3m]",
    );
  });

  it("ignores accountAge on Twitch even when set (defensive platform asymmetry)", () => {
    // Twitch fetchers should never write accountAge, but if they did this
    // component MUST NOT render it as a label or tooltip row.
    mockRoomState({ accountAge: 3 });
    const { container } = render(<InfoBanner platform="twitch" channelId="123" />);
    // No other mode is active, so the banner should return null entirely.
    expect(container.firstChild).toBeNull();
  });

  it("formats slowMode 90s as `1m 30s`", () => {
    mockRoomState({ slowMode: 90 });
    render(<InfoBanner platform="twitch" channelId="123" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Slow Mode [1m 30s]",
    );
  });

  it("formats slowMode 60s as `1m` (no trailing 0s)", () => {
    mockRoomState({ slowMode: 60 });
    render(<InfoBanner platform="twitch" channelId="123" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Slow Mode [1m]",
    );
  });

  it("renders Unique Chat Mode on Twitch when only uniqueChat active", () => {
    mockRoomState({ uniqueChat: true });
    render(<InfoBanner platform="twitch" channelId="123" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Unique Chat Mode",
    );
    fireEvent.focus(screen.getByTestId("info-banner-icon"));
    expect(tooltipRow("uniqueChat")).toHaveTextContent("Unique Chat Mode Enabled");
  });

  it("renders Shield Mode on Twitch when only shieldMode active", () => {
    mockRoomState({ shieldMode: true });
    render(<InfoBanner platform="twitch" channelId="123" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Shield Mode",
    );
  });

  it("uniqueChat does NOT displace followers as primary; both appear in tooltip", () => {
    mockRoomState({ followersOnly: 5, uniqueChat: true });
    render(<InfoBanner platform="twitch" channelId="123" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Followers Only Mode [5m]",
    );
    fireEvent.focus(screen.getByTestId("info-banner-icon"));
    expect(tooltipRow("followers")).toBeInTheDocument();
    expect(tooltipRow("uniqueChat")).toBeInTheDocument();
  });

  it("ignores uniqueChat / shieldMode on Kick (platform asymmetry)", () => {
    mockRoomState({ uniqueChat: true, shieldMode: true });
    const { container } = render(<InfoBanner platform="kick" channelId="42" />);
    // Neither field should contribute on Kick; nothing else is active.
    expect(container.firstChild).toBeNull();
  });

  it("info icon focus shows tooltip; blur hides it", () => {
    mockRoomState({ followersOnly: 5 });
    render(<InfoBanner platform="twitch" channelId="123" />);
    const icon = screen.getByTestId("info-banner-icon");
    fireEvent.focus(icon);
    expect(tooltipRow("followers")).toBeInTheDocument();
    fireEvent.blur(icon);
    // Radix removes content from the DOM after blur — queryByTestId returns
    // null. (Animation duration is 100ms; testing-library's flushed effects
    // are sufficient because we don't await; Radix tears down synchronously
    // on blur for non-portaled trees.)
    // Use queryAllByTestId to be tolerant of either teardown timing.
    expect(
      screen.queryAllByTestId("info-banner-tooltip-row-followers").length,
    ).toBeLessThanOrEqual(1);
  });

  it("precedence chain verified tabularly: followers → subscribers → accountAge → emoteOnly → slow", () => {
    // All five primary modes active. Primary should be followers.
    mockRoomState({
      followersOnly: 5,
      subscribersOnly: true,
      accountAge: 3, // ignored on Twitch; rendered on Kick below
      emoteOnly: true,
      slowMode: 30,
    });
    const { rerender } = render(<InfoBanner platform="kick" channelId="42" />);
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Followers Only Mode [5m]",
    );

    // Drop followers — subscribers wins.
    mockRoomState({
      subscribersOnly: true,
      accountAge: 3,
      emoteOnly: true,
      slowMode: 30,
    });
    rerender(
      <TooltipProvider>
        <InfoBanner platform="kick" channelId="42" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Subscribers Only Mode",
    );

    // Drop subscribers — accountAge wins (Kick only).
    mockRoomState({ accountAge: 3, emoteOnly: true, slowMode: 30 });
    rerender(
      <TooltipProvider>
        <InfoBanner platform="kick" channelId="42" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Account Age Mode [3m]",
    );

    // Drop accountAge — emoteOnly wins.
    mockRoomState({ emoteOnly: true, slowMode: 30 });
    rerender(
      <TooltipProvider>
        <InfoBanner platform="kick" channelId="42" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Emote Only Mode",
    );

    // Drop emoteOnly — slow wins.
    mockRoomState({ slowMode: 30 });
    rerender(
      <TooltipProvider>
        <InfoBanner platform="kick" channelId="42" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent(
      "Slow Mode [30s]",
    );
  });
});
