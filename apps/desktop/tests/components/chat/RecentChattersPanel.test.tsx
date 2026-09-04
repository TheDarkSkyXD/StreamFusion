import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecentChattersPanel } from "@/features/chat/components/chat/RecentChattersPanel";
import type { ChatKnownUser, ChatMessage } from "@shared/chat-types";
import { ChatBadge } from "@streamfusion/core/chat";
import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useChatStore } from "@/store/chat-store";

function chatter(
  username: string,
  role: ChatKnownUser["role"],
  lastSeenOffset = 0,
  badges: ChatBadge[] = [],
  avatarUrl?: string
): ChatKnownUser {
  return {
    userId: username,
    username,
    displayName: username,
    color: "#a78bfa",
    role,
    badges,
    avatarUrl,
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
// Guards: Active Chatter rows render profile avatars instead of message badges.
// Guards: The moderator group heading still renders the provider moderator badge.
// Guards: Missing Active Chatter avatars hydrate only for the visible roster window, then advance on search or scroll.
// Guards: Passive avatar hydration stays within its session budget while an explicit search can still resolve its result.
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
    Reflect.deleteProperty(window, "electronAPI");
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

  it("renders a profile avatar instead of message badges on a Twitch chatter row", () => {
    const avatarUrl = "https://example.com/twitch-avatar.png";
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": {
          viewer: chatter("viewer", "viewer", 0, [
            {
              setId: "subscriber",
              version: "3",
              imageUrl: "https://static-cdn.jtvnw.net/badges/v1/subscriber/2",
              title: "Subscriber",
            },
          ], avatarUrl),
        },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    const row = screen.getByText("viewer").closest("li");
    expect(row?.querySelector("img")).toHaveAttribute("src", avatarUrl);
    expect(row?.querySelector("img")).not.toHaveAttribute(
      "src",
      "https://static-cdn.jtvnw.net/badges/v1/subscriber/2"
    );
  });

  it("uses Electron's image proxy for Kick chatter avatars, not Kick badge images", () => {
    const avatarUrl = "https://files.kick.com/images/user/123/profile_image/avatar.webp";
    const badgeUrl = "https://files.kick.com/channel/subscriber-badges/24-month.webp";
    useChatStore.setState({
      usersByChannel: {
        "kick:alpha": {
          sub: chatter("sub", "subscriber", 0, [
            {
              setId: "subscriber",
              version: "24",
              imageUrl: badgeUrl,
              title: "24-Month Subscriber",
            },
          ], avatarUrl),
        },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="kick:alpha" onClose={vi.fn()} />
    );

    const row = screen.getByText("sub").closest("li");
    const src = row?.querySelector("img")?.getAttribute("src");
    expect(src).toMatch(/^kick-image:\/\/image\?u=/);
    const encodedSource = new URL(src ?? "").searchParams.get("u") ?? "";
    expect(atob(encodedSource.replace(/-/g, "+").replace(/_/g, "/"))).toBe(avatarUrl);
    expect(row?.querySelector("img")).not.toHaveAttribute("src", badgeUrl);
  });

  it("renders a stable initial fallback when a chatter has no avatar", () => {
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
    expect(screen.getByText("V")).toBeInTheDocument();
    expect(screen.getByText("viewer")).toBeInTheDocument();
  });

  it("hydrates missing avatars through one bounded known-user enrichment request", async () => {
    const enrichMentionUsers = vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          userId: "viewer",
          username: "viewer",
          displayName: "Viewer",
          avatarUrl: "https://example.com/viewer-avatar.png",
        },
      ],
    });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { enrichMentionUsers } },
    });
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": { viewer: chatter("viewer", "viewer") },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    await waitFor(() =>
      expect(enrichMentionUsers).toHaveBeenCalledWith({
        platform: "twitch",
        channel: "alpha",
        users: [{ userId: "viewer", username: "viewer" }],
      })
    );
    await waitFor(() =>
      expect(screen.getByText("Viewer").closest("li")?.querySelector("img")).toHaveAttribute(
        "src",
        "https://example.com/viewer-avatar.png"
      )
    );
  });

  it("hydrates only the initial visible chatter window without chaining into offscreen users", async () => {
    const enrichMentionUsers = vi.fn().mockImplementation(({ users }) =>
      Promise.resolve({
        success: true,
        data: users.map((user: { userId: string; username: string }) => ({
          ...user,
          displayName: user.username,
          avatarUrl: `https://example.com/${user.username}.png`,
        })),
      })
    );
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { enrichMentionUsers } },
    });
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": Object.fromEntries(
          Array.from({ length: 30 }, (_, index) => {
            const username = `viewer-${index}`;
            return [username, chatter(username, "viewer", index)];
          })
        ),
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    await waitFor(() => expect(enrichMentionUsers).toHaveBeenCalledTimes(1));
    const requestedUsers = enrichMentionUsers.mock.calls[0][0].users;
    expect(requestedUsers).toHaveLength(12);
    expect(requestedUsers).toEqual(
      expect.arrayContaining([
        { userId: "viewer-29", username: "viewer-29" },
        { userId: "viewer-18", username: "viewer-18" },
      ])
    );
    expect(requestedUsers).not.toEqual(
      expect.arrayContaining([{ userId: "viewer-0", username: "viewer-0" }])
    );
    await waitFor(() =>
      expect(screen.getByText("viewer-29").closest("li")?.querySelector("img")).toHaveAttribute(
        "src",
        "https://example.com/viewer-29.png"
      )
    );
    expect(enrichMentionUsers).toHaveBeenCalledTimes(1);
  });

  it("hydrates a searched chatter even when it was outside the initial roster window", async () => {
    const enrichMentionUsers = vi.fn().mockResolvedValue({ success: true, data: [] });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { enrichMentionUsers } },
    });
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": Object.fromEntries(
          Array.from({ length: 30 }, (_, index) => {
            const username = `viewer-${index}`;
            return [username, chatter(username, "viewer", index)];
          })
        ),
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    await waitFor(() => expect(enrichMentionUsers).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search active chatters" }), {
      target: { value: "viewer-0" },
    });

    await waitFor(() => expect(enrichMentionUsers).toHaveBeenCalledTimes(2));
    expect(enrichMentionUsers.mock.calls[1][0].users).toEqual([
      { userId: "viewer-0", username: "viewer-0" },
    ]);
  });

  it("hydrates chatters as their group scroller reveals them", async () => {
    const enrichMentionUsers = vi.fn().mockResolvedValue({ success: true, data: [] });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { enrichMentionUsers } },
    });
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": Object.fromEntries(
          Array.from({ length: 30 }, (_, index) => {
            const username = `viewer-${index}`;
            return [username, chatter(username, "viewer", index)];
          })
        ),
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    await waitFor(() => expect(enrichMentionUsers).toHaveBeenCalledTimes(1));
    const chattersList = screen.getByRole("list", { name: "Chatters" });
    Object.defineProperty(chattersList, "scrollTop", {
      configurable: true,
      value: 32 * 12,
      writable: true,
    });
    fireEvent.scroll(chattersList);

    await waitFor(() => expect(enrichMentionUsers).toHaveBeenCalledTimes(2));
    expect(enrichMentionUsers.mock.calls[1][0].users).toEqual(
      expect.arrayContaining([{ userId: "viewer-17", username: "viewer-17" }])
    );
  });

  it("caps passive avatar hydration without blocking an explicit chatter search", async () => {
    const enrichMentionUsers = vi.fn().mockResolvedValue({ success: true, data: [] });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { enrichMentionUsers } },
    });
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": Object.fromEntries(
          Array.from({ length: 100 }, (_, index) => {
            const username = `viewer-${index}`;
            return [username, chatter(username, "viewer", index)];
          })
        ),
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    await waitFor(() => expect(enrichMentionUsers).toHaveBeenCalledTimes(1));
    const chattersList = screen.getByRole("list", { name: "Chatters" });
    Object.defineProperty(chattersList, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });
    for (let firstVisibleIndex = 12; firstVisibleIndex <= 72; firstVisibleIndex += 12) {
      chattersList.scrollTop = 32 * firstVisibleIndex;
      fireEvent.scroll(chattersList);
      await waitFor(() =>
        expect(enrichMentionUsers).toHaveBeenCalledTimes(firstVisibleIndex / 12 + 1)
      );
    }

    expect(
      enrichMentionUsers.mock.calls.flatMap(([request]) => request.users)
    ).toHaveLength(75);
    chattersList.scrollTop = 32 * 84;
    fireEvent.scroll(chattersList);
    await act(async () => Promise.resolve());
    expect(enrichMentionUsers).toHaveBeenCalledTimes(7);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search active chatters" }), {
      target: { value: "viewer-0" },
    });
    await waitFor(() => expect(enrichMentionUsers).toHaveBeenCalledTimes(8));
    expect(enrichMentionUsers.mock.calls[7][0].users).toEqual([
      { userId: "viewer-0", username: "viewer-0" },
    ]);
  });

  it("uses the latest search window after an in-flight avatar request settles", async () => {
    let resolveFirstRequest: ((result: { success: true; data: Array<never> }) => void) | undefined;
    const enrichMentionUsers = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ success: true; data: Array<never> }>((resolve) => {
            resolveFirstRequest = resolve;
          })
      )
      .mockResolvedValue({ success: true, data: [] });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { enrichMentionUsers } },
    });
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": Object.fromEntries(
          Array.from({ length: 30 }, (_, index) => {
            const username = `viewer-${index}`;
            return [username, chatter(username, "viewer", index)];
          })
        ),
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    await waitFor(() => expect(enrichMentionUsers).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search active chatters" }), {
      target: { value: "viewer-0" },
    });
    if (!resolveFirstRequest) throw new Error("Expected the first avatar request to be pending");
    resolveFirstRequest({ success: true, data: [] });

    await waitFor(() => expect(enrichMentionUsers).toHaveBeenCalledTimes(2));
    expect(enrichMentionUsers.mock.calls[1][0].users).toEqual([
      { userId: "viewer-0", username: "viewer-0" },
    ]);
  });

  it("does not hydrate new chatter rows while their group is collapsed", async () => {
    const enrichMentionUsers = vi.fn().mockResolvedValue({ success: true, data: [] });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { enrichMentionUsers } },
    });
    useChatStore.setState({
      usersByChannel: {
        "twitch:alpha": { viewer: chatter("viewer", "viewer") },
      },
    });

    render(
      <RecentChattersPanel id="recent-chatters-test" channelKey="twitch:alpha" onClose={vi.fn()} />
    );

    await waitFor(() => expect(enrichMentionUsers).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Chatters, 1 chatter" }));
    act(() => {
      useChatStore
        .getState()
        .addMessage(message("new-collapsed-viewer", new Date("2026-08-07T12:00:01Z")));
    });

    expect(enrichMentionUsers).toHaveBeenCalledTimes(1);
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

  it("preserves a group's scroll position across live additions, re-sorts, and avatar hydration", () => {
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
      useChatStore.getState().updateKnownUserProfiles("twitch:alpha", [
        {
          userId: "badge-user",
          username: "badge-user",
          displayName: "Badge User",
          avatarUrl: "https://example.com/badge-user-avatar.png",
        },
      ]);
    });
    expect(scroller.scrollTop).toBe(140);
    expect(screen.getByText("Badge User").closest("li")?.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/badge-user-avatar.png"
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
