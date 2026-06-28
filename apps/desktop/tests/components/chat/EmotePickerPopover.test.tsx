import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Emote, EmoteProvider } from "@/backend/services/emotes/emote-types";

const toastMocks = vi.hoisted(() => ({
  warning: vi.fn(),
}));

/* ------------------------------------------------------------------------- */
/* Mutable store mock (selector-capable, mirrors EmotePicker.test pattern)   */
/* ------------------------------------------------------------------------- */

interface MockState {
  loadedGlobalPlatforms: Set<"twitch" | "kick">;
  loadedChannels: Set<string>;
  emoteRevision: number;
  activeChannelId: string | null;
  favoriteEmotes: Emote[];
  recentEmotes: Emote[];
  isLoading: boolean;
  emotesByProvider: Map<EmoteProvider, Emote[]>;
  getEmotesByProvider: () => Map<EmoteProvider, Emote[]>;
  loadGlobalEmotes: ReturnType<typeof vi.fn>;
  loadChannelEmotes: ReturnType<typeof vi.fn>;
  addRecentEmote: ReturnType<typeof vi.fn>;
  toggleFavorite: ReturnType<typeof vi.fn>;
  isFavorite: (id: string) => boolean;
  favoriteIds: Set<string>;
}

const mockState: MockState = {
  loadedGlobalPlatforms: new Set(["twitch"]),
  loadedChannels: new Set(),
  emoteRevision: 0,
  activeChannelId: null,
  favoriteEmotes: [],
  recentEmotes: [],
  isLoading: false,
  emotesByProvider: new Map(),
  getEmotesByProvider: () => mockState.emotesByProvider,
  loadGlobalEmotes: vi.fn(),
  loadChannelEmotes: vi.fn(),
  addRecentEmote: vi.fn(),
  toggleFavorite: vi.fn(),
  isFavorite: (id: string) => mockState.favoriteIds.has(id),
  favoriteIds: new Set(),
};

vi.mock("@/store/emote-store", () => ({
  useEmoteStore: (selector?: (s: MockState) => unknown) =>
    selector ? selector(mockState) : mockState,
}));

vi.mock("sonner", () => ({
  toast: {
    warning: toastMocks.warning,
  },
}));

beforeEach(() => {
  // Reset state
  mockState.recentEmotes = [];
  mockState.favoriteEmotes = [];
  mockState.emotesByProvider = new Map();
  mockState.favoriteIds = new Set();
  mockState.loadedGlobalPlatforms = new Set(["twitch"]);
  mockState.loadedChannels = new Set();
  mockState.emoteRevision = 0;
  mockState.activeChannelId = null;
  mockState.loadGlobalEmotes.mockReset();
  mockState.loadChannelEmotes.mockReset();
  mockState.addRecentEmote.mockReset();
  mockState.toggleFavorite.mockReset();
  toastMocks.warning.mockReset();
  Reflect.deleteProperty(window, "electronAPI");
});

import { EmotePickerPopover } from "@/components/chat/EmotePickerPopover";

type IntendedEmotePickerPopoverProps = React.ComponentProps<typeof EmotePickerPopover> & {
  channelLabel?: string | null;
};

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function makeEmote(
  partial: Partial<Emote> & { id: string; name: string; provider: EmoteProvider }
): Emote {
  return {
    id: partial.id,
    name: partial.name,
    provider: partial.provider,
    isGlobal: partial.isGlobal ?? false,
    availability: partial.availability,
    isAnimated: partial.isAnimated ?? false,
    isZeroWidth: partial.isZeroWidth ?? false,
    channelId: partial.channelId,
    urls: partial.urls ?? {
      url1x: `https://example.test/${partial.id}/1x.webp`,
      url2x: `https://example.test/${partial.id}/2x.webp`,
    },
    owner: partial.owner,
    subscribersOnly: partial.subscribersOnly,
    kickSection: partial.kickSection,
  };
}

function renderPicker(props: Partial<IntendedEmotePickerPopoverProps> = {}) {
  // Create a real anchor element attached to the DOM.
  const anchor = document.createElement("button");
  anchor.textContent = "anchor";
  document.body.appendChild(anchor);
  const anchorRef = { current: anchor } as React.RefObject<HTMLElement>;
  const onClose = props.onClose ?? vi.fn();
  const onSelect = props.onSelect ?? vi.fn();
  const pickerProps: IntendedEmotePickerPopoverProps = {
    isOpen: props.isOpen ?? true,
    onClose,
    onSelect,
    anchorRef,
    scope: props.scope ?? "native",
    platform: props.platform ?? "kick",
    channelId: props.channelId ?? "chan-1",
    channelName: props.channelName,
    kickUserId: props.kickUserId,
    viewerIsSubscribed: props.viewerIsSubscribed,
    channelAvatarUrl: props.channelAvatarUrl,
    channelLabel: props.channelLabel,
  };
  const utils = render(<EmotePickerPopover {...pickerProps} />);
  return { ...utils, onClose, onSelect, anchor };
}

function findSection(title: string): HTMLElement | null {
  const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-emote-section-id]"));
  return (
    sections.find((section) => {
      const heading = section.querySelector(":scope > div > span");
      return (heading?.textContent ?? "").trim().toLowerCase().startsWith(title.toLowerCase());
    }) ?? null
  );
}

function findSectionById(id: string): HTMLElement | null {
  return document.querySelector(`[data-emote-section-id="${id}"]`);
}

function mockElementScrollIntoView() {
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  return scrollIntoView;
}

function installElectronAuthMock(scopes: string[] | string[][]) {
  const statusQueue = Array.isArray(scopes[0]) ? [...(scopes as string[][])] : null;
  const fallbackScopes = statusQueue ? (statusQueue.at(-1) ?? []) : (scopes as string[]);
  const auth = {
    tokenStatus: vi.fn().mockImplementation(() =>
      Promise.resolve({
        platform: "twitch",
        connected: true,
        valid: true,
        scopes: statusQueue ? (statusQueue.shift() ?? fallbackScopes) : fallbackScopes,
      })
    ),
    logoutTwitch: vi.fn().mockResolvedValue({ success: true }),
    openTwitchLogin: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { auth },
  });
  return auth;
}

/* ------------------------------------------------------------------------- */
/* Tests                                                                     */
/* ------------------------------------------------------------------------- */

// Guards: picker navigation, selection, and provider grouping must keep working while large emote sets are windowed to avoid live-stream CPU and memory spikes.
// Guards: native emote pickers keep global emotes at the top of the provider list so they are visible at scrollTop=0.
describe("EmotePickerPopover", () => {
  it("renders nothing when closed", () => {
    const { container } = renderPicker({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it("force-loads platform globals once when opened with an empty scoped provider cache", async () => {
    mockState.emotesByProvider = new Map();
    renderPicker({ scope: "thirdParty", platform: "kick", channelId: "chatroom-1" });

    await waitFor(() => {
      expect(mockState.loadGlobalEmotes).toHaveBeenCalledWith("kick", { force: true });
    });
    expect(mockState.loadGlobalEmotes).toHaveBeenCalledTimes(1);
  });

  it("force-loads platform globals when only channel emotes are already cached", async () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "twitch",
        [
          makeEmote({
            id: "channel-only",
            name: "streamerWave",
            provider: "twitch",
            availability: "channel",
          }),
        ],
      ],
    ]);
    renderPicker({ scope: "native", platform: "twitch", channelId: "123" });

    await waitFor(() => {
      expect(mockState.loadGlobalEmotes).toHaveBeenCalledWith("twitch", { force: true });
    });
  });

  it("force-loads the watched channel emotes when opened with an empty scoped channel cache", async () => {
    mockState.emotesByProvider = new Map();
    renderPicker({
      scope: "thirdParty",
      platform: "kick",
      channelId: "chatroom-1",
      channelName: "xqc",
      channelLabel: "xQc",
      kickUserId: "676",
    });

    await waitFor(() => {
      expect(mockState.loadChannelEmotes).toHaveBeenCalledWith("chatroom-1", "xqc", "kick", "676", {
        force: true,
      });
    });
    expect(mockState.loadChannelEmotes).toHaveBeenCalledTimes(1);
  });

  it("renders Kick provider section only for scope=native platform=kick", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["kick", [makeEmote({ id: "k1", name: "kickHype", provider: "kick" })]],
      ["7tv", [makeEmote({ id: "s1", name: "PogChamp", provider: "7tv" })]],
    ]);
    renderPicker({ scope: "native", platform: "kick" });
    expect(findSection("Channel")).not.toBeNull();
    expect(findSection("Global")).not.toBeNull();
    expect(findSection("Emojis")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^7TV/ })).not.toBeInTheDocument();
  });

  it.each([
    {
      platform: "kick" as const,
      provider: "kick" as EmoteProvider,
      globalEmote: makeEmote({
        id: "kick-global",
        name: "kickGlobal",
        provider: "kick",
        isGlobal: true,
        kickSection: "global",
      }),
      channelEmote: makeEmote({
        id: "kick-channel",
        name: "kickChannel",
        provider: "kick",
        kickSection: "channel",
      }),
      userEmote: makeEmote({
        id: "kick-user",
        name: "kickUser",
        provider: "kick",
        availability: "user",
        kickSection: "subscribed",
        owner: { id: "kick-owner", username: "owner", displayName: "Owner" },
      }),
    },
    {
      platform: "twitch" as const,
      provider: "twitch" as EmoteProvider,
      globalEmote: makeEmote({
        id: "twitch-global",
        name: "twitchGlobal",
        provider: "twitch",
        isGlobal: true,
        availability: "global",
      }),
      channelEmote: makeEmote({
        id: "twitch-channel",
        name: "twitchChannel",
        provider: "twitch",
        availability: "channel",
      }),
      userEmote: makeEmote({
        id: "twitch-user",
        name: "twitchUser",
        provider: "twitch",
        availability: "user",
        owner: { id: "twitch-owner", username: "owner", displayName: "Owner" },
      }),
    },
  ])("renders native $platform globals before channel-scoped sections", ({
    platform,
    provider,
    globalEmote,
    channelEmote,
    userEmote,
  }) => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [provider, [channelEmote, userEmote, globalEmote]],
    ]);

    renderPicker({ scope: "native", platform, channelLabel: "CurrentStreamer" });

    const sectionIds = Array.from(
      document.querySelectorAll<HTMLElement>("[data-emote-section-id]")
    ).map((section) => section.dataset.emoteSectionId);
    const providerSectionIds = sectionIds.filter((id) => id !== "frequent" && id !== "favorites");

    expect(providerSectionIds[0]).toBe("global");
    expect(providerSectionIds.indexOf("global")).toBeLessThan(
      providerSectionIds.indexOf("channel")
    );
    expect(providerSectionIds.indexOf("global")).toBeLessThan(
      providerSectionIds.findIndex((id) => id?.startsWith("subscribed-"))
    );
    expect(screen.getByLabelText(globalEmote.name)).toBeInTheDocument();
  });

  it("hides the native Twitch channel section when the streamer has no channel emotes", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "twitch",
        [makeEmote({ id: "global-1", name: "Kappa", provider: "twitch", isGlobal: true })],
      ],
    ]);
    renderPicker({ scope: "native", platform: "twitch", channelLabel: "SmallStreamer" });

    expect(screen.queryByRole("button", { name: "Channel", pressed: false })).toBeNull();
    expect(findSection("SmallStreamer")).toBeNull();
    expect(findSection("Global")).not.toBeNull();
    expect(screen.getByLabelText("Kappa")).toBeInTheDocument();
  });

  it("renders native Twitch user-available emotes as subscribed-channel avatar tabs", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "twitch",
        [
          makeEmote({
            id: "channel-1",
            name: "streamerWave",
            provider: "twitch",
            availability: "channel",
          }),
          makeEmote({
            id: "user-1",
            name: "otherSubWave",
            provider: "twitch",
            availability: "user",
            owner: {
              id: "owner-1",
              username: "otherchannel",
              displayName: "OtherChannel",
              avatarUrl: "https://example.test/otherchannel/avatar.webp",
            },
          }),
          makeEmote({
            id: "global-1",
            name: "Kappa",
            provider: "twitch",
            isGlobal: true,
            availability: "global",
          }),
        ],
      ],
    ]);

    renderPicker({ scope: "native", platform: "twitch", channelLabel: "CurrentStreamer" });

    const ownerTab = screen.getByRole("button", {
      name: "OtherChannel's Emotes",
      pressed: false,
    });
    expect(ownerTab.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.test/otherchannel/avatar.webp"
    );
    expect(screen.queryByRole("button", { name: "Subscribed" })).not.toBeInTheDocument();
    const subscribedSection = findSectionById("subscribed-twitch-owner-1");
    const channelSection = findSectionById("channel");
    const globalSection = findSectionById("global");
    expect(subscribedSection).not.toBeNull();
    expect(channelSection).not.toBeNull();
    expect(globalSection).not.toBeNull();
    if (!subscribedSection || !channelSection || !globalSection) return;

    expect(within(subscribedSection).getByLabelText("otherSubWave")).toBeInTheDocument();
    expect(within(channelSection).queryByLabelText("otherSubWave")).not.toBeInTheDocument();
    expect(within(globalSection).queryByLabelText("otherSubWave")).not.toBeInTheDocument();
  });

  it("keeps the Twitch reconnect notice when reauthorization still does not grant user-emote scope", async () => {
    const auth = installElectronAuthMock(["chat:read", "chat:edit"]);
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "twitch",
        [
          makeEmote({
            id: "channel-1",
            name: "streamerWave",
            provider: "twitch",
            availability: "channel",
          }),
          makeEmote({
            id: "global-1",
            name: "Kappa",
            provider: "twitch",
            isGlobal: true,
            availability: "global",
          }),
        ],
      ],
    ]);

    renderPicker({ scope: "native", platform: "twitch", channelLabel: "CurrentStreamer" });

    expect(await screen.findByTestId("twitch-user-emote-scope-notice")).toHaveTextContent(
      "Reconnect Twitch to show subscribed-channel emotes."
    );
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    await waitFor(() => {
      expect(auth.openTwitchLogin).toHaveBeenCalledTimes(1);
    });
    expect(auth.logoutTwitch).toHaveBeenCalledTimes(1);
    expect(auth.logoutTwitch.mock.invocationCallOrder[0]).toBeLessThan(
      auth.openTwitchLogin.mock.invocationCallOrder[0]
    );
    await waitFor(() => {
      expect(toastMocks.warning).toHaveBeenCalledWith(
        "Twitch did not grant subscribed-channel emote access.",
        { description: "Authorize the user:read:emotes scope to load those emotes." }
      );
    });
    expect(mockState.loadGlobalEmotes).not.toHaveBeenCalledWith("twitch", { force: true });
    expect(screen.getByTestId("twitch-user-emote-scope-notice")).toBeInTheDocument();
  });

  it("does not start the native Twitch user-emote load while reconnect is required", async () => {
    installElectronAuthMock(["chat:read", "chat:edit"]);
    mockState.emotesByProvider = new Map();

    renderPicker({ scope: "native", platform: "twitch", channelLabel: "CurrentStreamer" });

    expect(await screen.findByTestId("twitch-user-emote-scope-notice")).toBeInTheDocument();
    expect(mockState.loadGlobalEmotes).not.toHaveBeenCalledWith("twitch", { force: true });
  });

  it("reloads native Twitch emotes when reauthorization grants user-emote scope", async () => {
    const auth = installElectronAuthMock([
      ["chat:read", "chat:edit"],
      ["chat:read", "chat:edit", "user:read:emotes"],
    ]);
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "twitch",
        [
          makeEmote({
            id: "global-1",
            name: "Kappa",
            provider: "twitch",
            isGlobal: true,
            availability: "global",
          }),
        ],
      ],
    ]);

    renderPicker({ scope: "native", platform: "twitch", channelLabel: "CurrentStreamer" });

    expect(await screen.findByTestId("twitch-user-emote-scope-notice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    await waitFor(() => {
      expect(auth.openTwitchLogin).toHaveBeenCalledTimes(1);
    });
    expect(auth.logoutTwitch).toHaveBeenCalledTimes(1);
    expect(auth.logoutTwitch.mock.invocationCallOrder[0]).toBeLessThan(
      auth.openTwitchLogin.mock.invocationCallOrder[0]
    );
    await waitFor(() => {
      expect(mockState.loadGlobalEmotes).toHaveBeenCalledWith("twitch", { force: true });
    });
  });

  it("does not show the Twitch reconnect notice when user-emote scope is granted", async () => {
    const auth = installElectronAuthMock(["chat:read", "user:read:emotes"]);
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "twitch",
        [
          makeEmote({
            id: "global-1",
            name: "Kappa",
            provider: "twitch",
            isGlobal: true,
            availability: "global",
          }),
        ],
      ],
    ]);

    renderPicker({ scope: "native", platform: "twitch" });

    await waitFor(() => {
      expect(auth.tokenStatus).toHaveBeenCalledWith("twitch");
    });
    expect(screen.queryByTestId("twitch-user-emote-scope-notice")).not.toBeInTheDocument();
  });

  it("hides the native Kick channel section when the streamer has no channel emotes", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "emoji-1",
            name: "emojiSmile",
            provider: "kick",
            isGlobal: true,
            kickSection: "emoji",
          }),
        ],
      ],
    ]);
    renderPicker({ scope: "native", platform: "kick", channelLabel: "SmallStreamer" });

    expect(screen.queryByRole("button", { name: "Channel", pressed: false })).toBeNull();
    expect(findSection("SmallStreamer")).toBeNull();
    expect(findSection("Emojis")).not.toBeNull();
    expect(screen.getByLabelText("emojiSmile")).toBeInTheDocument();
  });

  it("keeps a native streamer section visible when search has no matches but the channel owns emotes", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["twitch", [makeEmote({ id: "t1", name: "streamerWave", provider: "twitch" })]],
    ]);
    renderPicker({ scope: "native", platform: "twitch", channelLabel: "PartneredStreamer" });

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "nope" } });

    const channelSection = findSection("PartneredStreamer");
    expect(channelSection).not.toBeNull();
    if (!channelSection) return;
    expect(within(channelSection).getByText("No emotes")).toBeInTheDocument();
  });

  it("hides the Kick 7TV channel section when the watched channel has no 7TV emotes", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["7tv", [makeEmote({ id: "global-7tv", name: "RainTime", provider: "7tv", isGlobal: true })]],
    ]);
    renderPicker({ scope: "thirdParty", platform: "kick", channelLabel: "SmallStreamer" });

    expect(screen.queryByRole("button", { name: "7TV Channel" })).toBeNull();
    expect(screen.getByRole("button", { name: "7TV Global", pressed: true })).toBeInTheDocument();
    expect(findSection("SmallStreamer")).toBeNull();
    expect(findSection("7TV")).not.toBeNull();
    expect(screen.getByLabelText("RainTime")).toBeInTheDocument();
  });

  it("keeps the Kick 7TV channel section visible when search has no matches but the channel owns emotes", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["7tv", [makeEmote({ id: "stv-channel", name: "streamerWave", provider: "7tv" })]],
    ]);
    renderPicker({ scope: "thirdParty", platform: "kick", channelLabel: "PartneredStreamer" });

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "nope" } });

    expect(screen.getByRole("button", { name: "7TV Channel", pressed: true })).toBeInTheDocument();
    const stvSection = findSection("7TV");
    expect(stvSection).not.toBeNull();
    if (!stvSection) return;
    expect(within(stvSection).getByText("No emotes")).toBeInTheDocument();
  });

  it("renders 7TV, BTTV, FFZ sections for scope=thirdParty platform=twitch", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["7tv", [makeEmote({ id: "s1", name: "PogChamp", provider: "7tv" })]],
      ["bttv", [makeEmote({ id: "b1", name: "monkaS", provider: "bttv" })]],
      ["ffz", [makeEmote({ id: "f1", name: "OhMyDog", provider: "ffz" })]],
    ]);
    renderPicker({ scope: "thirdParty", platform: "twitch" });
    expect(findSection("7TV")).not.toBeNull();
    expect(findSection("BetterTTV")).not.toBeNull();
    expect(findSection("FrankerFaceZ")).not.toBeNull();
  });

  it("renders Channel and Global tabs inside each Twitch third-party provider", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "7tv",
        [
          makeEmote({ id: "s-channel", name: "stvChannel", provider: "7tv" }),
          makeEmote({ id: "s-global", name: "stvGlobal", provider: "7tv", isGlobal: true }),
        ],
      ],
      [
        "bttv",
        [
          makeEmote({ id: "b-channel", name: "bttvChannel", provider: "bttv" }),
          makeEmote({ id: "b-global", name: "bttvGlobal", provider: "bttv", isGlobal: true }),
        ],
      ],
      [
        "ffz",
        [
          makeEmote({ id: "f-channel", name: "ffzChannel", provider: "ffz" }),
          makeEmote({ id: "f-global", name: "ffzGlobal", provider: "ffz", isGlobal: true }),
        ],
      ],
    ]);
    renderPicker({ scope: "thirdParty", platform: "twitch" });

    for (const providerName of ["7TV", "BetterTTV", "FrankerFaceZ"]) {
      expect(
        screen.getByRole("button", { name: `${providerName} Channel`, pressed: true })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `${providerName} Global`, pressed: false })
      ).toBeInTheDocument();
    }

    const stvSection = findSectionById("7tv");
    expect(stvSection).not.toBeNull();
    if (!stvSection) return;
    expect(within(stvSection).getByLabelText("stvChannel")).toBeInTheDocument();
    expect(within(stvSection).queryByLabelText("stvGlobal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "7TV Global", pressed: false }));

    expect(within(stvSection).getByLabelText("stvGlobal")).toBeInTheDocument();
    expect(within(stvSection).queryByLabelText("stvChannel")).not.toBeInTheDocument();
  });

  it("hides a provider Channel tab when that provider only has global emotes", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["ffz", [makeEmote({ id: "f-global", name: "ffzGlobal", provider: "ffz", isGlobal: true })]],
    ]);
    renderPicker({ scope: "thirdParty", platform: "twitch" });

    expect(screen.queryByRole("button", { name: "FrankerFaceZ Channel" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "FrankerFaceZ Global", pressed: true })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("ffzGlobal")).toBeInTheDocument();
  });

  it("pins Frequently Used and Favorites at the top of the body", () => {
    mockState.recentEmotes = [makeEmote({ id: "k1", name: "kickHype", provider: "kick" })];
    mockState.favoriteEmotes = [makeEmote({ id: "k2", name: "kickFav", provider: "kick" })];
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["kick", [makeEmote({ id: "k3", name: "kickEmote", provider: "kick" })]],
    ]);
    renderPicker({ scope: "native", platform: "kick" });
    expect(findSection("Recent")).toBeNull();
    expect(findSection("Frequently Used")).not.toBeNull();

    const titles = Array.from(
      document.querySelectorAll<HTMLElement>("[data-emote-section-id] > div > span")
    ).map((h) => h.textContent ?? "");
    const frequentIdx = titles.findIndex((t) => t.startsWith("Frequently Used"));
    const favoritesIdx = titles.findIndex((t) => t.startsWith("Favorites"));
    const emojiIdx = titles.findIndex((t) => t.startsWith("Emojis"));
    expect(frequentIdx).not.toBe(-1);
    expect(frequentIdx).toBeLessThan(emojiIdx);
    expect(favoritesIdx).toBeLessThan(emojiIdx);
  });

  it("filters Frequently Used to scope providers", () => {
    mockState.recentEmotes = [
      makeEmote({ id: "k1", name: "kickHype", provider: "kick" }),
      makeEmote({ id: "s1", name: "PogChamp", provider: "7tv" }),
    ];
    renderPicker({ scope: "native", platform: "kick" });
    expect(findSection("Frequently Used")).not.toBeNull();
    // Only kickHype should appear in Frequently Used (scoped to kick provider).
    expect(screen.getByLabelText("kickHype")).toBeInTheDocument();
    expect(screen.queryByLabelText("PogChamp")).not.toBeInTheDocument();
  });

  it("does not bury native Kick global emotes under empty pinned sections", () => {
    mockState.recentEmotes = [];
    mockState.favoriteEmotes = [];
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "k-global",
            name: "globalKick",
            provider: "kick",
            isGlobal: true,
            kickSection: "global",
          }),
          makeEmote({
            id: "k-emoji",
            name: "kickSmile",
            provider: "kick",
            isGlobal: true,
            kickSection: "emoji",
          }),
        ],
      ],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    expect(
      screen.getByRole("button", { name: "Frequently Used", pressed: true })
    ).toBeInTheDocument();
    expect(findSection("Frequently Used")).not.toBeNull();
    expect(findSection("Favorites")).not.toBeNull();
    expect(screen.queryByText("No emotes")).not.toBeInTheDocument();
    expect(findSection("Global")).not.toBeNull();
    expect(screen.getByLabelText("globalKick")).toBeInTheDocument();
  });

  it("filters by search within scope", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "7tv",
        [
          makeEmote({ id: "s1", name: "PogChamp", provider: "7tv" }),
          makeEmote({ id: "s2", name: "KEKW", provider: "7tv" }),
        ],
      ],
      ["bttv", [makeEmote({ id: "b1", name: "monkaS", provider: "bttv" })]],
    ]);
    renderPicker({ scope: "thirdParty", platform: "twitch" });
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "pog" } });
    expect(screen.getByLabelText("PogChamp")).toBeInTheDocument();
    expect(screen.queryByLabelText("KEKW")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("monkaS")).not.toBeInTheDocument();
  });

  it("renders a Frequently Used sub-section button that scrolls to the pinned section", () => {
    const scrollIntoView = mockElementScrollIntoView();
    mockState.recentEmotes = [makeEmote({ id: "k-r", name: "oftenUsed", provider: "kick" })];
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["kick", [makeEmote({ id: "k1", name: "kickHype", provider: "kick" })]],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    const frequentlyUsedButton = screen.getByRole("button", {
      name: "Frequently Used",
      pressed: true,
    });
    fireEvent.click(frequentlyUsedButton);

    expect(findSection("Frequently Used")).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("shows a Kick-style underline under the selected sub-section button", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "k-channel",
            name: "streamerWave",
            provider: "kick",
            isGlobal: false,
            kickSection: "channel",
          }),
          makeEmote({
            id: "k-global",
            name: "globalKick",
            provider: "kick",
            isGlobal: true,
            kickSection: "global",
          }),
        ],
      ],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    expect(screen.getByTestId("emote-subsection-rail")).toHaveClass(
      "bottom-0",
      "left-0",
      "right-3",
      "z-0",
      "h-0.5",
      "bg-[rgba(240,241,242,0.16)]"
    );

    const frequentButton = screen.getByRole("button", {
      name: "Frequently Used",
      pressed: true,
    });
    expect(within(frequentButton).getByTestId("emote-subsection-active-indicator")).toHaveClass(
      "-bottom-1.5",
      "z-20",
      "h-0.5",
      "w-full",
      "bg-white"
    );
    expect(screen.getAllByTestId("emote-subsection-active-indicator")).toHaveLength(1);

    const channelButton = screen.getByRole("button", { name: "Channel", pressed: false });
    fireEvent.click(channelButton);

    expect(channelButton).toHaveAttribute("aria-pressed", "true");
    expect(
      within(channelButton).getByTestId("emote-subsection-active-indicator")
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("emote-subsection-active-indicator")).toHaveLength(1);
  });

  it("updates the active native Kick sub-section button as the picker body scrolls", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "k-channel",
            name: "streamerWave",
            provider: "kick",
            isGlobal: false,
            kickSection: "channel",
          }),
          makeEmote({
            id: "k-global",
            name: "globalKick",
            provider: "kick",
            isGlobal: true,
            kickSection: "global",
          }),
          makeEmote({
            id: "k-emoji",
            name: "kickSmile",
            provider: "kick",
            isGlobal: true,
            kickSection: "emoji",
          }),
        ],
      ],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    const scrollRoot = document.querySelector(
      '[data-testid="emote-picker-popover"] .overflow-y-auto'
    ) as HTMLElement;
    const frequentSection = findSectionById("frequent");
    const globalSection = findSectionById("global");
    const channelSection = findSectionById("channel");
    const emojiSection = findSectionById("emoji");
    expect(scrollRoot).not.toBeNull();
    expect(frequentSection).not.toBeNull();
    expect(globalSection).not.toBeNull();
    expect(channelSection).not.toBeNull();
    expect(emojiSection).not.toBeNull();
    if (!frequentSection || !globalSection || !channelSection || !emojiSection) return;

    for (const [section, offsetTop] of [
      [frequentSection, 0],
      [globalSection, 80],
      [channelSection, 420],
      [emojiSection, 760],
    ] as const) {
      Object.defineProperty(section, "offsetTop", {
        configurable: true,
        value: offsetTop,
      });
    }
    Object.defineProperty(scrollRoot, "clientHeight", {
      configurable: true,
      value: 360,
    });
    Object.defineProperty(scrollRoot, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    scrollRoot.scrollTop = 80;
    fireEvent.scroll(scrollRoot);
    expect(screen.getByRole("button", { name: "Global", pressed: true })).toBeInTheDocument();

    scrollRoot.scrollTop = 410;
    fireEvent.scroll(scrollRoot);
    expect(screen.getByRole("button", { name: "Channel", pressed: true })).toBeInTheDocument();

    scrollRoot.scrollTop = 740;
    fireEvent.scroll(scrollRoot);
    expect(screen.getByRole("button", { name: "Emojis", pressed: true })).toBeInTheDocument();
  });

  it("keeps the clicked native Kick sub-section active during smooth-scroll startup", () => {
    mockElementScrollIntoView();
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "k-channel",
            name: "streamerWave",
            provider: "kick",
            isGlobal: false,
            kickSection: "channel",
          }),
          makeEmote({
            id: "k-global",
            name: "globalKick",
            provider: "kick",
            isGlobal: true,
            kickSection: "global",
          }),
          makeEmote({
            id: "k-emoji",
            name: "kickSmile",
            provider: "kick",
            isGlobal: true,
            kickSection: "emoji",
          }),
        ],
      ],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    const scrollRoot = document.querySelector(
      '[data-testid="emote-picker-popover"] .overflow-y-auto'
    ) as HTMLElement;
    const frequentSection = findSectionById("frequent");
    const globalSection = findSectionById("global");
    const channelSection = findSectionById("channel");
    expect(scrollRoot).not.toBeNull();
    expect(frequentSection).not.toBeNull();
    expect(globalSection).not.toBeNull();
    expect(channelSection).not.toBeNull();
    if (!frequentSection || !globalSection || !channelSection) return;

    for (const [section, offsetTop] of [
      [frequentSection, 0],
      [globalSection, 80],
      [channelSection, 420],
    ] as const) {
      Object.defineProperty(section, "offsetTop", {
        configurable: true,
        value: offsetTop,
      });
    }
    Object.defineProperty(scrollRoot, "clientHeight", {
      configurable: true,
      value: 360,
    });
    Object.defineProperty(scrollRoot, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    fireEvent.click(screen.getByRole("button", { name: "Channel", pressed: false }));
    expect(screen.getByRole("button", { name: "Channel", pressed: true })).toBeInTheDocument();

    scrollRoot.scrollTop = 80;
    fireEvent.scroll(scrollRoot);

    expect(screen.getByRole("button", { name: "Channel", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Global", pressed: false })).toBeInTheDocument();
  });

  it("sub-section navigation (thirdParty twitch): click 7TV scrolls without hiding BTTV/FFZ", () => {
    const scrollIntoView = mockElementScrollIntoView();
    mockState.recentEmotes = [makeEmote({ id: "s-r", name: "recentSTV", provider: "7tv" })];
    mockState.favoriteEmotes = [makeEmote({ id: "s-f", name: "favSTV", provider: "7tv" })];
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["7tv", [makeEmote({ id: "s1", name: "PogChamp", provider: "7tv" })]],
      ["bttv", [makeEmote({ id: "b1", name: "monkaS", provider: "bttv" })]],
      ["ffz", [makeEmote({ id: "f1", name: "OhMyDog", provider: "ffz" })]],
    ]);
    renderPicker({ scope: "thirdParty", platform: "twitch" });

    // Click the 7TV sub-section icon (aria-label "7TV", aria-pressed=false).
    fireEvent.click(screen.getByRole("button", { name: "7TV", pressed: false }));

    // All provider sections remain rendered; the button is navigation, not a filter.
    expect(findSection("7TV")).not.toBeNull();
    expect(findSection("BetterTTV")).not.toBeNull();
    expect(findSection("FrankerFaceZ")).not.toBeNull();
    // Pinned sections stay visible.
    expect(findSection("Frequently Used")).not.toBeNull();
    expect(findSection("Favorites")).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("sub-section navigation can be clicked repeatedly without hiding provider sections", () => {
    const scrollIntoView = mockElementScrollIntoView();
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["7tv", [makeEmote({ id: "s1", name: "PogChamp", provider: "7tv" })]],
      ["bttv", [makeEmote({ id: "b1", name: "monkaS", provider: "bttv" })]],
      ["ffz", [makeEmote({ id: "f1", name: "OhMyDog", provider: "ffz" })]],
    ]);
    renderPicker({ scope: "thirdParty", platform: "twitch" });

    const stvIcon = screen.getByRole("button", { name: "7TV", pressed: false });
    fireEvent.click(stvIcon);
    expect(findSection("BetterTTV")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "7TV", pressed: true }));
    expect(findSection("BetterTTV")).not.toBeNull();
    expect(findSection("FrankerFaceZ")).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("sub-section navigation (native kick): Global and channel buttons scroll without hiding other sections", () => {
    const scrollIntoView = mockElementScrollIntoView();
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "k-channel",
            name: "streamerWave",
            provider: "kick",
            isGlobal: false,
            kickSection: "channel",
          }),
          makeEmote({
            id: "k-global",
            name: "globalKick",
            provider: "kick",
            isGlobal: true,
            kickSection: "global",
          }),
        ],
      ],
    ]);
    renderPicker({
      scope: "native",
      platform: "kick",
      channelAvatarUrl: "https://example.test/avatar.webp",
      channelLabel: "DarkSky",
    });

    fireEvent.click(screen.getByRole("button", { name: "Channel", pressed: false }));
    expect(screen.getByLabelText("streamerWave")).toBeInTheDocument();
    expect(screen.getByLabelText("globalKick")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Global", pressed: false }));
    expect(screen.getByLabelText("streamerWave")).toBeInTheDocument();
    expect(screen.getByLabelText("globalKick")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("renders an Emojis sub-section button for native Kick emotes and clicking it navigates", () => {
    const scrollIntoView = mockElementScrollIntoView();
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "k-channel",
            name: "streamerWave",
            provider: "kick",
            isGlobal: false,
            kickSection: "channel",
          }),
          makeEmote({
            id: "k-emoji",
            name: "kickSmile",
            provider: "kick",
            isGlobal: true,
            kickSection: "emoji",
          }),
        ],
      ],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    fireEvent.click(screen.getByRole("button", { name: "Emojis", pressed: false }));

    expect(screen.getByLabelText("streamerWave")).toBeInTheDocument();
    expect(screen.getByLabelText("kickSmile")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("separates native Kick channel, Global, and Emojis by KickTalk set metadata", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "k-channel",
            name: "streamerWave",
            provider: "kick",
            isGlobal: false,
            kickSection: "channel",
          }),
          makeEmote({
            id: "k-global",
            name: "globalKick",
            provider: "kick",
            isGlobal: true,
            kickSection: "global",
          }),
          makeEmote({
            id: "k-emoji",
            name: "kickSmile",
            provider: "kick",
            isGlobal: true,
            kickSection: "emoji",
          }),
        ],
      ],
    ]);
    renderPicker({ scope: "native", platform: "kick", channelLabel: "DarkSky" });

    const channelSection = findSectionById("channel");
    const globalSection = findSectionById("global");
    const emojiSection = findSectionById("emoji");

    expect(channelSection).not.toBeNull();
    expect(globalSection).not.toBeNull();
    expect(emojiSection).not.toBeNull();
    if (!channelSection || !globalSection || !emojiSection) return;

    expect(within(channelSection).getByLabelText("streamerWave")).toBeInTheDocument();
    expect(within(channelSection).queryByLabelText("globalKick")).not.toBeInTheDocument();
    expect(within(channelSection).queryByLabelText("kickSmile")).not.toBeInTheDocument();

    expect(within(globalSection).getByLabelText("globalKick")).toBeInTheDocument();
    expect(within(globalSection).queryByLabelText("streamerWave")).not.toBeInTheDocument();
    expect(within(globalSection).queryByLabelText("kickSmile")).not.toBeInTheDocument();

    expect(within(emojiSection).getByLabelText("kickSmile")).toBeInTheDocument();
    expect(within(emojiSection).queryByLabelText("streamerWave")).not.toBeInTheDocument();
    expect(within(emojiSection).queryByLabelText("globalKick")).not.toBeInTheDocument();
  });

  it("renders native Kick subscription emotes as subscribed-channel avatar tabs", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "k-channel",
            name: "streamerWave",
            provider: "kick",
            isGlobal: false,
            availability: "channel",
            kickSection: "channel",
          }),
          makeEmote({
            id: "k-sub",
            name: "otherKickSub",
            provider: "kick",
            isGlobal: true,
            availability: "user",
            kickSection: "subscribed",
            subscribersOnly: true,
            owner: {
              id: "kick-owner",
              username: "otherkick",
              displayName: "OtherKick",
              avatarUrl: "https://example.test/otherkick/avatar.webp",
            },
          }),
          makeEmote({
            id: "k-global",
            name: "globalKick",
            provider: "kick",
            isGlobal: true,
            availability: "global",
            kickSection: "global",
          }),
        ],
      ],
    ]);

    renderPicker({ scope: "native", platform: "kick", channelLabel: "CurrentStreamer" });

    const ownerTab = screen.getByRole("button", {
      name: "OtherKick's Emotes",
      pressed: false,
    });
    expect(ownerTab.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.test/otherkick/avatar.webp"
    );
    expect(screen.queryByRole("button", { name: "Subscribed" })).not.toBeInTheDocument();
    const subscribedSection = findSectionById("subscribed-kick-kick-owner");
    const channelSection = findSectionById("channel");
    const globalSection = findSectionById("global");
    expect(subscribedSection).not.toBeNull();
    expect(channelSection).not.toBeNull();
    expect(globalSection).not.toBeNull();
    if (!subscribedSection || !channelSection || !globalSection) return;

    expect(within(subscribedSection).getByLabelText("otherKickSub")).toBeInTheDocument();
    expect(within(channelSection).queryByLabelText("otherKickSub")).not.toBeInTheDocument();
    expect(within(globalSection).queryByLabelText("otherKickSub")).not.toBeInTheDocument();
  });

  it("uses the channel display name for native Kick channel emote sections when an avatar is present", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "kick-channel",
            name: "kickStreamerWave",
            provider: "kick",
            isGlobal: false,
          }),
        ],
      ],
    ]);
    renderPicker({
      scope: "native",
      platform: "kick",
      channelAvatarUrl: "https://example.test/avatar.webp",
      channelLabel: "DarkSky Live",
    });

    const channelSection = findSection("DarkSky Live");
    expect(channelSection).not.toBeNull();
    if (!channelSection) return;
    expect(within(channelSection).getByLabelText("kickStreamerWave")).toBeInTheDocument();
  });

  it("renders section headers as static labels that cannot hide emotes", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        "kick",
        [
          makeEmote({
            id: "k1",
            name: "kickHype",
            provider: "kick",
            isGlobal: true,
            kickSection: "emoji",
          }),
        ],
      ],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    const emojiSection = findSection("Emojis");
    expect(emojiSection).not.toBeNull();
    if (!emojiSection) return;
    expect(within(emojiSection).getByLabelText("kickHype")).toBeInTheDocument();
    expect(within(emojiSection).queryByRole("button", { name: /^Emojis/ })).not.toBeInTheDocument();

    fireEvent.click(within(emojiSection).getByText("Emojis"));
    expect(within(emojiSection).getByLabelText("kickHype")).toBeInTheDocument();
  });

  it("windows large emote sections instead of mounting every emote image at once", async () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      makeEmote({ id: `k${i}`, name: `emote${i}`, provider: "kick" })
    );
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["kick", many]]);
    renderPicker({ scope: "native", platform: "kick" });

    expect(screen.getByLabelText("emote0")).toBeInTheDocument();
    expect(screen.queryByLabelText("emote200")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/^emote\d+$/).length).toBeLessThanOrEqual(120);

    const scrollRoot = document.querySelector(
      '[data-testid="emote-picker-popover"] .overflow-y-auto'
    ) as HTMLElement;
    expect(scrollRoot).not.toBeNull();
    Object.defineProperty(scrollRoot, "scrollTop", {
      configurable: true,
      value: 2400,
    });
    fireEvent.scroll(scrollRoot);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.queryByLabelText("emote0")).not.toBeInTheDocument();
    expect(screen.getByLabelText("emote350")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^emote\d+$/).length).toBeLessThanOrEqual(200);
  });

  it("does not mount emote images from inactive provider source tabs", () => {
    const channelEmotes = Array.from({ length: 100 }, (_, i) =>
      makeEmote({ id: `channel-${i}`, name: `channelEmote${i}`, provider: "7tv" })
    );
    const globalEmotes = Array.from({ length: 100 }, (_, i) =>
      makeEmote({
        id: `global-${i}`,
        name: `globalEmote${i}`,
        provider: "7tv",
        isGlobal: true,
      })
    );
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["7tv", [...channelEmotes, ...globalEmotes]],
    ]);
    renderPicker({ scope: "thirdParty", platform: "kick" });

    const stvSection = findSectionById("7tv");
    expect(stvSection).not.toBeNull();
    if (!stvSection) return;

    expect(within(stvSection).queryByLabelText("globalEmote0")).not.toBeInTheDocument();
    expect(within(stvSection).getByLabelText("channelEmote0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "7TV Global", pressed: false }));

    expect(within(stvSection).getByLabelText("globalEmote0")).toBeInTheDocument();
    expect(within(stvSection).queryByLabelText("channelEmote0")).not.toBeInTheDocument();
  });

  it("preloads the next visible native section before slow scrolling reaches it", async () => {
    const globalEmotes = Array.from({ length: 100 }, (_, i) =>
      makeEmote({
        id: `slow-global-${i}`,
        name: `slowGlobal${i}`,
        provider: "kick",
        isGlobal: true,
        kickSection: "global",
      })
    );
    const emojiEmotes = Array.from({ length: 100 }, (_, i) =>
      makeEmote({
        id: `slow-emoji-${i}`,
        name: `slowEmoji${i}`,
        provider: "kick",
        isGlobal: true,
        kickSection: "emoji",
      })
    );
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["kick", [...globalEmotes, ...emojiEmotes]],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    const scrollRoot = document.querySelector(
      '[data-testid="emote-picker-popover"] .overflow-y-auto'
    ) as HTMLElement;
    const emojiBody = document.querySelector('[data-emote-section-id="emoji"] > .p-3');
    expect(scrollRoot).not.toBeNull();
    expect(emojiBody).not.toBeNull();
    if (!emojiBody) return;

    Object.defineProperty(scrollRoot, "clientHeight", {
      configurable: true,
      value: 360,
    });
    Object.defineProperty(scrollRoot, "scrollTop", {
      configurable: true,
      writable: true,
      value: 500,
    });
    Object.defineProperty(emojiBody, "offsetTop", {
      configurable: true,
      value: 1100,
    });

    act(() => {
      fireEvent.scroll(scrollRoot);
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(within(emojiBody as HTMLElement).getByLabelText("slowEmoji0")).toBeInTheDocument();
  });

  it("renders visible emote images during coarse scroll bursts", async () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      makeEmote({ id: `k${i}`, name: `coarseScrollEmote${i}`, provider: "kick" })
    );
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["kick", many]]);
    renderPicker({ scope: "native", platform: "kick" });

    const scrollRoot = document.querySelector(
      '[data-testid="emote-picker-popover"] .overflow-y-auto'
    ) as HTMLElement;
    expect(scrollRoot).not.toBeNull();
    Object.defineProperty(scrollRoot, "clientHeight", {
      configurable: true,
      value: 360,
    });
    Object.defineProperty(scrollRoot, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    for (const top of [120, 240, 360]) {
      act(() => {
        scrollRoot.scrollTop = top;
        fireEvent.scroll(scrollRoot);
      });
    }

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(
      within(scrollRoot).getAllByRole("img", { name: /^coarseScrollEmote/i }).length
    ).toBeGreaterThan(0);
  });

  it("renders bottom-right lock when Kick-native + viewerIsSubscribed=false + subscribersOnly=true; click shows subscribe warning", () => {
    const locked = makeEmote({
      id: "k-sub",
      name: "subOnly",
      provider: "kick",
      subscribersOnly: true,
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["kick", [locked]]]);
    const { onSelect } = renderPicker({
      scope: "native",
      platform: "kick",
      viewerIsSubscribed: false,
    });
    const btn = screen.getByLabelText("subOnly — subscriber-only emote");
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("emote-lock-overlay")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onSelect).not.toHaveBeenCalled();
    expect(mockState.addRecentEmote).not.toHaveBeenCalled();
    expect(toastMocks.warning).toHaveBeenCalledWith(
      "You must subscribe to this channel to use this emote.",
      { description: "subOnly" }
    );
  });

  it("no lock overlay when Kick-native + viewerIsSubscribed=true; click selects", () => {
    const emote = makeEmote({
      id: "k-sub",
      name: "subOnly",
      provider: "kick",
      subscribersOnly: true,
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["kick", [emote]]]);
    const { onSelect } = renderPicker({
      scope: "native",
      platform: "kick",
      viewerIsSubscribed: true,
    });
    expect(screen.queryByTestId("emote-lock-overlay")).not.toBeInTheDocument();
    const btn = screen.getByLabelText("subOnly");
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith(emote);
    expect(mockState.addRecentEmote).toHaveBeenCalledWith(emote);
  });

  it("locks subscriber-only native emotes when viewerIsSubscribed=undefined", () => {
    const emote = makeEmote({
      id: "k-sub",
      name: "subOnly",
      provider: "kick",
      subscribersOnly: true,
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["kick", [emote]]]);
    renderPicker({ scope: "native", platform: "kick" /* viewerIsSubscribed omitted */ });
    expect(screen.getByTestId("emote-lock-overlay")).toHaveClass("bottom-0.5", "right-0.5");
    expect(screen.getByLabelText("subOnly — subscriber-only emote")).toBeInTheDocument();
  });

  it("locks Twitch-native subscriber-only emotes unless they came from the signed-in user's emote library", () => {
    const emote = makeEmote({
      id: "t-sub",
      name: "twitchSubOnly",
      provider: "twitch",
      subscribersOnly: true,
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["twitch", [emote]]]);
    renderPicker({ scope: "native", platform: "twitch", viewerIsSubscribed: false });
    expect(screen.getByTestId("emote-lock-overlay")).toBeInTheDocument();
    expect(screen.getByLabelText("twitchSubOnly — subscriber-only emote")).toBeInTheDocument();
  });

  it("does not lock subscriber-only user-library emotes because those are already usable by the signed-in account", () => {
    const emote = makeEmote({
      id: "t-user-sub",
      name: "otherChannelSub",
      provider: "twitch",
      subscribersOnly: true,
      availability: "user",
      owner: { id: "owner-1", username: "other", displayName: "Other" },
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["twitch", [emote]]]);
    renderPicker({ scope: "native", platform: "twitch", viewerIsSubscribed: false });
    expect(screen.queryByTestId("emote-lock-overlay")).not.toBeInTheDocument();
    expect(screen.getByLabelText("otherChannelSub")).toBeInTheDocument();
  });

  it("outside click closes the dialog", () => {
    const { onClose } = renderPicker({ scope: "native", platform: "kick" });
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape key closes the dialog", () => {
    const { onClose } = renderPicker({ scope: "native", platform: "kick" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("favorite toggle: hover then click star fires useEmoteStore.toggleFavorite", () => {
    const emote = makeEmote({ id: "k1", name: "kickHype", provider: "kick" });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["kick", [emote]]]);
    renderPicker({ scope: "native", platform: "kick" });
    const emoteBtn = screen.getByLabelText("kickHype");
    // The hover wrapper is the button's parent <div>.
    const wrapper = emoteBtn.parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    const star = within(wrapper).getByLabelText(/^Favorite kickHype$/);
    fireEvent.click(star);
    expect(mockState.toggleFavorite).toHaveBeenCalledWith(emote);
  });

  it("renders each emote as a KickTalk-style bordered square tile", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["kick", [makeEmote({ id: "k1", name: "kickHype", provider: "kick" })]],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    const emoteBtn = screen.getByLabelText("kickHype");
    const tile = emoteBtn.parentElement as HTMLElement;
    const emoteItems = tile.parentElement as HTMLElement;

    expect(emoteItems).toHaveClass("emote-picker-grid");
    expect(emoteItems).toHaveStyle({
      display: "grid",
      gap: "8px",
    });
    expect(tile).toHaveClass(
      "h-10",
      "aspect-square",
      "rounded-[4px]",
      "border",
      "border-[#515151]",
      "ring-1",
      "ring-inset",
      "ring-[#515151]",
      "p-1"
    );
  });

  it("renders section headers without dropdown arrows", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["kick", [makeEmote({ id: "k1", name: "kickHype", provider: "kick" })]],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    const channelSection = findSection("Channel");
    expect(channelSection).not.toBeNull();
    if (!channelSection) return;

    const channelHeader = channelSection.querySelector(":scope > div");
    const channelLabel = channelHeader?.querySelector("span");
    const caret = channelHeader?.querySelector("svg");

    expect(channelHeader).not.toBeNull();
    expect(channelHeader).toHaveClass("text-[var(--color-foreground-muted)]");
    expect(channelHeader).not.toHaveClass("group", "text-[#777777]");
    expect(channelLabel).toHaveClass("text-[#777777]");
    expect(caret).toBeNull();
    expect(
      within(channelSection).queryByRole("button", { name: /^Channel/ })
    ).not.toBeInTheDocument();
  });

  it("focuses the search input when opened", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["kick", [makeEmote({ id: "k1", name: "kickHype", provider: "kick" })]],
    ]);
    renderPicker({ scope: "native", platform: "kick" });
    const input = screen.getByPlaceholderText(/search emotes/i);
    expect(document.activeElement).toBe(input); // fails on old code: focus is on a 100ms timer
  });
});

/* ------------------------------------------------------------------------- */
/* Manual prefetch suppression                                                */
/* ------------------------------------------------------------------------- */

describe("EmotePickerPopover manual prefetch suppression", () => {
  // Guards: opening or switching emote picker scopes must not start offscreen
  // 7TV image prefetches. Visible windowed <img> elements may load normally,
  // but speculative `new Image()` work bypasses scroll deferral and can compete
  // with live video/chat networking on emote-rich channels.

  it("does not construct offscreen Image() prefetches when opened", () => {
    const constructions: HTMLImageElement[] = [];
    type ImageCtor = typeof Image;
    const RealImage = globalThis.Image as ImageCtor;
    class CountingImage extends RealImage {
      constructor() {
        super();
        constructions.push(this);
      }
    }
    const orig = (globalThis as unknown as { Image: ImageCtor }).Image;
    (globalThis as unknown as { Image: ImageCtor }).Image = CountingImage as unknown as ImageCtor;

    try {
      const sixteen = Array.from({ length: 16 }, (_, i) =>
        makeEmote({ id: `s${i}`, name: `emote${i}`, provider: "7tv" })
      );
      mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["7tv", sixteen]]);

      renderPicker({ scope: "thirdParty", platform: "twitch" });

      expect(constructions).toHaveLength(0);
      expect(screen.getAllByRole("img", { name: /^emote/i }).length).toBeGreaterThan(0);
    } finally {
      (globalThis as unknown as { Image: ImageCtor }).Image = orig;
    }
  });
});
