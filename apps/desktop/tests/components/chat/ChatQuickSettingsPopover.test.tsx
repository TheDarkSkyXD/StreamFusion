import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
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

// Mirror the store's reactive preference source while updatePreferences captures
// the spread-preserved single-field write (AE4: gear + tab edit the same group).
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
const mockAuthStoreListeners = new Set<() => void>();

vi.mock("@/store/auth-store", () => {
  const buildState = () => ({
    kickUser: mockAuthUsers.kickUser,
    preferences: { chatDisplay: mockChatDisplay.value },
    twitchUser: mockAuthUsers.twitchUser,
    updatePreferences: updatePreferencesMock,
  });
  const subscribe = (listener: () => void) => {
    mockAuthStoreListeners.add(listener);
    return () => mockAuthStoreListeners.delete(listener);
  };
  const useAuthStore = (selector: (state: ReturnType<typeof buildState>) => unknown) => {
    return useSyncExternalStore(
      subscribe,
      () => selector(buildState()),
      () => selector(buildState())
    );
  };
  Object.assign(useAuthStore, {
    getState: buildState,
    setState: (nextState: Partial<ReturnType<typeof buildState>>) => {
      if (nextState.preferences) {
        mockChatDisplay.value = nextState.preferences.chatDisplay;
      }
      mockAuthStoreListeners.forEach((listener) => listener());
    },
    subscribe,
  });
  return { useAuthStore };
});

import { ChatQuickSettingsPopover } from "@/components/chat/ChatQuickSettingsPopover";

// Guards: quick settings popup title, close button, back button, and chevrons stay sized like Kick's chat settings popup.
// Guards: row chevrons use a bold solid glyph like Kick, not a thin outline/light chevron.
// Guards: quick settings popup fits within its chat-column anchor instead of overflowing at a fixed width.
// Guards: quick settings popup uses a lighter solid neutral popup surface instead of translucent backgrounds.
// Guards: quick settings popup icons stay white instead of regressing to muted neutral.
// Guards: Chat appearance keeps a Twitch-style preview and Kick-style font/emote size sliders instead of reverting to generic range rows.
// Guards: quick settings exposes Twitch-style Pause Chat radio options and persists the selected pause trigger.
// Guards: quick appearance controls expose their persisted state through accessible, immediately responsive controls.
// Guards: reactive appearance edits retain keyboard focus and scroll position instead of remounting the quick-settings view.
// Guards: Tight, Medium, and Loose preview rows use live-message padding without an additional density gap between rows.
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
    expect(screen.getByRole("button", { name: /pause chat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /chat appearance/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more settings/i })).toBeInTheDocument();
  });

  it("drills into the Twitch-style Pause Chat sub-view and persists the selected radio", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /pause chat/i }));

    expect(screen.getByText(/Manage your Pause Chat options/i)).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Pause Chat" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Scroll Only" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Mouseover" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Hold Alt Key" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Mouseover/Alt Key" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Mouseover" }));

    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, pauseMode: "mouseover" },
    });
  });

  it("shows the selected Pause Chat mode in the root row", () => {
    mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, pauseMode: "mouseover-alt" };

    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: /pause chat mouseover\/alt key/i })
    ).toBeInTheDocument();
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

    expect(dialog).toHaveClass("bg-neutral-800");
    expect(dialog).toHaveClass("w-[320px]", "max-w-full", "min-w-0");
    expect(appearanceButton).toHaveClass("hover:bg-neutral-700");
    expect(title).toHaveClass("text-base", "leading-6");
    expect(closeButton).toHaveClass("text-white");
    expect(closeButton).toHaveClass("h-8", "w-8");
    expect(closeButton).toHaveClass("rounded-full");
    expect(closeButton).toHaveClass("hover:bg-neutral-700");
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
      expect(dot).toHaveClass("bg-neutral-800", "border-neutral-700");
      expect(dot).not.toHaveClass("bg-[#fb5f7a]");
    }
    for (const dot of emoteStopDots) {
      expect(dot).toHaveClass("z-[2]");
      expect(dot).toHaveClass("bg-neutral-800", "border-neutral-700");
      expect(dot).not.toHaveClass("bg-[#fb5f7a]");
    }
    expect(fontStopDots[1]!).toHaveClass(
      "h-[18px]",
      "w-[18px]",
      "border-[3px]",
      "border-neutral-700"
    );
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
      "mx-[2px]",
      "mt-3",
      "mb-2",
      "overflow-hidden",
      "rounded-md",
      "border",
      "bg-neutral-700"
    );
    expect(screen.getByText("guest:")).toBeInTheDocument();
    expect(screen.getByText("Hi there!")).toBeInTheDocument();
    expect(screen.getByText("modbot:")).toBeInTheDocument();
    expect(screen.getByText("viewer:")).toBeInTheDocument();
    expect(screen.getByTestId("chat-appearance-density-preview")).toHaveAttribute(
      "data-density",
      "cozy"
    );
    expect(screen.getByTestId("chat-preview-row-primary")).toHaveClass("py-1", "leading-5");
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
    expect(screen.getByText("Message spacing")).toBeInTheDocument();
    expect(screen.getByText("Timestamps")).toBeInTheDocument();
    expect(screen.getByTestId("chat-appearance-content")).toHaveClass(
      "max-h-[calc(100vh-6rem)]",
      "overflow-y-auto",
      "overscroll-contain"
    );
  });

  it("selects and persists a chat-width preset immediately", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    const widthGroup = screen.getByRole("radiogroup", { name: "Chat width" });
    expect(widthGroup).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "340px" })).toBeChecked();
    expect(screen.getByText("Currently: 340px")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "420px" }));

    expect(screen.getByRole("radio", { name: "420px" })).toBeChecked();
    expect(screen.getByText("Currently: 420px")).toBeInTheDocument();
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, chatWidthPx: 420 },
    });
  });

  it("reflects non-default authoritative quick-appearance preferences", () => {
    mockChatDisplay.value = {
      ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
      chatWidthPx: 280,
      timestamps: true,
      hoverSmooth: false,
      quickEmotes: false,
    };

    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    expect(screen.getByRole("radio", { name: "280px" })).toBeChecked();
    expect(screen.getByText("Currently: 280px")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Timestamps" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Hover smooth mode" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Quick Emotes" })).not.toBeChecked();
  });

  it("maps message-spacing choices to density and updates the preview immediately", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    expect(screen.getByRole("radiogroup", { name: "Message spacing" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Medium" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Loose" }));

    expect(screen.getByRole("radio", { name: "Loose" })).toBeChecked();
    expect(screen.getByTestId("chat-appearance-density-preview")).toHaveAttribute(
      "data-density",
      "loose"
    );
    expect(screen.getByTestId("chat-preview-row-primary")).toHaveClass("py-3", "leading-6");
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, density: "loose" },
    });
  });

  it("toggles and persists timestamps immediately through a named switch", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    const timestampsSwitch = screen.getByRole("switch", { name: "Timestamps" });
    expect(timestampsSwitch).not.toBeChecked();

    fireEvent.click(timestampsSwitch);

    expect(timestampsSwitch).toBeChecked();
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, timestamps: true },
    });
  });

  it("retains focus and scroll position when an appearance edit updates shared preferences", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    const appearanceContent = screen.getByTestId("chat-appearance-content");
    const timestampsSwitch = screen.getByRole("switch", { name: "Timestamps" });
    appearanceContent.scrollTop = 160;
    timestampsSwitch.focus();

    fireEvent.click(timestampsSwitch);

    const updatedAppearanceContent = screen.getByTestId("chat-appearance-content");
    const updatedTimestampsSwitch = screen.getByRole("switch", { name: "Timestamps" });
    expect(updatedTimestampsSwitch).toHaveFocus();
    expect(updatedAppearanceContent).toBe(appearanceContent);
    expect(updatedAppearanceContent.scrollTop).toBe(160);
  });

  it("toggles and persists hover smooth mode immediately through a named switch", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    const hoverSmoothSwitch = screen.getByRole("switch", { name: "Hover smooth mode" });
    expect(hoverSmoothSwitch).toBeChecked();

    fireEvent.click(hoverSmoothSwitch);

    expect(hoverSmoothSwitch).not.toBeChecked();
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, hoverSmooth: false },
    });
  });

  it("toggles and persists Quick Emotes immediately through a named switch", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    const quickEmotesSwitch = screen.getByRole("switch", { name: "Quick Emotes" });
    expect(quickEmotesSwitch).toBeChecked();

    fireEvent.click(quickEmotesSwitch);

    expect(quickEmotesSwitch).not.toBeChecked();
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, quickEmotes: false },
    });
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
    expect(screen.getByRole("radio", { name: "Tight" })).toBeChecked();
  });

  it.each([
    ["compact", "py-0"],
    ["cozy", "py-1"],
    ["loose", "py-3"],
  ] as const)(
    "uses %s live-row padding without a parent density gap",
    (density, rowPaddingClass) => {
      mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, density };
      render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

      const preview = screen.getByTestId("chat-appearance-density-preview");
      for (const row of [
        screen.getByTestId("chat-preview-row-primary"),
        screen.getByTestId("chat-preview-row-mod"),
        screen.getByTestId("chat-preview-row-viewer"),
      ]) {
        expect(row).toHaveClass(rowPaddingClass);
      }
      expect(preview.className).not.toMatch(/space-y-/);
    }
  );

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
    expect(screen.queryByText(/gifted sub leaderboard/i)).toBeNull();
    expect(screen.queryByText(/events banner/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    expect(screen.queryByText(/message limit/i)).toBeNull();
    expect(screen.queryByText(/clear local chat/i)).toBeNull();
    expect(screen.queryByText(/gifted sub leaderboard/i)).toBeNull();
    expect(screen.queryByText(/events banner/i)).toBeNull();
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
    const backButton = screen.getByRole("button", { name: /back to chat settings/i });
    expect(backButton).toHaveClass("rounded-full", "hover:bg-neutral-700");
    fireEvent.click(backButton);
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
