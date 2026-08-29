import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installElectronAPIMock, renderWithProviders } from "../../../../test-utils";

const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

// Mock the profile fetcher BEFORE importing the popout — the hook runs an
// effect on mount and we don't want it touching the network.
vi.mock("@/features/chat/components/chat/mod/UserPopout/useUserProfile", () => {
  return {
    useUserProfile: vi.fn(),
  };
});

// Mock the mod-log hook the inner UserModHistory consumes so it doesn't
// reach into the real database singleton.
vi.mock("@/features/moderation/data/useModLog", () => ({
  useModLog: () => ({
    result: { state: "verified-empty", entries: [], coverage: "complete" },
    entries: [],
    loading: false,
    retry: vi.fn(),
  }),
}));

import { UserPopout, type UserPopoutProps } from "@/features/chat/components/chat/mod/UserPopout/UserPopout";
import { useUserProfile } from "@/features/chat/components/chat/mod/UserPopout/useUserProfile";
import {
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  KICK_APP_SCOPES,
  TWITCH_APP_SCOPES,
} from "@shared/auth-types";
import type { ChatMessage } from "@shared/chat-types";
import { useAuthStore } from "@/store/auth-store";
import { buildChannelKey, useChatStore } from "@/store/chat-store";
import { useModeratedChannelsStore } from "@/features/moderation/data/moderated-channels-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

const mockedUseUserProfile = vi.mocked(useUserProfile);

function pendingProfileState() {
  return {
    profile: null,
    loading: true,
    error: null,
    identity: { state: "loading" as const },
    accountCreated: { state: "loading" as const },
    follow: { state: "loading" as const },
    channel: { state: "loading" as const },
    retryIdentity: vi.fn(),
    retryAccountCreated: vi.fn(),
    retryFollow: vi.fn(),
    retryChannel: vi.fn(),
  };
}

beforeEach(() => {
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  mockedUseUserProfile.mockReset();
  useChatStore.setState({ messagesByChannel: {} });
  useAuthStore.setState({ twitchUser: null, kickUser: null });
  useModeratedChannelsStore.getState().clear();
  useReconnectDialogStore.setState({
    isOpen: false,
    platform: "twitch",
    phase: "idle",
    missingScopes: [],
    onReconnected: null,
  });
  useAuthStore.setState((state) => ({
    preferences: {
      ...(state.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
    } as typeof state.preferences,
  }));
  // Stub the electronAPI for openExternal usage inside the footer.
  const api = installElectronAPIMock();
  api.openExternal = vi.fn();
  api.auth.getToken = vi.fn().mockResolvedValue(null);
  api.auth.tokenStatus = vi.fn().mockResolvedValue({
        platform: "twitch",
        connected: false,
        valid: false,
      });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

function makeMessage(id: string, channel: string, rawContent: string): ChatMessage {
  return {
    id,
    platform: "twitch",
    type: "message",
    channel,
    userId: "u1",
    username: "alice",
    displayName: "Alice",
    color: "#fff",
    badges: [],
    content: [{ type: "text", content: rawContent }],
    rawContent,
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

function renderPopout(
  open = true,
  platform: "twitch" | "kick" = "twitch",
  avatarUrl?: string,
  username = "alice",
  openingMessage?: ChatMessage,
  badgeCatalog?: {
    state: "loading" | "ready" | "failed";
    sourceLabel: string;
    retry: () => void;
  },
  publicActions?: UserPopoutProps["publicActions"],
  queryClient?: QueryClient
) {
  return renderWithProviders(
    <UserPopout
      userId="u1"
      username={username}
      avatarUrl={avatarUrl}
      platform={platform}
      channelId="c1"
      channelSlug="streamer"
      openingMessage={openingMessage}
      badgeCatalog={badgeCatalog}
      publicActions={publicActions}
      open={open}
      onOpenChange={() => {}}
    />,
    { queryClient }
  );
}

// Guards: failed remote identity keeps chat-known identity visible and exposes a field-level retry.
// Guards: identity loading remains visible without delaying the dialog shell.
// Guards: Kick user dialogs keep Kick-specific accessible copy and external profile navigation.
// Guards: Recent chat stays channel-scoped, rich, author-truthful, and capped at four row badges.
// Guards: Exact selected-message targets survive live insertion/pruning and change only deliberately.
// Guards: Live matching inserts respect reduced motion and badge catalog states stay independently truthful.
// Guards: Copy message writes visible text to the clipboard and reports both success and failure with a toast.
// Guards: Copy message to chat passes exact visible text to the composer action without sending it.
describe("UserPopout", () => {
  it("shows qualified moderation history for platform-confirmed authority without using profile badges", async () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useAuthStore.setState({
      twitchUser: {
        id: "moderator-1",
        login: "modbob",
        displayName: "ModBob",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    useModeratedChannelsStore.setState({
      twitchModeratedChannelIds: new Set(["c1"]),
      hydratedAt: Date.now(),
      hydrating: false,
      twitchAuthority: { state: "complete", checkedAt: Date.now() },
    });
    vi.mocked(window.electronAPI.auth.tokenStatus).mockResolvedValue({
      platform: "twitch",
      connected: true,
      valid: true,
      userId: "moderator-1",
      scopes: [...TWITCH_APP_SCOPES],
    });

    renderPopout();

    expect(await screen.findByRole("heading", { name: "Moderation history" })).toBeInTheDocument();
    expect(screen.getByText("Platform actions available to StreamFusion")).toBeInTheDocument();
    expect(screen.getByText("No moderation actions available")).toBeInTheDocument();
  });

  it("keeps timeout success refreshing until target state and moderation history both refresh", async () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useAuthStore.setState({
      kickUser: {
        id: 42,
        username: "streamer",
        slug: "streamer",
        profilePic: "",
        verified: false,
      },
    });
    vi.mocked(window.electronAPI.auth.tokenStatus).mockResolvedValue({
      platform: "kick",
      connected: true,
      valid: true,
      userId: "42",
      scopes: [...KICK_APP_SCOPES],
    });

    const availableSnapshot = {
      state: "available" as const,
      snapshotId: "kick-popout-snapshot",
      verifiedAt: Date.now(),
      actorRole: "broadcaster" as const,
      policy: {
        durationUnit: "minutes" as const,
        minDuration: 1,
        maxDuration: 10_080,
        supportsReason: true,
        maxReasonLength: 100,
      },
    };
    let finishTargetRefresh!: () => void;
    const createTimeoutSnapshot = vi
      .fn()
      .mockResolvedValueOnce(availableSnapshot)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishTargetRefresh = () => resolve(availableSnapshot);
        })
      );
    const submitTimeout = vi.fn().mockResolvedValue({
      state: "success" as const,
      attemptId: "attempt-1",
    });
    const getViewerRole = vi.fn().mockResolvedValue({
      ok: true,
      isModerator: true,
      status: 200,
    });
    Object.assign(window.electronAPI, {
      moderation: { createTimeoutSnapshot, submitTimeout },
      kickChat: { getViewerRole },
    });

    let finishHistoryRefresh!: () => void;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(
      new Promise<void>((resolve) => {
        finishHistoryRefresh = resolve;
      })
    );

    renderPopout(true, "kick", undefined, "alice", undefined, undefined, undefined, queryClient);

    fireEvent.click(await screen.findByRole("button", { name: "Timeout user" }));
    fireEvent.click(screen.getByRole("button", { name: "Time out" }));
    await waitFor(() => expect(submitTimeout).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing moderation history");

    await act(async () => {
      finishTargetRefresh();
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing moderation history");
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["modLog", "kick", "c1"],
    });

    await act(async () => {
      finishHistoryRefresh();
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("history refreshed");
  });

  it("fails stale moderator authority closed with Retry and no history", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useAuthStore.setState({
      twitchUser: {
        id: "moderator-1",
        login: "modbob",
        displayName: "ModBob",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    const checkedAt = Date.now() - 5 * 60_000 - 1;
    useModeratedChannelsStore.setState({
      twitchModeratedChannelIds: new Set(["c1"]),
      hydratedAt: checkedAt,
      hydrating: false,
      twitchAuthority: { state: "complete", checkedAt },
    });

    renderPopout();

    expect(screen.getByRole("button", { name: "Couldn’t verify · Retry" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Moderation history" })).toBeNull();
  });

  it("shows one locked reconnect entry with every missing Twitch scope", async () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useAuthStore.setState({
      twitchUser: {
        id: "moderator-1",
        login: "modbob",
        displayName: "ModBob",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    const checkedAt = Date.now();
    useModeratedChannelsStore.setState({
      twitchModeratedChannelIds: new Set(["c1"]),
      hydratedAt: checkedAt,
      hydrating: false,
      twitchAuthority: { state: "complete", checkedAt },
    });
    vi.mocked(window.electronAPI.auth.tokenStatus).mockResolvedValue({
      platform: "twitch",
      connected: true,
      valid: true,
      userId: "moderator-1",
      scopes: ["chat:read"],
    });

    renderPopout();
    const reconnect = await screen.findByRole("button", { name: "Reconnect Twitch" });
    fireEvent.click(reconnect);

    const state = useReconnectDialogStore.getState();
    expect(state.platform).toBe("twitch");
    expect(state.missingScopes).toEqual(TWITCH_APP_SCOPES.filter((scope) => scope !== "chat:read"));
    expect(screen.queryByRole("heading", { name: "Moderation history" })).toBeNull();
  });

  it("does not move focus when a late Twitch authority check becomes authorized", async () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useAuthStore.setState({
      twitchUser: {
        id: "moderator-1",
        login: "modbob",
        displayName: "ModBob",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    vi.mocked(window.electronAPI.auth.tokenStatus).mockResolvedValue({
      platform: "twitch",
      connected: true,
      valid: true,
      userId: "moderator-1",
      scopes: [...TWITCH_APP_SCOPES],
    });
    renderPopout();
    const stableDialogControl = screen.getAllByRole("button", { name: "Close" })[0];
    stableDialogControl.focus();

    const checkedAt = Date.now();
    act(() => {
      useModeratedChannelsStore.setState({
        twitchModeratedChannelIds: new Set(["c1"]),
        hydratedAt: checkedAt,
        hydrating: false,
        twitchAuthority: { state: "complete", checkedAt },
      });
    });

    expect(await screen.findByRole("heading", { name: "Moderation history" })).toBeInTheDocument();
    expect(stableDialogControl).toHaveFocus();
  });

  it("exposes the complete authenticated selected-message public action footer", () => {
    const openingMessage = makeMessage("selected", "streamer", "hello Kappa");
    const onReply = vi.fn();
    const onCopyToChat = vi.fn();
    const onViewChannel = vi.fn();
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      channel: {
        state: "known",
        source: "official",
        value: { id: "u1", username: "alice", displayName: "Alice" },
      },
    });
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [openingMessage],
      },
    });

    renderPopout(true, "twitch", undefined, "alice", openingMessage, undefined, {
      replyEligibility: { state: "eligible" },
      onReply,
      onCopyToChat,
      onViewChannel,
    });

    expect(screen.getByRole("button", { name: "Reply" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy message to chat" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Translate · Coming Soon" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "View Channel" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Open Alice on Twitch" })).toBeEnabled();
  });

  it("copies the selected visible message into chat without writing to the clipboard", () => {
    const openingMessage = makeMessage("selected", "streamer", "Hello from Alice");
    const onCopyToChat = vi.fn();
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("kick", "streamer")]: [{ ...openingMessage, platform: "kick" }],
      },
    });

    renderPopout(
      true,
      "kick",
      undefined,
      "alice",
      { ...openingMessage, platform: "kick" },
      undefined,
      {
        replyEligibility: { state: "eligible" },
        onReply: vi.fn(),
        onCopyToChat,
        onViewChannel: vi.fn(),
      }
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy message to chat" }));

    expect(onCopyToChat).toHaveBeenCalledWith("Hello from Alice");
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("copies only the deliberately selected row's visible rich content and confirms success", async () => {
    const openingMessage: ChatMessage = {
      ...makeMessage("selected", "streamer", "raw content must not be copied"),
      content: [
        { type: "text", content: "Hello " },
        {
          type: "emote",
          id: "25",
          name: "Kappa",
          url: "https://example.com/kappa.png",
        },
        { type: "text", content: " " },
        { type: "mention", username: "bob" },
        { type: "text", content: " " },
        { type: "link", url: "https://example.com/hidden-target", text: "visible link" },
        { type: "text", content: " " },
        {
          type: "cheermote",
          id: "cheer100",
          name: "Cheer100",
          url: "https://example.com/cheer100.png",
          bits: 100,
        },
      ],
    };
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [openingMessage],
      },
    });

    renderPopout(true, "twitch", undefined, "alice", openingMessage);
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "Hello Kappa @bob visible link Cheer100"
      )
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Message copied");
    expect(screen.getByText("Message copied")).toBeInTheDocument();
    expect(screen.getByTestId("user-popout")).toBeInTheDocument();
  });

  it("reports clipboard failures without claiming the message was copied", async () => {
    const openingMessage = makeMessage("selected", "streamer", "copy me");
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [openingMessage],
      },
    });

    renderPopout(true, "twitch", undefined, "alice", openingMessage);
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Couldn’t copy message"));
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(screen.getByText("Couldn’t copy message")).toBeInTheDocument();
  });

  it("copies a deleted tombstone instead of retained hidden content and removes Copy when deleted rows are hidden", async () => {
    const deleted = {
      ...makeMessage("deleted", "streamer", "private retained content"),
      isDeleted: true,
      content: [{ type: "text" as const, content: "private retained content" }],
    };
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [deleted],
      },
    });
    useAuthStore.setState((state) => ({
      preferences: {
        ...(state.preferences ?? {}),
        chatDisplay: {
          ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
          deletedMessageDisplay: "tombstone",
          showClearMsg: true,
        },
      } as typeof state.preferences,
    }));

    const { unmount } = renderPopout(true, "twitch", undefined, "alice", deleted);
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Message deleted")
    );
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith("private retained content");
    unmount();

    useAuthStore.setState((state) => ({
      preferences: {
        ...(state.preferences ?? {}),
        chatDisplay: {
          ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
          showClearMsg: false,
        },
      } as typeof state.preferences,
    }));
    renderPopout(true, "twitch", undefined, "alice", deleted);

    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
  });

  it("hides Reply for guests, exposes the shared disabled reason for ineligible viewers, and omits message actions without a selection", () => {
    const openingMessage = makeMessage("selected", "streamer", "selected");
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [openingMessage],
      },
    });

    const { unmount } = renderPopout(
      true,
      "twitch",
      undefined,
      "alice",
      openingMessage,
      undefined,
      {
        replyEligibility: null,
        onReply: vi.fn(),
        onViewChannel: vi.fn(),
      }
    );
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeEnabled();
    unmount();

    renderPopout(true, "twitch", undefined, "alice", openingMessage, undefined, {
      replyEligibility: {
        state: "ineligible",
        reason: "Followers-only chat is enabled",
      },
      onReply: vi.fn(),
      onViewChannel: vi.fn(),
    });
    expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reply" })).toHaveAttribute(
      "title",
      "Followers-only chat is enabled"
    );
  });

  it("omits Reply and Copy when no message is selected", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());

    renderPopout(true, "twitch", undefined, "alice", undefined, undefined, {
      replyEligibility: { state: "eligible" },
      onReply: vi.fn(),
      onViewChannel: vi.fn(),
    });

    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
  });

  it("keeps profile navigation on the clicked chatter while Reply and Copy target the selected true author", async () => {
    const alice = makeMessage("alice-message", "streamer", "Alice authored");
    const bobReply: ChatMessage = {
      ...makeMessage("bob-reply", "streamer", "Bob selected"),
      userId: "u2",
      username: "bob",
      displayName: "Bob",
      content: [{ type: "text", content: "Bob selected" }],
      replyTo: {
        parentMessageId: alice.id,
        parentUserId: alice.userId,
        parentUsername: alice.username,
        parentDisplayName: alice.displayName,
        parentMessageBody: alice.rawContent,
      },
    };
    const onReply = vi.fn();
    const onViewChannel = vi.fn();
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      channel: {
        state: "known",
        source: "official",
        value: { id: "u1", username: "alice", displayName: "Alice" },
      },
    });
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [alice, bobReply],
      },
    });

    renderPopout(true, "twitch", undefined, "alice", bobReply, undefined, {
      replyEligibility: { state: "eligible" },
      onReply,
      onViewChannel,
    });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    fireEvent.click(screen.getByRole("button", { name: "View Channel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Alice on Twitch" }));

    expect(onReply).toHaveBeenCalledWith(bobReply);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Bob selected"));
    expect(onViewChannel).toHaveBeenCalledWith("twitch", {
      id: "u1",
      username: "alice",
      displayName: "Alice",
    });
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith("https://www.twitch.tv/alice");
  });

  it("keeps the verified-empty current-chat section visible with exact copy", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [],
      },
    });

    renderPopout(true, "twitch", undefined, "alice", undefined, {
      state: "failed",
      sourceLabel: "Twitch · Live chat",
      retry: vi.fn(),
    });

    expect(screen.getByRole("heading", { name: "Recent in this chat" })).toBeInTheDocument();
    expect(screen.getByText("No recent messages in this chat")).toBeInTheDocument();
    expect(screen.getByText("No badges on the latest message")).toBeInTheDocument();
  });

  it("uses the normal rich renderer, preserves reply authors, and caps row badges at four", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    const authored = {
      ...makeMessage("authored", "streamer", "hello Kappa"),
      badges: Array.from({ length: 6 }, (_, index) => ({
        setId: `badge-${index}`,
        version: "1",
        imageUrl: `https://example.com/badge-${index}.png`,
        title: `Badge ${index}`,
      })),
      content: [
        { type: "text" as const, content: "hello " },
        {
          type: "emote" as const,
          id: "25",
          name: "Kappa",
          url: "https://example.com/kappa.png",
        },
      ],
    };
    const reply = {
      ...makeMessage("reply", "streamer", "reply from Bob"),
      userId: "u2",
      username: "bob",
      displayName: "Bob",
      replyTo: {
        parentMessageId: authored.id,
        parentUserId: "u1",
        parentUsername: "alice",
        parentDisplayName: "Alice",
        parentMessageBody: authored.rawContent,
      },
    };
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [authored, reply],
      },
    });

    renderPopout(true, "twitch", undefined, "alice", undefined, {
      state: "failed",
      sourceLabel: "Twitch · Live chat",
      retry: vi.fn(),
    });

    const rows = within(screen.getByTestId("user-popout-recent-messages"));
    expect(rows.getByText("Alice")).toBeInTheDocument();
    expect(rows.getByText("Bob")).toBeInTheDocument();
    expect(rows.getByTestId("chat-message-reply-preview")).toHaveTextContent(
      "Replying to @Alice: hello Kappa"
    );
    expect(rows.getByRole("button", { name: "Show Kappa emote details" })).toBeInTheDocument();
    expect(rows.getAllByRole("img", { name: /^Badge / })).toHaveLength(4);
    expect(
      within(screen.getByTestId("user-profile-badges")).getAllByRole("img", {
        name: /^Badge \d\./,
      })
    ).toHaveLength(6);
  });

  it("keeps badge-source failure distinct and Retry requests a real channel reconnect", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    const retry = vi.fn();

    renderPopout(true, "twitch", undefined, "alice", undefined, {
      state: "failed",
      sourceLabel: "Twitch · Live chat",
      retry,
    });
    fireEvent.click(screen.getByRole("button", { name: "Couldn’t load badges · Retry" }));

    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders retained deleted rows with the viewer's selected deleted-message preference", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useAuthStore.setState((state) => ({
      preferences: {
        ...(state.preferences ?? {}),
        chatDisplay: {
          ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
          deletedMessageDisplay: "audit",
        },
      } as typeof state.preferences,
    }));
    const deleted = {
      ...makeMessage("deleted", "streamer", "retained deleted content"),
      isDeleted: true,
      deletedByUsername: "modbot",
    };
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [deleted],
      },
    });

    renderPopout();

    expect(screen.getByTestId("deleted-message-highlight")).toBeInTheDocument();
    expect(screen.getByText("retained deleted content")).toBeInTheDocument();
    expect(screen.getByText(/Twitch - id deleted/)).toBeInTheDocument();
  });

  it("keeps a deliberately selected exact message pinned through live insertion and pruning", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    const openingMessage = makeMessage("opening", "streamer", "opening message");
    const reply = {
      ...makeMessage("reply", "streamer", "reply from Bob"),
      userId: "u2",
      username: "bob",
      displayName: "Bob",
      replyTo: {
        parentMessageId: openingMessage.id,
        parentUserId: openingMessage.userId,
        parentUsername: openingMessage.username,
        parentDisplayName: openingMessage.displayName,
        parentMessageBody: openingMessage.rawContent,
      },
    };
    const channelKey = buildChannelKey("twitch", "streamer");
    useChatStore.setState({
      messagesByChannel: { [channelKey]: [openingMessage, reply] },
    });

    renderPopout(true, "twitch", undefined, "alice", openingMessage);
    const selectedFooter = screen.getByTestId("user-popout-selected-footer");
    expect(selectedFooter).toHaveAttribute("data-selected-message-id", openingMessage.id);

    fireEvent.click(
      screen.getByRole("button", { name: "Select message from Bob: reply from Bob" })
    );
    expect(selectedFooter).toHaveAttribute("data-selected-message-id", reply.id);
    expect(selectedFooter).toHaveAttribute("data-selected-author-id", reply.userId);
    expect(selectedFooter).toHaveAttribute("data-selected-platform", reply.platform);
    expect(selectedFooter).toHaveAttribute("data-selected-channel", reply.channel);

    act(() => {
      useChatStore.setState({
        messagesByChannel: {
          [channelKey]: Array.from({ length: 11 }, (_, index) =>
            makeMessage(`new-${index}`, "streamer", `new message ${index}`)
          ),
        },
      });
    });

    expect(screen.queryByText("reply from Bob")).toBeNull();
    expect(selectedFooter).toHaveAttribute("data-selected-message-id", reply.id);
    expect(selectedFooter).toHaveAttribute("data-selected-author-id", reply.userId);
    expect(selectedFooter).toHaveAttribute("data-selected-platform", reply.platform);
    expect(selectedFooter).toHaveAttribute("data-selected-channel", reply.channel);
  });

  it("selects rows by keyboard and scrolls live inserts without motion when requested", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    const channelKey = buildChannelKey("twitch", "streamer");
    const first = makeMessage("first", "streamer", "first message");
    const second = makeMessage("second", "streamer", "second message");
    useChatStore.setState({ messagesByChannel: { [channelKey]: [first, second] } });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    renderPopout(true, "twitch", undefined, "alice", first);
    const selectedFooter = screen.getByTestId("user-popout-selected-footer");
    const secondRowSelector = screen.getByRole("button", {
      name: "Select message from Alice: second message",
    });
    fireEvent.keyDown(secondRowSelector, { key: "Enter" });
    expect(selectedFooter).toHaveAttribute("data-selected-message-id", second.id);

    scrollIntoView.mockClear();
    act(() => {
      useChatStore.setState({
        messagesByChannel: {
          [channelKey]: [first, second, makeMessage("third", "streamer", "third message")],
        },
      });
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "nearest" });
  });

  it("opens immediately with chat-known identity while remote fields load", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    renderPopout();
    expect(screen.getByTestId("user-popout")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "alice" })).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("Profile loading…")).toBeInTheDocument();
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Open alice on Twitch" })).toBeInTheDocument();
    expect(screen.getByText("Verifying channel…")).toBeInTheDocument();
  });

  it("keeps chat-known identity visible and offers Retry when identity cannot be verified", () => {
    const retryIdentity = vi.fn();
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      loading: false,
      identity: { state: "failed", message: "Couldn’t verify" },
      error: "Couldn’t verify",
      accountCreated: { state: "failed", message: "Couldn’t verify" },
      retryIdentity,
    });
    renderPopout();
    expect(screen.getByRole("heading", { name: "alice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Profile unavailable · Retry" }));
    expect(retryIdentity).toHaveBeenCalledTimes(1);
  });

  it("renders the identity-first public profile without moderation controls", () => {
    mockedUseUserProfile.mockReturnValue({
      profile: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "",
        createdAt: "2020-01-01T00:00:00Z",
        followSince: null,
        subscription: null,
        isFounder: false,
        isVip: false,
        isMod: false,
      },
      loading: false,
      error: null,
      identity: {
        state: "known",
        source: "official",
        value: {
          userId: "u1",
          username: "alice",
          displayName: "Alice",
          avatarUrl: "",
        },
      },
      accountCreated: {
        state: "known",
        source: "first-party-fallback",
        value: "2020-01-01T00:00:00Z",
      },
      follow: { state: "negative", source: "official" },
      channel: {
        state: "known",
        source: "official",
        value: { id: "c1", username: "streamer", displayName: "Streamer" },
      },
      retryIdentity: vi.fn(),
      retryAccountCreated: vi.fn(),
      retryFollow: vi.fn(),
      retryChannel: vi.fn(),
    });
    renderPopout();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("Not following")).toBeInTheDocument();
    expect(screen.queryByTestId("user-popout-footer")).toBeNull();
    expect(screen.queryByText(/Mod history/i)).toBeNull();
    expect(screen.getByTestId("user-popout")).toHaveClass(
      "w-[calc(100vw-2rem)]",
      "max-w-[560px]",
      "max-h-[80vh]"
    );
    expect(screen.getByTestId("user-popout-body")).toHaveClass("overflow-y-auto");
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });

  it("shows recent messages from the current channel bucket only", () => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      profile: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "",
        createdAt: "2020-01-01T00:00:00Z",
        followSince: null,
        subscription: null,
        isFounder: false,
        isVip: false,
        isMod: false,
      },
      loading: false,
      error: null,
      identity: {
        state: "known",
        source: "official",
        value: {
          userId: "u1",
          username: "alice",
          displayName: "Alice",
          avatarUrl: "",
        },
      },
      accountCreated: {
        state: "known",
        source: "first-party-fallback",
        value: "2020-01-01T00:00:00Z",
      },
    });
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [
          makeMessage("current", "streamer", "right channel"),
        ],
        [buildChannelKey("twitch", "other")]: [makeMessage("other", "other", "wrong channel")],
      },
    });

    renderPopout();

    expect(screen.getByText("right channel")).toBeInTheDocument();
    expect(screen.queryByText("wrong channel")).toBeNull();
  });

  it("renders nothing in the document body when open=false", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    renderPopout(false);
    expect(screen.queryByTestId("user-popout")).toBeNull();
    expect(screen.queryByTestId("user-popout-skeleton")).toBeNull();
  });

  it("renders compactly in a short viewport", async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    mockedUseUserProfile.mockReturnValue(pendingProfileState());

    renderPopout();
    fireEvent(window, new Event("resize"));

    await waitFor(() =>
      expect(screen.getByTestId("user-popout")).toHaveAttribute("data-compact", "true")
    );
    expect(screen.getByTestId("user-popout")).toHaveClass("max-h-[calc(100vh-1rem)]");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
  });

  it("keeps external navigation available while failed internal channel verification disables View Channel and offers Retry", () => {
    const retryChannel = vi.fn();
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      channel: { state: "failed", message: "Unavailable" },
      retryChannel,
    });

    renderPopout();
    fireEvent.click(screen.getByRole("button", { name: "Open alice on Twitch" }));
    expect(screen.getByRole("button", { name: "View Channel" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Couldn’t verify · Retry" }));

    expect(window.electronAPI.openExternal).toHaveBeenCalledWith("https://www.twitch.tv/alice");
    expect(retryChannel).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "alice" })).toBeInTheDocument();
  });

  it("opens the clicked chatter channel rather than the current stream channel", () => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      channel: {
        state: "known",
        source: "official",
        value: { id: "u1", username: "alice", displayName: "Alice" },
      },
    });

    renderPopout();
    fireEvent.click(screen.getByRole("button", { name: "Open Alice on Twitch" }));

    expect(window.electronAPI.openExternal).toHaveBeenCalledWith("https://www.twitch.tv/alice");
  });

  it("preserves the Kick dialog path and opens the clicked user on Kick", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());

    renderPopout(true, "kick");
    fireEvent.click(screen.getByRole("button", { name: "Open alice on Kick" }));

    expect(window.electronAPI.openExternal).toHaveBeenCalledWith("https://kick.com/alice");
    expect(
      screen.getByText("Public Kick profile and recent messages for @alice.")
    ).toBeInTheDocument();
  });

  it("opens a verified Kick internal channel through the app action", () => {
    const onViewChannel = vi.fn();
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      channel: {
        state: "known",
        source: "official",
        value: {
          id: "kick-user",
          username: "antithesisofspace",
          displayName: "AntithesisOfSpace",
        },
      },
    });

    renderPopout(true, "kick", undefined, "AntithesisOfSpace", undefined, undefined, {
      replyEligibility: null,
      onReply: vi.fn(),
      onViewChannel,
    });
    fireEvent.click(screen.getByRole("button", { name: "View Channel" }));

    expect(onViewChannel).toHaveBeenCalledWith("kick", {
      id: "kick-user",
      username: "antithesisofspace",
      displayName: "AntithesisOfSpace",
    });
  });

  it.each(["unavailable", "failed"] as const)(
    "keeps the chat-known Kick profile link available when channel enrichment is %s",
    (channelState) => {
      mockedUseUserProfile.mockReturnValue({
        ...pendingProfileState(),
        channel: { state: channelState, message: "Unavailable" },
      });

      renderPopout(true, "kick", undefined, "AntithesisOfSpace");
      fireEvent.click(screen.getByRole("button", { name: "Open AntithesisOfSpace on Kick" }));

      expect(window.electronAPI.openExternal).toHaveBeenCalledWith(
        "https://kick.com/antithesisofspace"
      );
      expect(screen.getByRole("button", { name: "View Channel" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Couldn’t verify · Retry" })).toBeEnabled();
    }
  );

  it("preserves a chat-event Kick avatar when official enrichment has no avatar", () => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      loading: false,
      identity: {
        state: "known",
        source: "official",
        value: {
          userId: "u1",
          username: "alice",
          displayName: "Alice",
          avatarUrl: "",
        },
      },
    });

    renderPopout(true, "kick", "https://files.kick.com/chat-avatar.webp");

    expect(screen.getByRole("img", { name: "Alice avatar" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Alice avatar unavailable" })).toBeNull();
  });

  it("announces failed remote fields politely", () => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      accountCreated: { state: "failed", message: "Couldn’t verify" },
      follow: { state: "reconnect-required", missingScopes: ["moderator:read:followers"] },
      channel: { state: "failed", message: "Unavailable" },
    });

    renderPopout();

    const liveRegion = document.querySelector("[aria-live='polite']");
    expect(liveRegion).toHaveTextContent("Account creation date could not be verified.");
    expect(liveRegion).toHaveTextContent("Reconnect Twitch to verify the follow relationship.");
    expect(liveRegion).toHaveTextContent("Channel is unavailable.");
  });

  it("announces each unavailable remote field once", () => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      identity: { state: "unavailable", message: "Unavailable" },
      accountCreated: { state: "unavailable", message: "Unavailable" },
      follow: { state: "unavailable", message: "Unavailable" },
      channel: { state: "unavailable", message: "Unavailable" },
    });

    renderPopout();

    const liveRegion = document.querySelector("[aria-live='polite']");
    expect(liveRegion).toHaveTextContent(
      "Profile identity is unavailable. Account creation date is unavailable. Follow relationship is unavailable. Channel is unavailable."
    );
  });
});
