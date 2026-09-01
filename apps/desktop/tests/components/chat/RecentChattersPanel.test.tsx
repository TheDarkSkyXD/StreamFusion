import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecentChattersPanel } from "@/features/chat/components/chat/RecentChattersPanel";
import type { ChatBadge, ChatKnownUser, ChatMessage } from "@shared/chat-types";
import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useChatStore } from "@/store/chat-store";

function chatter(
  username: string,
  role: ChatKnownUser["role"],
  lastSeenOffset = 0,
  badges: ChatBadge[] = []
): ChatKnownUser {
  return {
    userId: username,
    username,
    displayName: username,
    color: "#a78bfa",
    role,
    badges,
    lastSeen: new Date(Date.parse("2026-08-07T12:00:00.000Z") + lastSeenOffset),
  };
}

function message(username: string, timestamp: Date, badges: ChatBadge[] = []): ChatMessage {
  return {
    id: `${username}-${timestamp.getTime()}`,
    platform: "twitch",
    type: "message",
    channel: "alpha",
    userId: username,
    username,
    displayName: username,
    color: "#a78bfa",
    badges,
    content: [{ type: "text", content: "hello" }],
    rawContent: "hello",
    timestamp,
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

// Guards: Active Chatters renders exactly two groups, merging channel authorities and regular chatters without losing users.
// Guards: The overlay reads only the requested platform/channel bucket.
// Guards: Twitch rows render exact resolved provider badge images, never generated substitutes.
// Guards: Kick rows preserve the provider badge version while using Electron's image proxy (regression 67fdc95)
// Guards: The visible list and count update as live chat messages arrive.
// Guards: The seen-in-chat total keeps updating beyond the 500-row recent-roster cap.
// Guards: Chatter names use the same preference-resolved color and provider fallback as chat messages.
// Guards: Live roster updates preserve the user's scroll position while rows reorder or gain badges.
// Guards: Wheel and trackpad input over a populated roster never reaches a host page or chat scroller.
// Guards: Escape closes the roster and restores keyboard focus to the control that opened it.
// Guards: Both groups are accessible collapsibles whose live counts remain visible, including an empty sibling group.
// Guards: The moderator badge and active-chatter icon sit immediately before their group labels without changing accessible names.
// Guards: Roster totals and group headings remain readable without making user rows taller.
// Guards: The host chat header owns the only visible close button; the overlay does not duplicate it.
// Guards: Each group owns a bounded 12rem scroller rather than borrowing the outer roster.
// Guards: Search filters active chatter rows and group counts by username or display name without changing the session total.
// Guards: Empty search results keep both group headings visible at zero and use distinct copy from a truly empty roster.
describe("RecentChattersPanel", () => {
  beforeEach(() => {
    useChatStore.getState().cleanupBatching();
    useChatStore.setState({
      messagesByChannel: {},
      usersByChannel: {},
      chatterCountByChannel: {},
      batchingEnabled: false,
    });
    useAuthStore.setState({ preferences: DEFAULT_USER_PREFERENCES });
  });

  it("renders exactly the Moderators and Chatters groups for the selected channel", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": {
          owner: chatter("owner", "broadcaster"),
          mod: chatter("mod", "moderator", 0, [
            {
              setId: "moderator",
              version: "1",
              imageUrl: "https://static-cdn.jtvnw.net/badges/v1/moderator/2",
              title: "Moderator",
            },
          ]),
          sub: chatter("sub", "subscriber"),
          viewer: chatter("viewer", "viewer"),
        },
        "kick:alpha": {
          outsider: chatter("outsider", "viewer"),
        },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    expect(screen.getByRole("heading", { name: "Active Chatters" })).toBeInTheDocument();
    const moderatorToggle = screen.getByRole("button", { name: "Moderators, 2 chatters" });
    const chatterToggle = screen.getByRole("button", { name: "Chatters, 2 chatters" });
    expect(screen.getAllByRole("button")).toEqual([moderatorToggle, chatterToggle]);
    expect(moderatorToggle.querySelector("img")).toHaveAttribute(
      "src",
      "https://static-cdn.jtvnw.net/badges/v1/moderator/2"
    );
    expect(screen.getByText("Chatters").previousElementSibling?.tagName).toBe("svg");
    expect(screen.queryByText("Broadcaster")).not.toBeInTheDocument();
    expect(screen.queryByText("Subscribers")).not.toBeInTheDocument();
    expect(screen.queryByText("Viewers")).not.toBeInTheDocument();
    expect(screen.queryByText("outsider")).not.toBeInTheDocument();
  });

  it("does not render a second close button inside the overlay", () => {
    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    expect(screen.queryByRole("button", { name: "Close active chatters" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Active chatter groups")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("searchbox", { name: "Search active chatters" })
    ).not.toBeInTheDocument();
  });

  it("renders the exact Twitch provider badge image and version observed on the message", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": {
          owner: chatter("owner", "broadcaster", 0, [
            {
              setId: "broadcaster",
              version: "1",
              imageUrl: "https://static-cdn.jtvnw.net/badges/v1/twitch-owner/2",
              title: "Broadcaster",
            },
          ]),
        },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    expect(screen.getByRole("img", { name: "Broadcaster" })).toHaveAttribute(
      "src",
      "https://static-cdn.jtvnw.net/badges/v1/twitch-owner/2"
    );
  });

  it("renders the exact Kick provider badge image and version observed on the message", () => {
    const sourceUrl = "https://files.kick.com/channel/subscriber-badges/24-month.webp";
    useChatStore.setState({
      usersByChannel: {
        "kick:alpha": {
          sub: chatter("sub", "subscriber", 0, [
            {
              setId: "subscriber",
              version: "24",
              imageUrl: sourceUrl,
              title: "24-Month Subscriber",
            },
          ]),
        },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="kick:alpha" onClose={vi.fn()} />
    );

    const src = screen.getByRole("img", { name: "24-Month Subscriber" }).getAttribute("src");
    expect(src).toMatch(/^kick-image:\/\/image\?u=/);
    const encodedSource = new URL(src ?? "").searchParams.get("u") ?? "";
    expect(atob(encodedSource.replace(/-/g, "+").replace(/_/g, "/"))).toBe(sourceUrl);
  });

  it("renders no badge or generated initial when the provider badge is unresolved", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": {
          viewer: chatter("viewer", "viewer", 0, [
            {
              setId: "subscriber",
              version: "3",
              imageUrl: "",
              title: "Subscriber",
            },
          ]),
        },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("V")).not.toBeInTheDocument();
    expect(screen.getByText("viewer")).toBeInTheDocument();
  });

  it("updates the visible count and list as live messages arrive", () => {
    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );
    expect(screen.getByText("People appear as messages arrive")).toBeInTheDocument();

    act(() => {
      useChatStore
        .getState()
        .addMessage(message("first-live-user", new Date("2026-08-07T12:00:00Z")));
    });
    expect(screen.getByText("1 seen in this chat")).toBeInTheDocument();
    expect(screen.getByText("first-live-user")).toBeInTheDocument();

    act(() => {
      useChatStore
        .getState()
        .addMessage(message("second-live-user", new Date("2026-08-07T12:00:01Z")));
    });
    expect(screen.getByText("2 seen in this chat")).toBeInTheDocument();
    expect(screen.getByText("second-live-user")).toBeInTheDocument();
  });

  it("shows a live total beyond the bounded 500-row recent roster", () => {
    const base = Date.parse("2026-08-07T12:00:00.000Z");
    useChatStore.getState().replaceHistoricalMessages(
      "twitch:alpha",
      Array.from({ length: 500 }, (_, index) => message(`history-${index}`, new Date(base + index)))
    );

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    act(() => {
      useChatStore
        .getState()
        .addMessageBatched(message("new-live-user", new Date(base + 501)), "twitch:alpha");
    });

    expect(screen.getByRole("status")).toHaveTextContent("501 seen in this chat");
    expect(screen.getByText("new-live-user")).toBeInTheDocument();
  });

  it("matches chat-message username color resolution including the platform fallback", () => {
    useAuthStore.setState({
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        chatDisplay: {
          ...DEFAULT_USER_PREFERENCES.chatDisplay,
          readableColorForUncolored: false,
          themeAdaptUsernameColor: true,
        },
      },
    });
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": {
          dark: { ...chatter("dark", "viewer"), color: "#000000" },
          fallback: { ...chatter("fallback", "viewer"), color: undefined },
        },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    expect(screen.getByText("dark")).toHaveStyle({ color: "#808080" });
    expect(screen.getByText("fallback")).toHaveStyle({ color: "#9146ff" });
  });

  it("switches to the new platform channel without leaking the previous roster", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": { twitchUser: chatter("twitchUser", "viewer") },
        "kick:alpha": { kickUser: chatter("kickUser", "viewer") },
      },
    });

    const { rerender } = render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );
    expect(screen.getByText("twitchUser")).toBeInTheDocument();
    expect(screen.queryByText("kickUser")).not.toBeInTheDocument();

    rerender(
      <RecentChattersPanel id="recent-chatters-test" channelKey="kick:alpha" onClose={vi.fn()} />
    );
    expect(screen.getByText("kickUser")).toBeInTheDocument();
    expect(screen.queryByText("twitchUser")).not.toBeInTheDocument();
  });

  it("keeps both groups collapsible while total and group counts update live", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": {
          owner: chatter("owner", "broadcaster"),
          mod: chatter("mod", "moderator"),
          sub: chatter("sub", "subscriber"),
          firstViewer: chatter("firstViewer", "viewer"),
        },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    for (const label of ["Moderators", "Chatters"]) {
      const toggle = screen.getByRole("button", { name: new RegExp(`^${label},`, "i") });
      const controlledId = toggle.getAttribute("aria-controls");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(controlledId).toBeTruthy();

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(document.getElementById(controlledId!)).toHaveAttribute("hidden");
    }

    act(() => {
      useChatStore.getState().addMessage(message("secondViewer", new Date("2026-08-07T12:00:01Z")));
    });

    expect(screen.getByRole("status")).toHaveTextContent("5 seen in this chat");
    expect(screen.getByRole("button", { name: /^chatters/i })).toHaveAccessibleName(/3 chatters/i);
    expect(document.getElementById("recent-chatters-test-chatters-list")).toHaveAttribute("hidden");
  });

  it("searches username and display name while keeping the seen total unfiltered", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": {
          owner: chatter("owner", "broadcaster"),
          mod: {
            ...chatter("stafflogin", "moderator"),
            displayName: "Mira",
          },
          sub: chatter("pixelpatron", "subscriber"),
          viewer: {
            ...chatter("viewerone", "viewer"),
            displayName: "Friendly Viewer",
          },
        },
      },
      chatterCountByChannel: { "twitch:alpha": 12 },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    const search = screen.getByRole("searchbox", { name: "Search active chatters" });
    fireEvent.change(search, { target: { value: "FRIENDLY" } });

    expect(screen.getByText("12 seen in this chat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Moderators, 0 chatters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chatters, 1 chatter" })).toBeInTheDocument();
    expect(screen.getByText("Friendly Viewer")).toBeInTheDocument();
    expect(screen.queryByText("owner")).not.toBeInTheDocument();
    expect(screen.queryByText("Mira")).not.toBeInTheDocument();
    expect(screen.queryByText("pixelpatron")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "STAFF" } });

    expect(screen.getByRole("button", { name: "Moderators, 1 chatter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chatters, 0 chatters" })).toBeInTheDocument();
    expect(screen.getByText("Mira")).toBeInTheDocument();

    const clear = screen.getByRole("button", { name: "Clear search" });
    fireEvent.click(clear);

    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(screen.getByRole("button", { name: "Moderators, 2 chatters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chatters, 2 chatters" })).toBeInTheDocument();
    expect(screen.getByText("pixelpatron")).toBeInTheDocument();
  });

  it("keeps both groups visible when search has no matches", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": {
          mod: chatter("mod", "moderator"),
          viewer: chatter("viewer", "viewer"),
        },
      },
      chatterCountByChannel: { "twitch:alpha": 2 },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search active chatters" }), {
      target: { value: "missing" },
    });

    expect(screen.getByText('No active chatters match "missing".')).toBeInTheDocument();
    expect(screen.queryByText("No active chatters yet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Moderators, 0 chatters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chatters, 0 chatters" })).toBeInTheDocument();
    expect(screen.queryByText("mod")).not.toBeInTheDocument();
    expect(screen.queryByText("viewer")).not.toBeInTheDocument();
  });

  it("renders a heavier chevron without changing the group toggle's accessible name", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": { viewer: chatter("viewer", "viewer") },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    const toggle = screen.getByRole("button", { name: "Chatters, 1 chatter" });
    expect(toggle.querySelector("svg")).toHaveAttribute("stroke-width", "3");
  });

  it("preserves a group's scroll position across live additions, re-sorts, and badge rehydration", () => {
    const viewers = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => {
        const username = `viewer-${index}`;
        return [username, chatter(username, "viewer", index)];
      })
    );
    useChatStore.setState({ usersByChannel: { "twitch:alpha": viewers } });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    const scroller = screen.getByRole("list", { name: "Chatters" });
    scroller.scrollTop = 140;
    fireEvent.scroll(scroller);

    act(() => {
      useChatStore.getState().addMessage(message("live-new", new Date("2026-08-07T12:01:00Z")));
    });
    expect(scroller.scrollTop).toBe(140);

    act(() => {
      useChatStore.getState().addMessage(message("viewer-0", new Date("2026-08-07T12:02:00Z")));
    });
    expect(scroller.scrollTop).toBe(140);

    act(() => {
      useChatStore
        .getState()
        .addMessage(
          message("badge-user", new Date("2026-08-07T12:03:00Z"), [
            { setId: "subscriber", version: "3", imageUrl: "", title: "Subscriber" },
          ])
        );
    });
    act(() => {
      useChatStore.getState().rehydrateChannelBadges("twitch:alpha", (badges) =>
        badges.map((badge) => ({
          ...badge,
          imageUrl: "https://static-cdn.jtvnw.net/badges/v1/subscriber-3/2",
        }))
      );
    });
    expect(scroller.scrollTop).toBe(140);
    expect(screen.getByRole("img", { name: "Subscriber" })).toHaveAttribute(
      "src",
      "https://static-cdn.jtvnw.net/badges/v1/subscriber-3/2"
    );
  });

  it("contains wheel input inside its own populated roster", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": { viewer: chatter("viewer", "viewer") },
      },
    });
    const hostWheel = vi.fn();

    render(
      <div onWheel={hostWheel}>
        <RecentChattersPanel
          id="recent-chatters-test"
          channelKey="twitch:alpha"
          onClose={vi.fn()}
        />
      </div>
    );

    fireEvent.wheel(screen.getByLabelText("Active chatter groups"), { deltaY: 80 });

    expect(hostWheel).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Active Chatters")).toHaveClass("absolute", "inset-0", "min-h-0");
    expect(screen.getByLabelText("Active chatter groups")).toHaveClass(
      "min-h-0",
      "flex-1",
      "overflow-y-hidden",
      "overscroll-y-contain"
    );
  });

  it("gives both groups their own bounded internal scroller", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": {
          owner: chatter("owner", "broadcaster"),
          mod: chatter("mod", "moderator"),
          sub: chatter("sub", "subscriber"),
          viewer: chatter("viewer", "viewer"),
        },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    expect(screen.getByLabelText("Active chatter groups")).toHaveClass("overflow-y-hidden");

    for (const label of ["Moderators", "Chatters"]) {
      expect(screen.getByRole("list", { name: label })).toHaveClass(
        "max-h-48",
        "overflow-y-auto",
        "overscroll-y-contain"
      );
    }
  });

  it("resets each group scroll position when the panel switches channels", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": { alphaViewer: chatter("alphaViewer", "viewer") },
        "twitch:beta": { betaViewer: chatter("betaViewer", "viewer") },
      },
    });

    const { rerender } = render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );
    const alphaList = screen.getByRole("list", { name: "Chatters" });
    alphaList.scrollTop = 120;
    fireEvent.scroll(alphaList);

    rerender(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:beta" onClose={vi.fn()} />
    );

    expect(screen.getByRole("list", { name: "Chatters" }).scrollTop).toBe(0);
  });

  it("keeps the sibling group and outer container still when one group scrolls", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": {
          mod: chatter("mod", "moderator"),
          viewer: chatter("viewer", "viewer"),
        },
      },
    });
    const hostWheel = vi.fn();

    render(
      <div onWheel={hostWheel}>
        <RecentChattersPanel
          id="recent-chatters-test"
          channelKey="twitch:alpha"
          onClose={vi.fn()}
        />
      </div>
    );

    const outer = screen.getByLabelText("Active chatter groups");
    const moderators = screen.getByRole("list", { name: "Moderators" });
    const chatters = screen.getByRole("list", { name: "Chatters" });
    moderators.scrollTop = 80;
    fireEvent.scroll(moderators);
    fireEvent.wheel(moderators, { deltaY: 80 });

    expect(moderators.scrollTop).toBe(80);
    expect(chatters.scrollTop).toBe(0);
    expect(outer.scrollTop).toBe(0);
    expect(hostWheel).not.toHaveBeenCalled();
  });

  it("preserves a group's scroll position across collapse and reopen", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": { viewer: chatter("viewer", "viewer") },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );
    const toggle = screen.getByRole("button", { name: /^chatters/i });
    const chatters = screen.getByRole("list", { name: "Chatters" });
    chatters.scrollTop = 96;
    fireEvent.scroll(chatters);

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(screen.getByRole("list", { name: "Chatters" }).scrollTop).toBe(96);
  });

  it("keeps scroll state independent between simultaneous panels", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": { twitchViewer: chatter("twitchViewer", "viewer") },
        "kick:alpha": { kickViewer: chatter("kickViewer", "viewer") },
      },
    });

    render(
      <>
        <RecentChattersPanel id="twitch-recent" channelKey="twitch:alpha" onClose={vi.fn()} />
        <RecentChattersPanel id="kick-recent" channelKey="kick:alpha" onClose={vi.fn()} />
      </>
    );
    const [twitchScroller, kickScroller] = screen.getAllByRole("list", { name: "Chatters" });

    twitchScroller.scrollTop = 120;
    fireEvent.scroll(twitchScroller);
    kickScroller.scrollTop = 35;
    fireEvent.scroll(kickScroller);

    expect(twitchScroller.scrollTop).toBe(120);
    expect(kickScroller.scrollTop).toBe(35);
  });

  it("returns focus to its trigger when Escape closes it", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": { viewer: chatter("viewer", "viewer") },
      },
    });

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open roster
          </button>
          {open ? (
            <RecentChattersPanel
              id="recent-chatters-test"
              channelKey="twitch:alpha"
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open roster" });
    trigger.focus();
    fireEvent.click(trigger);
    const search = screen.getByRole("searchbox", { name: "Search active chatters" });
    search.focus();
    fireEvent.change(search, { target: { value: "viewer" } });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByLabelText("Active Chatters")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("uses prominent high-contrast totals and group headings while rows stay compact", () => {
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": { sub: chatter("sub", "subscriber") },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    expect(screen.getByRole("heading", { name: "Active Chatters" })).toHaveClass(
      "text-base",
      "font-bold",
      "text-white"
    );
    expect(screen.getByRole("status")).toHaveClass("text-sm", "font-semibold", "text-neutral-300");
    expect(screen.getByRole("button", { name: /^chatters/i })).toHaveClass(
      "text-sm",
      "font-bold",
      "text-neutral-100"
    );
    expect(screen.getByText("sub").closest("li")).toHaveClass("py-1.5");
  });
});
