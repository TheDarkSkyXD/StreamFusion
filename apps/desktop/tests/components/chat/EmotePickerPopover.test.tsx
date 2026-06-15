import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Emote, EmoteProvider } from "@/backend/services/emotes/emote-types";

/* ------------------------------------------------------------------------- */
/* Mutable store mock (selector-capable, mirrors EmotePicker.test pattern)   */
/* ------------------------------------------------------------------------- */

interface MockState {
  loadedGlobalPlatforms: Set<"twitch" | "kick">;
  loadedChannels: Set<string>;
  activeChannelId: string | null;
  favoriteEmotes: Emote[];
  recentEmotes: Emote[];
  isLoading: boolean;
  emotesByProvider: Map<EmoteProvider, Emote[]>;
  getEmotesByProvider: () => Map<EmoteProvider, Emote[]>;
  addRecentEmote: ReturnType<typeof vi.fn>;
  toggleFavorite: ReturnType<typeof vi.fn>;
  isFavorite: (id: string) => boolean;
  favoriteIds: Set<string>;
}

const mockState: MockState = {
  loadedGlobalPlatforms: new Set(["twitch"]),
  loadedChannels: new Set(),
  activeChannelId: null,
  favoriteEmotes: [],
  recentEmotes: [],
  isLoading: false,
  emotesByProvider: new Map(),
  getEmotesByProvider: () => mockState.emotesByProvider,
  addRecentEmote: vi.fn(),
  toggleFavorite: vi.fn(),
  isFavorite: (id: string) => mockState.favoriteIds.has(id),
  favoriteIds: new Set(),
};

vi.mock("@/store/emote-store", () => ({
  useEmoteStore: (selector?: (s: MockState) => unknown) =>
    selector ? selector(mockState) : mockState,
}));

beforeEach(() => {
  // Reset state
  mockState.recentEmotes = [];
  mockState.favoriteEmotes = [];
  mockState.emotesByProvider = new Map();
  mockState.favoriteIds = new Set();
  mockState.addRecentEmote.mockReset();
  mockState.toggleFavorite.mockReset();
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
    viewerIsSubscribed: props.viewerIsSubscribed,
    channelAvatarUrl: props.channelAvatarUrl,
    channelLabel: props.channelLabel,
  };
  const utils = render(<EmotePickerPopover {...pickerProps} />);
  return { ...utils, onClose, onSelect, anchor };
}

function findSection(title: string): HTMLElement | null {
  const heading =
    screen.queryByRole("button", { name: new RegExp(`^${title}`, "i"), expanded: true }) ??
    screen.queryByRole("button", { name: new RegExp(`^${title}`, "i") });
  if (!heading) return null;
  return heading.parentElement;
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

/* ------------------------------------------------------------------------- */
/* Tests                                                                     */
/* ------------------------------------------------------------------------- */

// Guards: picker navigation, selection, and provider grouping must keep working while large emote sets are windowed to avoid live-stream CPU and memory spikes.
describe("EmotePickerPopover", () => {
  it("renders nothing when closed", () => {
    const { container } = renderPicker({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders Kick provider section only for scope=native platform=kick", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["kick", [makeEmote({ id: "k1", name: "kickHype", provider: "kick" })]],
      ["7tv", [makeEmote({ id: "s1", name: "PogChamp", provider: "7tv" })]],
    ]);
    renderPicker({ scope: "native", platform: "kick" });
    expect(screen.getByRole("button", { name: /^Channel/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Global/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Emojis/, expanded: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^7TV/ })).not.toBeInTheDocument();
  });

  it("renders 7TV, BTTV, FFZ sections for scope=thirdParty platform=twitch", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["7tv", [makeEmote({ id: "s1", name: "PogChamp", provider: "7tv" })]],
      ["bttv", [makeEmote({ id: "b1", name: "monkaS", provider: "bttv" })]],
      ["ffz", [makeEmote({ id: "f1", name: "OhMyDog", provider: "ffz" })]],
    ]);
    renderPicker({ scope: "thirdParty", platform: "twitch" });
    // Section header buttons have aria-expanded; sub-section icons have aria-pressed.
    expect(screen.getByRole("button", { name: /^7TV/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^BetterTTV/, expanded: true })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^FrankerFaceZ/, expanded: true })
    ).toBeInTheDocument();
  });

  it("pins Frequently Used and Favorites at the top of the body", () => {
    mockState.recentEmotes = [makeEmote({ id: "k1", name: "kickHype", provider: "kick" })];
    mockState.favoriteEmotes = [makeEmote({ id: "k2", name: "kickFav", provider: "kick" })];
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["kick", [makeEmote({ id: "k3", name: "kickEmote", provider: "kick" })]],
    ]);
    renderPicker({ scope: "native", platform: "kick" });
    expect(
      screen.queryByRole("button", { name: /^Recent/, expanded: true })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Frequently Used/, expanded: true })
    ).toBeInTheDocument();

    const headings = screen.getAllByRole("button", { name: /^(Frequently Used|Favorites|Emojis)/ });
    const titles = headings.map((h) => h.textContent ?? "");
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
    expect(
      screen.getByRole("button", { name: /^Frequently Used/, expanded: true })
    ).toBeInTheDocument();
    // Only kickHype should appear in Frequently Used (scoped to kick provider).
    expect(screen.getByLabelText("kickHype")).toBeInTheDocument();
    expect(screen.queryByLabelText("PogChamp")).not.toBeInTheDocument();
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
      pressed: false,
    });
    fireEvent.click(frequentlyUsedButton);

    expect(
      screen.getByRole("button", { name: /^Frequently Used/, expanded: true })
    ).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
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
    expect(screen.getByRole("button", { name: /^7TV/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^BetterTTV/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^FrankerFaceZ/ })).toBeInTheDocument();
    // Pinned sections stay visible.
    expect(
      screen.getByRole("button", { name: /^Frequently Used/, expanded: true })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Favorites/ })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /^BetterTTV/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "7TV", pressed: true }));
    expect(screen.getByRole("button", { name: /^BetterTTV/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^FrankerFaceZ/ })).toBeInTheDocument();
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

  it.each([
    { scope: "native" as const, provider: "kick" as EmoteProvider },
    { scope: "thirdParty" as const, provider: "7tv" as EmoteProvider },
  ])("uses the channel display name for $scope Kick channel emote sections when an avatar is present", ({
    scope,
    provider,
  }) => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      [
        provider,
        [
          makeEmote({
            id: `${provider}-channel`,
            name: `${provider}StreamerWave`,
            provider,
            isGlobal: false,
          }),
        ],
      ],
    ]);
    renderPicker({
      scope,
      platform: "kick",
      channelAvatarUrl: "https://example.test/avatar.webp",
      channelLabel: "DarkSky Live",
    });

    const channelSection = findSection("DarkSky Live");
    expect(channelSection).not.toBeNull();
    if (!channelSection) return;
    expect(within(channelSection).getByLabelText(`${provider}StreamerWave`)).toBeInTheDocument();
  });

  it("collapsible section toggles expanded/collapsed", () => {
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
    expect(screen.getByLabelText("kickHype")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Emojis/, expanded: true }));
    expect(screen.queryByLabelText("kickHype")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Emojis/, expanded: false }));
    expect(screen.getByLabelText("kickHype")).toBeInTheDocument();
  });

  it("windows large emote sections instead of mounting every emote image at once", async () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      makeEmote({ id: `k${i}`, name: `emote${i}`, provider: "kick" })
    );
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["kick", many]]);
    renderPicker({ scope: "native", platform: "kick" });

    expect(screen.getByLabelText("emote0")).toBeInTheDocument();
    expect(screen.queryByLabelText("emote200")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/^emote\d+$/)).toHaveLength(77);

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
    expect(screen.getAllByLabelText(/^emote\d+$/).length).toBeLessThanOrEqual(120);
  });

  it("does not mount emote images for large provider sections that are fully off-screen", async () => {
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

    const globalBody = document.querySelector('[data-emote-section-id="global"] > .p-3');
    expect(globalBody).not.toBeNull();
    if (!globalBody) return;
    Object.defineProperty(globalBody, "offsetTop", {
      configurable: true,
      value: 3000,
    });

    const scrollRoot = document.querySelector(
      '[data-testid="emote-picker-popover"] .overflow-y-auto'
    ) as HTMLElement;
    expect(scrollRoot).not.toBeNull();
    Object.defineProperty(scrollRoot, "scrollTop", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(scrollRoot, "clientHeight", {
      configurable: true,
      value: 360,
    });
    fireEvent.scroll(scrollRoot);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(screen.queryByLabelText("globalEmote0")).not.toBeInTheDocument();
    expect(screen.getByLabelText("channelEmote0")).toBeInTheDocument();
  });

  it("keeps visible emote image URLs deferred during coarse scroll bursts", async () => {
    vi.useFakeTimers();
    try {
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
          vi.advanceTimersByTime(300);
        });
      }

      expect(
        within(scrollRoot).queryByRole("img", { name: /^coarseScrollEmote/i })
      ).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(801);
      });

      expect(
        within(scrollRoot).getAllByRole("img", { name: /^coarseScrollEmote/i }).length
      ).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders lock overlay when Kick-native + viewerIsSubscribed=false + subscribersOnly=true; click is no-op", () => {
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

  it("no lock overlay when Kick-native + viewerIsSubscribed=undefined", () => {
    const emote = makeEmote({
      id: "k-sub",
      name: "subOnly",
      provider: "kick",
      subscribersOnly: true,
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["kick", [emote]]]);
    renderPicker({ scope: "native", platform: "kick" /* viewerIsSubscribed omitted */ });
    expect(screen.queryByTestId("emote-lock-overlay")).not.toBeInTheDocument();
    expect(screen.getByLabelText("subOnly")).toBeInTheDocument();
  });

  it("no lock overlay on Twitch-native even with subscribersOnly=true (defensive)", () => {
    const emote = makeEmote({
      id: "t-sub",
      name: "twitchSubOnly",
      provider: "twitch",
      subscribersOnly: true,
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([["twitch", [emote]]]);
    renderPicker({ scope: "native", platform: "twitch", viewerIsSubscribed: false });
    expect(screen.queryByTestId("emote-lock-overlay")).not.toBeInTheDocument();
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

  it("renders section dropdown arrows at KickTalk size", () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ["kick", [makeEmote({ id: "k1", name: "kickHype", provider: "kick" })]],
    ]);
    renderPicker({ scope: "native", platform: "kick" });

    const channelHeader = screen.getByRole("button", { name: /^Channel/, expanded: true });
    const channelLabel = channelHeader.querySelector("span");
    const caret = channelHeader.querySelector("svg");

    expect(channelHeader).toHaveClass("group", "text-[var(--color-foreground-muted)]");
    expect(channelHeader).not.toHaveClass("text-[#777777]");
    expect(channelLabel).toHaveClass("text-[#777777]");
    expect(caret).not.toBeNull();
    expect(caret).toHaveAttribute("width", "20");
    expect(caret).toHaveAttribute("height", "20");
    expect(caret).toHaveAttribute("viewBox", "0 0 32 32");
    expect(caret).toHaveClass("opacity-50", "rotate-180");
    expect(caret).not.toHaveClass("text-[#777777]", "text-white");
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
