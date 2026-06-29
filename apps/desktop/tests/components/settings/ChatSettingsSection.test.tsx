// Guards: the Chat settings controls must write chatDisplay (and the
// hide-panel toggle, the chat group) through updatePreferences with the
// spread preserved — a partial write that drops sibling fields would reset
// unrelated chat preferences. Also guards the no-stored-prefs path falling
// back to DEFAULT_CHAT_DISPLAY_PREFERENCES (older installs).
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserPreferences } from "@/shared/auth-types";

import { fireEvent, renderWithProviders, screen, waitFor } from "../../test-utils";

const updatePreferences = vi.fn(async (_updates: Partial<UserPreferences>) => {});
let storeState: { preferences: unknown; updatePreferences: typeof updatePreferences };

vi.mock("@/store/auth-store", () => ({
  useAuthStore: Object.assign(
    (selector?: (s: unknown) => unknown) => (selector ? selector(storeState) : storeState),
    { getState: () => storeState }
  ),
}));

import { ChatSettingsSection } from "@/components/settings/ChatSettingsSection";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES, DEFAULT_CHAT_PREFERENCES } from "@/shared/auth-types";

function setStore(preferences: unknown) {
  storeState = { preferences, updatePreferences };
}

describe("ChatSettingsSection", () => {
  beforeEach(() => {
    updatePreferences.mockClear();
    setStore({
      chatDisplay: {
        ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        boldUsernames: false,
        readableColorForUncolored: false,
        fontSizePx: 13,
      },
      chat: { ...DEFAULT_CHAT_PREFERENCES },
    });
  });

  it("toggling a switch writes chatDisplay with the spread preserved", async () => {
    renderWithProviders(<ChatSettingsSection only={["appearance"]} />);

    // Traverse to the outer SettingRow div (label <p> → inner text div → left
    // container → outer flex row), where the Switch lives in the right slot.
    const row = screen.getByText("Readable color for uncolored users").closest("div")!
      .parentElement!.parentElement!;
    fireEvent.click(row.querySelector('[role="switch"]')!);

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    const arg = updatePreferences.mock.calls[0][0] as {
      chatDisplay: typeof DEFAULT_CHAT_DISPLAY_PREFERENCES;
    };
    // Flipped field...
    expect(arg.chatDisplay.readableColorForUncolored).toBe(true);
    // Siblings intact (spread preserved).
    expect(arg.chatDisplay.boldUsernames).toBe(false);
    expect(arg.chatDisplay.fontSizePx).toBe(13);
    expect(arg.chatDisplay.emoteSizePx).toBe(DEFAULT_CHAT_DISPLAY_PREFERENCES.emoteSizePx);
    expect(arg.chatDisplay.messageLimit).toBe(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit);
  });

  it("does not render a bold usernames toggle because chat names are always bold", () => {
    renderWithProviders(<ChatSettingsSection only={["appearance"]} />);

    expect(screen.queryByText("Bold usernames")).toBeNull();
  });

  it("changing a range writes the numeric value with siblings intact", async () => {
    renderWithProviders(<ChatSettingsSection only={["appearance"]} />);

    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "18" } });

    await waitFor(() => expect(updatePreferences).toHaveBeenCalled());
    const arg = updatePreferences.mock.calls[0][0] as {
      chatDisplay: typeof DEFAULT_CHAT_DISPLAY_PREFERENCES;
    };
    expect(arg.chatDisplay.fontSizePx).toBe(18);
    expect(arg.chatDisplay.boldUsernames).toBe(false);
  });

  it("does not show a docked chat width control because the rail is fixed", () => {
    renderWithProviders(<ChatSettingsSection only={["appearance"]} />);

    expect(screen.queryByLabelText("Docked chat width")).toBeNull();
    expect(screen.queryByText("Docked chat width")).toBeNull();
  });

  it("falls back to defaults when no chatDisplay is stored", () => {
    setStore(null);
    renderWithProviders(<ChatSettingsSection only={["appearance"]} />);
    // Default fontSizePx shows in the range value readout.
    expect(screen.getByLabelText("Font size")).toHaveValue(
      String(DEFAULT_CHAT_DISPLAY_PREFERENCES.fontSizePx)
    );
  });

  it("hides the recent-messages-limit range until recentMessagesOnJoin is on", () => {
    setStore({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, recentMessagesOnJoin: false },
      chat: { ...DEFAULT_CHAT_PREFERENCES },
    });
    renderWithProviders(<ChatSettingsSection only={["events"]} />);
    expect(screen.queryByLabelText("Recent messages to load")).toBeNull();
  });

  it("uses the requested message limit slider range", () => {
    renderWithProviders(<ChatSettingsSection only={["events"]} />);

    const messageLimit = screen.getByLabelText("Message limit");
    expect(messageLimit).toHaveAttribute("min", "100");
    expect(messageLimit).toHaveAttribute("max", "1000");
    expect(messageLimit).toHaveAttribute("step", "100");
  });

  it("shows a deleted-message display dropdown and writes the selected mode", async () => {
    renderWithProviders(<ChatSettingsSection only={["events"]} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Deleted message display" }));
    fireEvent.click(screen.getByRole("option", { name: "Audit-style detail" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    const arg = updatePreferences.mock.calls[0][0] as {
      chatDisplay: typeof DEFAULT_CHAT_DISPLAY_PREFERENCES;
    };
    expect(arg.chatDisplay.deletedMessageDisplay).toBe("audit");
    expect(arg.chatDisplay.showClearMsg).toBe(true);
    expect(arg.chatDisplay.messageLimit).toBe(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit);
  });

  it("uses picture buttons for moderation highlight style and writes the selected style", async () => {
    renderWithProviders(<ChatSettingsSection only={["events"]} />);

    const compactButton = screen.getByRole("button", { name: /compact/i });
    const framedButton = screen.getByRole("button", { name: /framed/i });
    expect(compactButton).toHaveAttribute("aria-pressed", "true");
    expect(compactButton.className).toContain("shadow-[inset_0_0_0_1px");
    expect(framedButton.className).toContain("hover:border-[#a1a1aa]");
    expect(screen.getByText("Selected")).toBeInTheDocument();

    fireEvent.click(framedButton);

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    const arg = updatePreferences.mock.calls[0][0] as {
      chatDisplay: typeof DEFAULT_CHAT_DISPLAY_PREFERENCES;
    };
    expect(arg.chatDisplay.moderationHighlightStyle).toBe("cozy");
    expect(arg.chatDisplay.deletedMessageDisplay).toBe(
      DEFAULT_CHAT_DISPLAY_PREFERENCES.deletedMessageDisplay
    );
    expect(arg.chatDisplay.messageLimit).toBe(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit);
  });

  it("uses the requested recent messages slider range", () => {
    setStore({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, recentMessagesOnJoin: true },
      chat: { ...DEFAULT_CHAT_PREFERENCES },
    });
    renderWithProviders(<ChatSettingsSection only={["events"]} />);

    const recentMessagesLimit = screen.getByLabelText("Recent messages to load");
    expect(recentMessagesLimit).toHaveAttribute("min", "100");
    expect(recentMessagesLimit).toHaveAttribute("max", "800");
    expect(recentMessagesLimit).toHaveAttribute("step", "100");
  });

  it("shows defaults and resets message sliders to their defaults", async () => {
    setStore({
      chatDisplay: {
        ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        messageLimit: 800,
        recentMessagesLimit: 300,
        recentMessagesOnJoin: true,
      },
      chat: { ...DEFAULT_CHAT_PREFERENCES },
    });
    renderWithProviders(<ChatSettingsSection only={["events"]} />);

    expect(screen.getByText("Default: 600")).toBeInTheDocument();
    expect(screen.getByText("Default: 200")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset Message limit to default" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    expect(updatePreferences.mock.calls[0][0]).toMatchObject({
      chatDisplay: { messageLimit: DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit },
    });

    updatePreferences.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Recent messages to load to default" })
    );

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    expect(updatePreferences.mock.calls[0][0]).toMatchObject({
      chatDisplay: { recentMessagesLimit: DEFAULT_CHAT_DISPLAY_PREFERENCES.recentMessagesLimit },
    });
  });

  it("renders visible tick dots for large message sliders", () => {
    setStore({
      chatDisplay: {
        ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        messageLimit: 600,
        recentMessagesLimit: 220,
        recentMessagesOnJoin: true,
      },
      chat: { ...DEFAULT_CHAT_PREFERENCES },
    });
    renderWithProviders(<ChatSettingsSection only={["events"]} />);

    const messageSlider = screen.getByLabelText("Message limit");
    const recentSlider = screen.getByLabelText("Recent messages to load");
    const messageTicks = messageSlider.closest(".relative")?.querySelectorAll("[data-slider-tick]");
    const recentTicks = recentSlider.closest(".relative")?.querySelectorAll("[data-slider-tick]");
    const tickValues = (ticks?: NodeListOf<Element>) =>
      Array.from(ticks ?? []).map((tick) => tick.getAttribute("data-slider-tick-value"));

    expect(tickValues(messageTicks)).toEqual([
      "100",
      "200",
      "300",
      "400",
      "500",
      "600",
      "700",
      "800",
      "900",
      "1000",
    ]);
    expect(messageTicks?.[0]).toHaveAttribute("data-slider-tick-percent", "0");
    expect(messageTicks?.[0]).toHaveAttribute("data-slider-tick-active", "true");
    expect(messageTicks?.[9]).toHaveAttribute("data-slider-tick-percent", "100");
    expect(messageTicks?.[9]).toHaveAttribute("data-slider-tick-active", "false");
    expect(tickValues(recentTicks)).toEqual([
      "100",
      "200",
      "300",
      "400",
      "500",
      "600",
      "700",
      "800",
    ]);
    expect(recentTicks?.[0]).toHaveAttribute("data-slider-tick-percent", "0");
    expect(recentTicks?.[0]).toHaveAttribute("data-slider-tick-active", "true");
    expect(recentTicks?.[7]).toHaveAttribute("data-slider-tick-percent", "100");
    expect(recentTicks?.[7]).toHaveAttribute("data-slider-tick-active", "false");

    fireEvent.change(messageSlider, { target: { value: "800" } });

    expect(
      messageSlider.closest(".relative")?.querySelectorAll('[data-slider-tick-active="true"]')
    ).toHaveLength(8);
  });

  it("snaps old recent-message values onto the slider step grid", () => {
    setStore({
      chatDisplay: {
        ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        recentMessagesOnJoin: true,
        recentMessagesLimit: 101,
      },
      chat: { ...DEFAULT_CHAT_PREFERENCES },
    });
    renderWithProviders(<ChatSettingsSection only={["events"]} />);

    expect(screen.getByLabelText("Recent messages to load")).toHaveValue("100");
  });

  it('"Hide chat panel" writes chat.position (not chatDisplay)', async () => {
    renderWithProviders(<ChatSettingsSection only={["behavior"]} />);

    const row = screen.getByText("Hide chat panel").closest("div")!.parentElement!.parentElement!;
    fireEvent.click(row.querySelector('[role="switch"]')!);

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    const arg = updatePreferences.mock.calls[0][0] as {
      chat: typeof DEFAULT_CHAT_PREFERENCES;
    };
    expect(arg.chat.position).toBe("hidden");
    // Sibling chat fields preserved.
    expect(arg.chat.size).toBe(DEFAULT_CHAT_PREFERENCES.size);
  });

  it('"Ask for Twitch pin duration" writes chatDisplay with the spread preserved', async () => {
    renderWithProviders(<ChatSettingsSection only={["behavior"]} />);

    const row = screen.getByText("Ask for Twitch pin duration").closest("div")!.parentElement!
      .parentElement!;
    fireEvent.click(row.querySelector('[role="switch"]')!);

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    const arg = updatePreferences.mock.calls[0][0] as {
      chatDisplay: typeof DEFAULT_CHAT_DISPLAY_PREFERENCES;
    };
    expect(arg.chatDisplay.showTwitchPinDurationDialog).toBe(false);
    expect(arg.chatDisplay.messageLimit).toBe(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit);
  });
});
