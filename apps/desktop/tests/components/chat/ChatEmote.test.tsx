import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ChatEmote } from "@/features/chat/components/chat/ChatEmote";
import { type ChatDisplayPreferences, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

// Seed the chatDisplay prefs ChatEmote reads. Mirrors the ChatMessage test
// helper — leaving the store untouched falls back to DEFAULT_CHAT_DISPLAY_PREFERENCES.
function setChatDisplay(overrides: Partial<ChatDisplayPreferences>) {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...overrides },
    } as typeof s.preferences,
  }));
}

beforeEach(() => {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
    } as typeof s.preferences,
  }));
});

// Guards: chat emote rendering must respect the viewer's emoteSizePx / overlayEmotes / animatedEmotes prefs — silently regressing to defaults would change chat readability without the viewer's consent
// Guards: ChatEmote owns sticky-tooltip state — outside-click + Escape must dismiss it, otherwise the tooltip portal will trap viewer interaction on the next message
// Guards: a failed 7TV CDN image retries once through the official IPv4 edge, then keeps chat readable as the emote name without looping
// Guards: a successful official-edge load is reused so repeated inline emotes do not hammer a failed canonical DNS route
// Guards: reused inline message rows reset failed image state when their emote URL changes
describe("ChatEmote", () => {
  it("renders the emote image with the name as alt text", () => {
    render(<ChatEmote id="e1" name="Kappa" url="https://x.test/kappa.png" platform="twitch" />);
    expect(screen.getByAltText("Kappa")).toBeInTheDocument();
  });

  it("keeps inline chat emote fetch and decode work off the critical path", () => {
    render(<ChatEmote id="e1" name="Kappa" url="https://x.test/kappa.png" platform="twitch" />);
    const img = screen.getByAltText("Kappa") as HTMLImageElement;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("fetchpriority")).toBe("low");
  });

  it("retries a failed 7TV image once on the official IPv4 edge, then shows its name", () => {
    const original = "https://cdn.7tv.app/emote/01JN1YCGD0Y156B953CR1Q6W1M/2x.webp?animated=true";
    render(<ChatEmote id="seven" name="SevenTV" url={original} platform="twitch" />);

    const originalImage = screen.getByAltText("SevenTV");
    expect(originalImage).toHaveAttribute("src", original);

    fireEvent.error(originalImage);
    const fallbackImage = screen.getByAltText("SevenTV");
    expect(fallbackImage).toHaveAttribute(
      "src",
      "https://ipv4-1.eu.cdn.7tv.app/emote/01JN1YCGD0Y156B953CR1Q6W1M/2x.webp?animated=true"
    );

    fireEvent.error(fallbackImage);
    expect(screen.queryByRole("img", { name: "SevenTV" })).not.toBeInTheDocument();
    expect(screen.getByText("SevenTV")).toBeInTheDocument();
  });

  it("reuses a loaded official-edge fallback for later copies of the same inline emote", () => {
    const original = "https://cdn.7tv.app/emote/chat-cache/2x.webp";
    const first = render(
      <ChatEmote id="chat-cache" name="ChatCached" url={original} platform="twitch" />
    );

    fireEvent.error(screen.getByAltText("ChatCached"));
    const fallback = screen.getByAltText("ChatCached");
    fireEvent.load(fallback);
    first.unmount();

    render(<ChatEmote id="chat-cache" name="ChatCached" url={original} platform="twitch" />);
    expect(screen.getByAltText("ChatCached")).toHaveAttribute(
      "src",
      "https://ipv4-1.eu.cdn.7tv.app/emote/chat-cache/2x.webp"
    );
  });

  it("resets a failed attempt when the inline emote URL prop changes", () => {
    const view = render(
      <ChatEmote
        id="changing"
        name="Changing"
        url="https://cdn.7tv.app/emote/old-chat/2x.webp"
        platform="twitch"
      />
    );
    fireEvent.error(screen.getByAltText("Changing"));
    fireEvent.error(screen.getByAltText("Changing"));
    expect(screen.getByText("Changing")).toBeInTheDocument();

    view.rerender(
      <ChatEmote
        id="changing"
        name="Changing"
        url="https://cdn.7tv.app/emote/new-chat/2x.webp"
        platform="twitch"
      />
    );
    expect(screen.getByAltText("Changing")).toHaveAttribute(
      "src",
      "https://cdn.7tv.app/emote/new-chat/2x.webp"
    );
  });

  it("does not rewrite a failed non-7TV provider URL", () => {
    render(
      <ChatEmote
        id="bttv"
        name="BetterTTV"
        url="https://cdn.betterttv.net/emote/id/2x.webp"
        platform="twitch"
      />
    );

    fireEvent.error(screen.getByAltText("BetterTTV"));
    expect(screen.queryByRole("img", { name: "BetterTTV" })).not.toBeInTheDocument();
    expect(screen.getByText("BetterTTV")).toBeInTheDocument();
  });

  it("keeps 7TV provider inference and tooltip behavior after switching image hosts", () => {
    render(
      <ChatEmote
        id="provider-seven"
        name="ProviderSeven"
        url="https://cdn.7tv.app/emote/provider-seven/2x.webp"
        platform="twitch"
      />
    );
    fireEvent.error(screen.getByAltText("ProviderSeven"));

    fireEvent.mouseEnter(screen.getByAltText("ProviderSeven"));
    expect(screen.getByText("7TV")).toBeInTheDocument();
  });

  it("shows tooltip on mouse enter", () => {
    render(<ChatEmote id="e1" name="PogChamp" url="https://x.test/pog.png" platform="twitch" />);
    fireEvent.mouseEnter(screen.getByAltText("PogChamp"));
    // Tooltip portal renders another image with the same alt.
    expect(screen.getAllByAltText("PogChamp").length).toBeGreaterThan(1);
  });
});

describe("ChatEmote sticky tooltip on click (Xtra parity)", () => {
  it("opens the tooltip on click and keeps it open after mouse leave", () => {
    render(<ChatEmote id="e1" name="KEKW" url="https://x.test/kekw.png" platform="twitch" />);
    const img = screen.getByAltText("KEKW");
    fireEvent.click(img);
    fireEvent.mouseLeave(img);
    // Sticky persists after the cursor is gone — tooltip portal still renders an img with the same alt.
    expect(screen.getAllByAltText("KEKW").length).toBeGreaterThan(1);
  });

  it("toggles the sticky tooltip off on a second click", () => {
    render(<ChatEmote id="e1" name="KEKW" url="https://x.test/kekw.png" platform="twitch" />);
    const img = screen.getByAltText("KEKW");
    fireEvent.click(img);
    fireEvent.mouseLeave(img);
    expect(screen.getAllByAltText("KEKW").length).toBeGreaterThan(1);
    fireEvent.click(img);
    expect(screen.getAllByAltText("KEKW").length).toBe(1);
  });

  it("closes the sticky tooltip when clicking outside the emote", () => {
    render(
      <div>
        <ChatEmote id="e1" name="KEKW" url="https://x.test/kekw.png" platform="twitch" />
        <div data-testid="outside">outside</div>
      </div>
    );
    const img = screen.getByAltText("KEKW");
    fireEvent.click(img);
    fireEvent.mouseLeave(img);
    expect(screen.getAllByAltText("KEKW").length).toBeGreaterThan(1);
    // Document-level click outside the emote dismisses the sticky tooltip.
    fireEvent.click(screen.getByTestId("outside"));
    expect(screen.getAllByAltText("KEKW").length).toBe(1);
  });

  it("closes the sticky tooltip when Escape is pressed", () => {
    render(<ChatEmote id="e1" name="KEKW" url="https://x.test/kekw.png" platform="twitch" />);
    const img = screen.getByAltText("KEKW");
    fireEvent.click(img);
    fireEvent.mouseLeave(img);
    expect(screen.getAllByAltText("KEKW").length).toBeGreaterThan(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getAllByAltText("KEKW").length).toBe(1);
  });
});

describe("ChatEmote emote size (U2/U3)", () => {
  it("renders a normal emote at the configured emoteSizePx", () => {
    setChatDisplay({ emoteSizePx: 32 });
    render(<ChatEmote id="e1" name="Kappa" url="https://x.test/kappa.png" platform="twitch" />);
    const img = screen.getByAltText("Kappa") as HTMLImageElement;
    expect(img.style.height).toBe("32px");
  });

  it("preserves provider geometry for wide and large emotes", () => {
    setChatDisplay({ emoteSizePx: 28 });
    render(
      <ChatEmote
        id="wide"
        name="Wide"
        url="https://cdn.7tv.app/emote/wide/2x.webp"
        url1x="https://cdn.7tv.app/emote/wide/1x.webp"
        url2x="https://cdn.7tv.app/emote/wide/2x.webp"
        url4x="https://cdn.7tv.app/emote/wide/4x.webp"
        width={112}
        height={56}
        platform="twitch"
        provider="7tv"
      />
    );
    const img = screen.getByAltText("Wide") as HTMLImageElement;
    expect(img.style.width).toBe("112px");
    expect(img.style.height).toBe("56px");
    expect(img.getAttribute("srcset")).toContain("1x");
    expect(img.getAttribute("srcset")).toContain("4x");
  });

  it("learns BTTV logical geometry from a decoded 2x image without another request", () => {
    setChatDisplay({ emoteSizePx: 28 });
    render(
      <ChatEmote
        id="bttv-wide"
        name="BttvWide"
        url="https://cdn.betterttv.net/emote/bttv-wide/2x.webp"
        url1x="https://cdn.betterttv.net/emote/bttv-wide/1x.webp"
        url2x="https://cdn.betterttv.net/emote/bttv-wide/2x.webp"
        platform="twitch"
        provider="bttv"
      />
    );
    const img = screen.getByAltText("BttvWide") as HTMLImageElement;
    Object.defineProperties(img, {
      naturalWidth: { configurable: true, value: 224 },
      naturalHeight: { configurable: true, value: 56 },
    });
    fireEvent.load(img);

    expect(img.style.width).toBe("112px");
    expect(img.style.height).toBe("28px");
    expect(img.getAttribute("srcset")).toBeNull();
  });
});

describe("ChatEmote overlay / zero-width (U3)", () => {
  it("stacks a zero-width emote as an overlay when overlayEmotes is true", () => {
    setChatDisplay({ overlayEmotes: true, emoteSizePx: 28 });
    render(
      <ChatEmote
        id="zw"
        name="OverlayEmote"
        url="https://7tv.app/emote/zw/2x.webp"
        platform="twitch"
        isZeroWidth
      />
    );
    const img = screen.getByAltText("OverlayEmote") as HTMLImageElement;
    const trigger = img.closest("button") as HTMLButtonElement;
    // Overlay: absolutely positioned and pulled back over the previous emote.
    expect(trigger.dataset.zeroWidth).toBe("true");
    expect(trigger.style.position).toBe("absolute");
    expect(trigger.style.transform).toBe("translateX(-100%)");
  });

  it("renders a zero-width emote inline (no overlay) when overlayEmotes is false", () => {
    setChatDisplay({ overlayEmotes: false });
    render(
      <ChatEmote
        id="zw"
        name="OverlayEmote"
        url="https://7tv.app/emote/zw/2x.webp"
        platform="twitch"
        isZeroWidth
      />
    );
    const img = screen.getByAltText("OverlayEmote") as HTMLImageElement;
    const trigger = img.closest("button") as HTMLButtonElement;
    expect(trigger.dataset.zeroWidth).toBeUndefined();
    expect(trigger.style.position).toBe("");
    expect(trigger.style.marginLeft).toBe("");
  });

  it("never treats a non-zero-width emote as an overlay even with overlayEmotes on", () => {
    setChatDisplay({ overlayEmotes: true });
    render(<ChatEmote id="e1" name="Kappa" url="https://x.test/kappa.png" platform="twitch" />);
    const img = screen.getByAltText("Kappa") as HTMLImageElement;
    const trigger = img.closest("button") as HTMLButtonElement;
    expect(trigger.dataset.zeroWidth).toBeUndefined();
    expect(trigger.style.position).toBe("");
  });
});

describe("ChatEmote animated toggle (U3)", () => {
  const TWITCH_DEFAULT_URL = "https://static-cdn.jtvnw.net/emoticons/v2/123/default/dark/3.0";

  it("freezes a native Twitch animated emote to a static frame when animatedEmotes is false", () => {
    setChatDisplay({ animatedEmotes: false });
    render(
      <ChatEmote id="123" name="AnimKappa" url={TWITCH_DEFAULT_URL} platform="twitch" isAnimated />
    );
    const img = screen.getByAltText("AnimKappa") as HTMLImageElement;
    // /default/ swapped to /static/ — the CDN serves a non-animated frame there.
    expect(img.getAttribute("src")).toBe(
      "https://static-cdn.jtvnw.net/emoticons/v2/123/static/dark/3.0"
    );
  });

  it("keeps the animated URL when animatedEmotes is true", () => {
    setChatDisplay({ animatedEmotes: true });
    render(
      <ChatEmote id="123" name="AnimKappa" url={TWITCH_DEFAULT_URL} platform="twitch" isAnimated />
    );
    const img = screen.getByAltText("AnimKappa") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(TWITCH_DEFAULT_URL);
  });

  it("falls back to the original URL when no static variant can be derived (7TV/BTTV)", () => {
    // 7TV/BTTV serve animated + static from the same file/URL — there is no
    // clean static transform, so the renderer keeps the original rather than
    // faking a freeze (see freezeEmoteUrl TODO).
    setChatDisplay({ animatedEmotes: false });
    const url = "https://cdn.7tv.app/emote/abc/2x.webp";
    render(<ChatEmote id="abc" name="SevenTV" url={url} platform="twitch" isAnimated />);
    const img = screen.getByAltText("SevenTV") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(url);
  });

  it("does not transform a non-animated emote regardless of the toggle", () => {
    setChatDisplay({ animatedEmotes: false });
    render(<ChatEmote id="123" name="StaticKappa" url={TWITCH_DEFAULT_URL} platform="twitch" />);
    const img = screen.getByAltText("StaticKappa") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(TWITCH_DEFAULT_URL);
  });
});
