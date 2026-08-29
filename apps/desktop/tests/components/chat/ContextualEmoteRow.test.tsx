import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Emote, EmoteProvider } from "@backend/services/emotes/emote-types";
import { ContextualEmoteRow } from "@/features/chat/components/chat/ContextualEmoteRow";

const storeState = vi.hoisted(() => ({
  isLoading: false,
  emoteRevision: 0,
  loadedGlobalPlatforms: new Set<"twitch" | "kick">(),
  loadedChannels: new Set<string>(),
  getEmotesByProviderForChannel: vi.fn<(channelId: string) => Map<EmoteProvider, Emote[]>>(
    () => new Map()
  ),
}));

vi.mock("@/store/emote-store", () => ({
  useEmoteStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock("@/features/chat/components/chat/EmoteImage", () => ({
  EmoteImage: ({ emote }: { emote: Emote }) => <img src={emote.urls.url1x} alt={emote.name} />,
}));

function emote(
  id: string,
  name: string,
  provider: EmoteProvider,
  overrides: Partial<Emote> = {}
): Emote {
  return {
    id,
    name,
    provider,
    isGlobal: true,
    isAnimated: false,
    isZeroWidth: false,
    urls: { url1x: `https://example.test/${id}.webp`, url2x: `https://example.test/${id}@2x.webp` },
    ...overrides,
  };
}

beforeEach(() => {
  storeState.isLoading = false;
  storeState.emoteRevision = 0;
  storeState.loadedGlobalPlatforms = new Set();
  storeState.loadedChannels = new Set();
  storeState.getEmotesByProviderForChannel.mockReset();
  storeState.getEmotesByProviderForChannel.mockReturnValue(new Map());
});

// Guards: a one-character colon query uses the composing Twitch channel and excludes Kick candidates.
describe("ContextualEmoteRow", () => {
  // Guards: a first ordinary current-word character activates Frosty-style matching without a colon.
  it("shows results from the first character of an ordinary current word", () => {
    storeState.getEmotesByProviderForChannel.mockReturnValue(
      new Map([["twitch", [emote("25", "Kappa", "twitch")]]])
    );

    render(
      <ContextualEmoteRow
        inputValue="K"
        cursorPosition={1}
        platform="twitch"
        channelId="twitch-channel"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("option", { name: "Insert Kappa from Twitch" })).toBeInTheDocument();
  });

  // Guards: completing the current word with whitespace closes ordinary matching.
  it("closes after the current word is completed", () => {
    storeState.getEmotesByProviderForChannel.mockReturnValue(
      new Map([["twitch", [emote("25", "Kappa", "twitch")]]])
    );

    const { container } = render(
      <ContextualEmoteRow
        inputValue="K "
        cursorPosition={2}
        platform="twitch"
        channelId="twitch-channel"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows Twitch-scoped results for : plus one character", () => {
    storeState.getEmotesByProviderForChannel.mockReturnValue(
      new Map([
        ["twitch", [emote("25", "Kappa", "twitch")]],
        ["kick", [emote("kick-1", "KappaKick", "kick")]],
      ])
    );

    render(
      <ContextualEmoteRow
        inputValue=":K"
        cursorPosition={2}
        platform="twitch"
        channelId="twitch-channel"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("option", { name: /Insert Kappa from Twitch/i })).toBeInTheDocument();
    expect(screen.queryByText("KappaKick")).not.toBeInTheDocument();
    expect(storeState.getEmotesByProviderForChannel).toHaveBeenCalledWith("twitch-channel");
  });

  // Guards: loading and explicit empty feedback occupy the same fixed-height contextual row.
  it("keeps a fixed row while loading and when no emotes match", () => {
    storeState.isLoading = true;
    const props = {
      inputValue: ":missing",
      cursorPosition: 8,
      platform: "kick" as const,
      channelId: "kick-channel",
      onSelect: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<ContextualEmoteRow {...props} />);

    expect(screen.getByTestId("contextual-emote-row")).toHaveClass("h-8", "min-h-8");
    expect(screen.getByText("Loading emotes…")).toBeInTheDocument();

    storeState.isLoading = false;
    rerender(<ContextualEmoteRow {...props} />);

    expect(screen.getByTestId("contextual-emote-row")).toHaveClass("h-8", "min-h-8");
    expect(screen.getAllByText("No matching emotes")).toHaveLength(2);
  });

  // Guards: pointer insertion uses provider:id identity, exposes an accessible action, and hides unusable subscriber emotes.
  it("inserts an eligible image result by pointer without exposing unusable subscriber emotes", () => {
    const usable = emote("usable", "Keepo", "kick");
    const locked = emote("locked", "KappaLocked", "kick", { subscribersOnly: true });
    storeState.getEmotesByProviderForChannel.mockReturnValue(new Map([["kick", [usable, locked]]]));
    const onSelect = vi.fn();

    render(
      <ContextualEmoteRow
        inputValue=":K"
        cursorPosition={2}
        platform="kick"
        channelId="kick-channel"
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );

    const result = screen.getByRole("option", { name: "Insert Keepo from Kick" });
    expect(result).toHaveAttribute("data-emote-key", "kick:usable");
    expect(result).toHaveAttribute("title", "Insert Keepo from Kick");
    expect(screen.queryByAltText("KappaLocked")).not.toBeInTheDocument();

    fireEvent.click(result);

    expect(onSelect).toHaveBeenCalledWith(usable, 0, 2);
  });

  // Guards: keyboard navigation never inserts a contextual emote; insertion requires a pointer click.
  it.each(["Tab", "Enter"] as const)("does not insert the active contextual emote with %s", (key) => {
    const first = emote("1", "Kappa", "twitch");
    const second = emote("2", "Keepo", "twitch");
    storeState.getEmotesByProviderForChannel.mockReturnValue(
      new Map([["twitch", [first, second]]])
    );
    const onSelect = vi.fn();

    render(
      <ContextualEmoteRow
        inputValue=":K"
        cursorPosition={2}
        platform="twitch"
        channelId="channel-a"
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByRole("option", { name: /Insert Keepo/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Keepo from Twitch selected, identity twitch:2. Click to insert."
    );
    const insertionEvent = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(insertionEvent);

    expect(insertionEvent.defaultPrevented).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Guards: Escape closes contextual emote mode and consumes the dismissing keypress.
  it("closes contextual emote mode with Escape", () => {
    storeState.getEmotesByProviderForChannel.mockReturnValue(
      new Map([["twitch", [emote("1", "Kappa", "twitch")]]])
    );
    const onClose = vi.fn();

    render(
      <ContextualEmoteRow
        inputValue=":K"
        cursorPosition={2}
        platform="twitch"
        channelId="channel-a"
        onSelect={vi.fn()}
        onClose={onClose}
      />
    );

    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escapeEvent);

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Guards: simultaneous composers keep channel catalogs and keyboard selection isolated to the focused composer.
  it("isolates channel results and selection between simultaneous composers", () => {
    storeState.getEmotesByProviderForChannel.mockImplementation((channelId) =>
      channelId === "channel-a"
        ? new Map([["twitch", [emote("a1", "KappaA", "twitch"), emote("a2", "KeepoA", "twitch")]]])
        : new Map([["twitch", [emote("b1", "KappaB", "twitch"), emote("b2", "KeepoB", "twitch")]]])
    );

    render(
      <>
        <ContextualEmoteRow
          inputValue=":K"
          cursorPosition={2}
          platform="twitch"
          channelId="channel-a"
          keyboardActive={true}
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />
        <ContextualEmoteRow
          inputValue=":K"
          cursorPosition={2}
          platform="twitch"
          channelId="channel-b"
          keyboardActive={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />
      </>
    );

    const [rowA, rowB] = screen.getAllByTestId("contextual-emote-row");
    expect(within(rowA).getByAltText("KappaA")).toBeInTheDocument();
    expect(within(rowA).queryByAltText("KappaB")).not.toBeInTheDocument();
    expect(within(rowB).getByAltText("KappaB")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(within(rowA).getByRole("option", { name: /KeepoA/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(within(rowB).getByRole("option", { name: /KappaB/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  // Guards: duplicate names stay distinct by provider:id and receive visible provider marks.
  it("marks duplicate names while preserving provider identity", () => {
    storeState.getEmotesByProviderForChannel.mockReturnValue(
      new Map([
        ["twitch", [emote("native", "Kappa", "twitch")]],
        ["7tv", [emote("third-party", "Kappa", "7tv")]],
      ])
    );

    render(
      <ContextualEmoteRow
        inputValue=":Kappa"
        cursorPosition={6}
        platform="twitch"
        channelId="channel-a"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("option", { name: "Insert Kappa from Twitch" })).toHaveAttribute(
      "data-emote-key",
      "twitch:native"
    );
    expect(screen.getByRole("option", { name: "Insert Kappa from 7TV" })).toHaveAttribute(
      "data-emote-key",
      "7tv:third-party"
    );
    expect(screen.getAllByText(/^(Twitch|7TV)$/)).toHaveLength(2);
  });

  // Guards: dense typeahead renders at most nine compact image results with no horizontal scroll path.
  it("fits at most nine emotes in a non-scrollable result strip", () => {
    const matches = Array.from({ length: 12 }, (_, index) =>
      emote(String(index), `Kappa${index}`, "twitch")
    );
    storeState.getEmotesByProviderForChannel.mockReturnValue(new Map([["twitch", matches]]));

    render(
      <ContextualEmoteRow
        inputValue="K"
        cursorPosition={1}
        platform="twitch"
        channelId="channel-a"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getAllByRole("option")).toHaveLength(9);
    const results = screen.getByTestId("contextual-emote-results");
    expect(results).toHaveClass("overflow-hidden", "gap-0.5");
    expect(results).not.toHaveClass("overflow-x-auto", "overflow-x-scroll", "no-scrollbar");
    for (const option of screen.getAllByRole("option")) {
      expect(option).toHaveClass("h-7", "w-7");
    }
  });

  // Guards: catalog or eligibility shrink resets selection to a valid provider:id result.
  it("keeps selection and announcements valid when the result identities shrink", () => {
    const initial = Array.from({ length: 9 }, (_, index) =>
      emote(String(index), `Kappa${index}`, "twitch")
    );
    storeState.getEmotesByProviderForChannel.mockReturnValue(new Map([["twitch", initial]]));
    const props = {
      inputValue: "K",
      cursorPosition: 1,
      platform: "twitch" as const,
      channelId: "channel-a",
      onSelect: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<ContextualEmoteRow {...props} />);
    for (let index = 0; index < 8; index++) {
      fireEvent.keyDown(document, { key: "ArrowRight" });
    }
    expect(screen.getByRole("option", { name: /Kappa8/ })).toHaveAttribute("aria-selected", "true");

    storeState.getEmotesByProviderForChannel.mockReturnValue(new Map([["twitch", [initial[0]]]]));
    storeState.emoteRevision++;
    rerender(<ContextualEmoteRow {...props} />);

    expect(screen.getByRole("option", { name: /Kappa0/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Kappa0 from Twitch selected, identity twitch:0"
    );
  });

  // Guards: one composer's pending emote load cannot mask ready results in another composer.
  it("isolates loading state by platform and channel", () => {
    storeState.isLoading = true;
    storeState.loadedGlobalPlatforms = new Set(["twitch"]);
    storeState.loadedChannels = new Set(["channel-ready"]);
    storeState.getEmotesByProviderForChannel.mockImplementation(
      (channelId) =>
        new Map([
          [
            "twitch",
            [
              emote(
                channelId,
                channelId === "channel-ready" ? "KappaReady" : "KappaPending",
                "twitch"
              ),
            ],
          ],
        ])
    );

    render(
      <>
        <ContextualEmoteRow
          inputValue="K"
          cursorPosition={1}
          platform="twitch"
          channelId="channel-loading"
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />
        <ContextualEmoteRow
          inputValue="K"
          cursorPosition={1}
          platform="twitch"
          channelId="channel-ready"
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />
      </>
    );

    const [loadingRow, readyRow] = screen.getAllByTestId("contextual-emote-row");
    expect(within(loadingRow).getByText("Loading emotes…")).toBeInTheDocument();
    expect(within(readyRow).getByRole("option", { name: /KappaReady/ })).toBeInTheDocument();
  });
});
