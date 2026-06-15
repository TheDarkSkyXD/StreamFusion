import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatDisplayPreferences, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@/shared/auth-types";
import { installElectronAPIMock } from "../../test-utils";

// Capture the latest navigate target so the "More settings" deep-link can be
// asserted. The real router isn't mounted in a unit test, so useNavigate is
// stubbed to record its argument.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

// Mutable chatDisplay the mocked auth store hands back. updatePreferences
// captures the patch so the spread-preserved single-field write can be
// asserted (AE4 — gear + tab edit the same global group).
const updatePreferencesMock = vi.fn(async () => undefined);
const mockChatDisplay: { value: ChatDisplayPreferences } = {
  value: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
};
const mockAuthUsers: {
  kickUser: null | { slug?: string; username?: string };
  twitchUser: null | { displayName?: string; login?: string };
} = {
  kickUser: null,
  twitchUser: null,
};

vi.mock("@/store/auth-store", () => {
  // useChatDisplay reads `preferences?.chatDisplay` reactively AND pulls the
  // freshest value imperatively via getState() inside the writer, so both the
  // selector and getState resolve from the mutable holder.
  const buildState = () => ({
    kickUser: mockAuthUsers.kickUser,
    preferences: { chatDisplay: mockChatDisplay.value },
    twitchUser: mockAuthUsers.twitchUser,
    updatePreferences: updatePreferencesMock,
  });
  const useAuthStore = (selector?: (s: ReturnType<typeof buildState>) => unknown) => {
    const state = buildState();
    return selector ? selector(state) : state;
  };
  (useAuthStore as unknown as { getState: () => ReturnType<typeof buildState> }).getState = () =>
    buildState();
  return { useAuthStore };
});

import { ChatQuickSettingsPopover } from "@/components/chat/ChatQuickSettingsPopover";

// Guards: quick settings popup title, close button, back button, and chevrons stay sized like Kick's chat settings popup.
// Guards: row chevrons use a bold solid glyph like Kick, not a thin outline/light chevron.
// Guards: quick settings popup fits within its chat-column anchor instead of overflowing at a fixed width.
// Guards: quick settings popup uses a lighter solid gray popup surface instead of translucent backgrounds.
// Guards: quick settings popup icons stay white instead of regressing to muted gray.
// Guards: Chat appearance keeps a Twitch-style preview and Kick-style font/emote size sliders instead of reverting to generic range rows.
describe("ChatQuickSettingsPopover", () => {
  beforeEach(() => {
    installElectronAPIMock();
    navigateMock.mockReset();
    updatePreferencesMock.mockReset();
    mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES };
    mockAuthUsers.kickUser = null;
    mockAuthUsers.twitchUser = null;
  });

  it("renders the root menu (Chat appearance entry + More settings)", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /chat appearance/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more settings/i })).toBeInTheDocument();
  });

  it("uses Kick-sized title text and navigation controls", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: /quick chat settings/i });
    const title = screen.getByRole("heading", { name: /chat settings/i });
    const closeButton = screen.getByRole("button", { name: /close chat settings/i });
    const appearanceButton = screen.getByRole("button", { name: /chat appearance/i });
    const appearanceIcon = appearanceButton.querySelector("span");
    const chevronIcon = Array.from(appearanceButton.querySelectorAll("span")).at(-1);
    const chevronSvg = chevronIcon?.querySelector("svg");

    expect(dialog).toHaveClass("bg-[#232629]");
    expect(dialog).toHaveClass("w-[320px]", "max-w-full", "min-w-0");
    expect(appearanceButton).toHaveClass("hover:bg-[#2F3438]");
    expect(title).toHaveClass("text-base", "leading-6");
    expect(closeButton).toHaveClass("text-white");
    expect(closeButton).toHaveClass("h-8", "w-8");
    expect(closeButton).toHaveClass("rounded-full");
    expect(closeButton).toHaveClass("hover:bg-[#2F3438]");
    expect(closeButton.querySelector("svg")).toHaveAttribute("height", "20");
    expect(closeButton.querySelector("svg")).toHaveAttribute("stroke-width", "3");
    expect(appearanceIcon).toHaveClass("text-white");
    expect(chevronIcon).toHaveClass("text-white", "h-6", "w-6");
    expect(chevronSvg).toHaveAttribute("height", "22");
    expect(chevronSvg).toHaveAttribute("viewBox", "0 0 320 512");

    fireEvent.click(appearanceButton);
    const backButton = screen.getByRole("button", { name: /back to chat settings/i });
    const fontSizeRange = screen.getByLabelText("Font size");
    const emoteSizeRange = screen.getByLabelText("Emote size");
    const defaultFontLabel = screen.getByTestId("font-size-label-default");
    const largeFontLabel = screen.getByTestId("font-size-label-large");
    const maxFontLabel = screen.getByTestId("font-size-label-max");
    const minEmoteLabel = screen.getByTestId("emote-size-label-min");
    const defaultEmoteLabel = screen.getByTestId("emote-size-label-default");
    const largeEmoteLabel = screen.getByTestId("emote-size-label-large");
    const maxEmoteLabel = screen.getByTestId("emote-size-label-max");

    expect(backButton).toHaveClass("text-white");
    expect(backButton).toHaveClass("h-8", "w-8");
    expect(backButton.querySelector("svg")).toHaveAttribute("height", "16");
    expect(fontSizeRange).toHaveClass("cursor-pointer");
    expect(emoteSizeRange).toHaveClass("cursor-pointer");
    expect(defaultFontLabel).toHaveClass("text-white");
    expect(largeFontLabel).toHaveClass("text-[#9ca3af]");
    expect(defaultFontLabel).toHaveClass("absolute", "-translate-x-1/2");
    expect(maxFontLabel).toHaveClass("absolute", "-translate-x-1/2");
    expect(Number.parseFloat(defaultFontLabel.style.left)).toBeCloseTo(33.33, 2);
    expect(maxFontLabel.style.left).toBe("100%");
    expect(minEmoteLabel).toHaveClass("absolute", "-translate-x-1/2");
    expect(defaultEmoteLabel).toHaveClass("absolute", "-translate-x-1/2");
    expect(largeEmoteLabel).toHaveClass("absolute", "-translate-x-1/2");
    expect(maxEmoteLabel).toHaveClass("absolute", "-translate-x-1/2");
    expect(minEmoteLabel).toHaveAttribute("data-emote-name", "Kappa");
    const fontStopDots = screen.getAllByTestId("font-size-stop-dot");
    const emoteStopDots = screen.getAllByTestId("emote-size-stop-dot");
    const fontStopPositions = fontStopDots.map((dot) => Number.parseFloat(dot.style.left));
    const emoteStopPositions = emoteStopDots.map((dot) => Number.parseFloat(dot.style.left));
    const dialogMarkup = dialog.innerHTML;
    expect(fontStopDots).toHaveLength(4);
    expect(emoteStopDots).toHaveLength(4);
    expect(dialogMarkup).not.toContain("bg-[#00e701]");
    expect(dialogMarkup).not.toContain("bg-[#fb5f7a]");
    expect(fontStopPositions[0]).toBe(0);
    expect(fontStopPositions[1]).toBeCloseTo(33.33, 2);
    expect(fontStopPositions[2]).toBeCloseTo(66.67, 2);
    expect(fontStopPositions[3]).toBe(100);
    expect(emoteStopPositions[0]).toBe(0);
    expect(emoteStopPositions[1]).toBeCloseTo(33.33, 2);
    expect(emoteStopPositions[2]).toBeCloseTo(66.67, 2);
    expect(emoteStopPositions[3]).toBe(100);
    expect(minEmoteLabel.style.left).toBe(emoteStopDots[0]!.style.left);
    expect(defaultEmoteLabel.style.left).toBe(emoteStopDots[1]!.style.left);
    expect(largeEmoteLabel.style.left).toBe(emoteStopDots[2]!.style.left);
    expect(maxEmoteLabel.style.left).toBe(emoteStopDots[3]!.style.left);
    for (const dot of fontStopDots) {
      expect(dot).toHaveClass("z-[2]");
      expect(dot).toHaveClass("bg-[#232629]", "border-[#5b6068]");
      expect(dot).not.toHaveClass("bg-[#fb5f7a]");
    }
    for (const dot of emoteStopDots) {
      expect(dot).toHaveClass("z-[2]");
      expect(dot).toHaveClass("bg-[#232629]", "border-[#5b6068]");
      expect(dot).not.toHaveClass("bg-[#fb5f7a]");
    }
    expect(fontStopDots[1]!).toHaveClass(
      "h-[18px]",
      "w-[18px]",
      "border-[3px]",
      "border-[#5b6068]"
    );
    expect(fontStopDots[1]!).toHaveStyle({ borderColor: "#5b6068" });
  });

  it("turns the selected font-size label white instead of keeping Default white", () => {
    mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, fontSizePx: 18 };
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    expect(screen.getByTestId("font-size-label-default")).toHaveClass("text-[#9ca3af]");
    expect(screen.getByTestId("font-size-label-large")).toHaveClass("text-white");
  });

  it("drills into the Chat appearance sub-view to show the quick subset", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    const fontSizeRange = screen.getByLabelText("Font size");
    expect(screen.getByText("Chat Appearance")).toBeInTheDocument();
    expect(screen.getByTestId("chat-appearance-preview")).toHaveClass(
      "overflow-hidden",
      "bg-[#2F3438]"
    );
    expect(screen.getByText("guest:")).toBeInTheDocument();
    expect(screen.getByText("Hi there!")).toBeInTheDocument();
    expect(screen.getByText("modbot:")).toBeInTheDocument();
    expect(screen.getByText("viewer:")).toBeInTheDocument();
    expect(screen.getByTestId("chat-appearance-density-preview")).toHaveAttribute(
      "data-density",
      "cozy"
    );
    expect(screen.getByTestId("chat-preview-row-primary")).toHaveClass("py-1.5", "leading-5");
    const previewEmote = screen.getByRole("img", { name: /preview emote/i });
    expect(previewEmote).toHaveAttribute("data-emote-name", "Kappa");
    expect(previewEmote).toHaveAttribute(
      "data-emote-url",
      "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0"
    );
    expect(previewEmote).toHaveStyle({
      height: `${DEFAULT_CHAT_DISPLAY_PREFERENCES.emoteSizePx}px`,
      width: `${DEFAULT_CHAT_DISPLAY_PREFERENCES.emoteSizePx}px`,
    });
    expect(screen.getByTestId("emote-size-label-min")).toHaveAttribute("data-emote-name", "Kappa");
    expect(screen.queryByText("HI")).toBeNull();
    expect(screen.getByText("You may customize your Chat appearance below.")).toBeInTheDocument();
    expect(screen.getAllByText("Default")).toHaveLength(2);
    expect(fontSizeRange).toHaveAttribute("type", "range");
    expect(fontSizeRange).toHaveAttribute("min", "0");
    expect(fontSizeRange).toHaveAttribute("max", "3");
    expect(fontSizeRange).toHaveAttribute(
      "aria-valuetext",
      `${DEFAULT_CHAT_DISPLAY_PREFERENCES.fontSizePx}px`
    );
    expect((fontSizeRange as HTMLInputElement).value).toBe("1");
    const emoteSizeRange = screen.getByLabelText("Emote size");
    expect(emoteSizeRange).toHaveAttribute("type", "range");
    expect(emoteSizeRange).toHaveAttribute("min", "0");
    expect(emoteSizeRange).toHaveAttribute("max", "3");
    expect(emoteSizeRange).toHaveAttribute(
      "aria-valuetext",
      `${DEFAULT_CHAT_DISPLAY_PREFERENCES.emoteSizePx}px`
    );
    expect((emoteSizeRange as HTMLInputElement).value).toBe("1");
    expect(screen.getByText("Density")).toBeInTheDocument();
    expect(screen.getByText("Show timestamps")).toBeInTheDocument();
  });

  it("shows compact density with tighter preview rows", () => {
    mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, density: "compact" };
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    expect(screen.getByTestId("chat-appearance-density-preview")).toHaveAttribute(
      "data-density",
      "compact"
    );
    expect(screen.getByTestId("chat-preview-row-primary")).toHaveClass("py-0", "leading-4");
    expect(screen.getByRole("button", { name: "Compact" })).toHaveClass("bg-[#dc143c]");
  });

  it("uses the authenticated Twitch display name in the preview on Twitch streams", () => {
    mockAuthUsers.twitchUser = { displayName: "TwitchViewer", login: "twitchviewer" };
    render(<ChatQuickSettingsPopover platform="twitch" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    expect(screen.getByText("TwitchViewer:")).toBeInTheDocument();
  });

  it("uses the authenticated Kick username in the preview on Kick streams", () => {
    mockAuthUsers.kickUser = { slug: "kickviewer", username: "KickViewer" };
    render(<ChatQuickSettingsPopover platform="kick" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    expect(screen.getByText("KickViewer:")).toBeInTheDocument();
    expect(screen.getByTestId("chat-preview-emote")).toHaveAttribute(
      "data-emote-name",
      "emojiCheerful"
    );
    expect(screen.getByTestId("emote-size-label-min")).toHaveAttribute(
      "data-emote-name",
      "emojiCheerful"
    );
  });

  it("does NOT render Message limit or Clear local chat anywhere", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    expect(screen.queryByText(/message limit/i)).toBeNull();
    expect(screen.queryByText(/clear local chat/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    expect(screen.queryByText(/message limit/i)).toBeNull();
    expect(screen.queryByText(/clear local chat/i)).toBeNull();
  });

  it('does NOT render a "show badges" control (no such chatDisplay field)', () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    expect(screen.queryByText(/badges/i)).toBeNull();
  });

  // AE4 — the gear writes the SAME global group the Chat tab reads, with the
  // spread preserved (sibling fields intact).
  it("changing font size in the sub-view persists chatDisplay with the spread preserved", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    const fontRange = screen.getByLabelText("Font size");
    act(() => {
      fireEvent.change(fontRange, { target: { value: "2" } });
    });
    expect(updatePreferencesMock).toHaveBeenCalledTimes(1);
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, fontSizePx: 18 },
    });
  });

  it("selecting the Default font stop persists 16px instead of the smallest size", () => {
    mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, fontSizePx: 18 };
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    const fontRange = screen.getByLabelText("Font size");
    act(() => {
      fireEvent.change(fontRange, { target: { value: "1" } });
    });
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, fontSizePx: 16 },
    });
  });

  it("displays legacy between-dot font values on the new default stop", () => {
    mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, fontSizePx: 13 };
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    expect(screen.getByLabelText("Font size")).toHaveValue("1");
    expect(screen.getByLabelText("Font size")).toHaveAttribute("aria-valuetext", "16px");
  });

  it("changing emote size in the sub-view persists chatDisplay with the spread preserved", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    const emoteRange = screen.getByLabelText("Emote size");
    act(() => {
      fireEvent.change(emoteRange, { target: { value: "2" } });
    });
    expect(updatePreferencesMock).toHaveBeenCalledTimes(1);
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, emoteSizePx: 42 },
    });
  });

  it("selecting the Default emote stop persists 28px", () => {
    mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, emoteSizePx: 42 };
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    const emoteRange = screen.getByLabelText("Emote size");
    act(() => {
      fireEvent.change(emoteRange, { target: { value: "1" } });
    });
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, emoteSizePx: 28 },
    });
  });

  // "More settings" deep-links to the full Chat tab (/settings?tab=chat).
  it('"More settings" navigates to the Chat settings tab and closes', () => {
    const onClose = vi.fn();
    render(<ChatQuickSettingsPopover onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /more settings/i }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/settings", search: { tab: "chat" } });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("back button in the sub-view returns to the root menu", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    expect(screen.getByLabelText("Font size")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to chat settings/i }));
    expect(screen.queryByLabelText("Font size")).toBeNull();
    expect(screen.getByRole("button", { name: /more settings/i })).toBeInTheDocument();
  });

  it("closes on outside-click", () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button" data-testid="outside">
          outside
        </button>
        <ChatQuickSettingsPopover onClose={onClose} />
      </div>
    );
    act(() => {
      fireEvent.mouseDown(screen.getByTestId("outside"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close on inside-click", () => {
    const onClose = vi.fn();
    render(<ChatQuickSettingsPopover onClose={onClose} />);
    act(() => {
      fireEvent.mouseDown(screen.getByRole("dialog"));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does NOT close when clicking the trigger button", () => {
    const onClose = vi.fn();
    const triggerRef = { current: null as HTMLButtonElement | null };
    render(
      <div>
        <button
          type="button"
          ref={(node) => {
            triggerRef.current = node;
          }}
        >
          Chat settings
        </button>
        <ChatQuickSettingsPopover onClose={onClose} triggerRef={triggerRef} />
      </div>
    );
    act(() => {
      fireEvent.mouseDown(screen.getByRole("button", { name: /^chat settings$/i }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape closes from the root view", () => {
    const onClose = vi.fn();
    render(<ChatQuickSettingsPopover onClose={onClose} />);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape from the sub-view backs out first, then closes from root", () => {
    const onClose = vi.fn();
    render(<ChatQuickSettingsPopover onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    expect(screen.getByLabelText("Font size")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Font size")).toBeNull();
    expect(screen.getByRole("button", { name: /more settings/i })).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
