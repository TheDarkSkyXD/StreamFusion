// Guards: the Chat settings controls must write chatDisplay (and the
// hide-panel toggle, the chat group) through updatePreferences with the
// spread preserved — a partial write that drops sibling fields would reset
// unrelated chat preferences. Also guards the no-stored-prefs path falling
// back to DEFAULT_CHAT_DISPLAY_PREFERENCES (older installs).
// Guards: each supported third-party cosmetic has a clear live setting without stale rollout copy.
// Guards: all eight Xtra timestamp formats remain selectable and persist without dropping siblings.
// Guards: each visual settings group exposes one inert offline preview that reflects its current preferences.
// Guards: full-settings preview rows use the same density padding as live chat, without a second parent gap.
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

  it("offers and persists all eight timestamp formats", async () => {
    renderWithProviders(<ChatSettingsSection only={["appearance"]} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Timestamp format" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "24-hour · 9:05",
      "24-hour · 09:05",
      "24-hour · 9:05:07",
      "24-hour · 09:05:07",
      "12-hour · 9:05 AM",
      "12-hour · 09:05 AM",
      "12-hour · 9:05:07 AM",
      "12-hour · 09:05:07 AM",
    ]);

    fireEvent.click(screen.getByRole("option", { name: "12-hour · 09:05:07 AM" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    const arg = updatePreferences.mock.calls[0][0] as {
      chatDisplay: typeof DEFAULT_CHAT_DISPLAY_PREFERENCES;
    };
    expect(arg.chatDisplay.timestampFormat).toBe("hh:mm:ss a");
    expect(arg.chatDisplay.timestamps).toBe(false);
    expect(arg.chatDisplay.fontSizePx).toBe(13);
  });

  it("exposes and persists Tight, Medium, and Loose message density", async () => {
    renderWithProviders(<ChatSettingsSection only={["appearance"]} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Density" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Tight",
      "Medium",
      "Loose",
    ]);

    fireEvent.click(screen.getByRole("option", { name: "Loose" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    expect(updatePreferences.mock.calls[0][0]).toMatchObject({
      chatDisplay: { density: "loose" },
    });

  });

  it.each([
    ["compact", "py-0"],
    ["cozy", "py-1"],
    ["loose", "py-3"],
  ] as const)(
    "uses %s live-row padding without a parent density gap",
    (density, rowPaddingClass) => {
      setStore({
        chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, density },
        chat: { ...DEFAULT_CHAT_PREFERENCES },
      });
      renderWithProviders(<ChatSettingsSection only={["appearance"]} />);

      const preview = screen.getByTestId("appearance-chat-preview");
      const densityPreview = preview.querySelector(`[data-density='${density}']`)!;
      const rows = Array.from(densityPreview.children);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toHaveClass(rowPaddingClass);
      }
      expect(densityPreview.className).not.toMatch(/space-y-/);
    }
  );

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

  it("renders selective accessible previews for visual groups and none for behavior", () => {
    setStore({
      chatDisplay: {
        ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        timestamps: true,
        timestampFormat: "hh:mm:ss a",
        fontSizePx: 18,
        emoteSizePx: 32,
        density: "compact",
        enable7tvUsernamePaints: true,
        deletedMessageDisplay: "audit",
        moderationHighlightStyle: "cozy",
      },
      chat: { ...DEFAULT_CHAT_PREFERENCES },
    });
    renderWithProviders(<ChatSettingsSection />);

    const appearance = screen.getByTestId("appearance-chat-preview");
    const emotes = screen.getByTestId("emotes-chat-preview");
    const events = screen.getByTestId("events-chat-preview");

    for (const preview of [appearance, emotes, events]) {
      expect(preview).not.toHaveAttribute("aria-hidden");
      expect(preview.querySelector("input, select")).toBeNull();
    }
    expect(appearance.querySelector("[data-preview-tooltip-trigger]")).toBeNull();
    expect(appearance.querySelector("[data-density='compact']")).toHaveStyle({ fontSize: "18px" });
    expect(appearance).toHaveTextContent("09:05:07 PM");
    expect(appearance.querySelector("[data-preview-adapted-color='true']")).toHaveStyle({
      color: "#9a90a5",
    });
    expect(
      (emotes.querySelector("[data-preview-painted='true']") as HTMLElement).style.backgroundImage
    ).toContain("linear-gradient");
    expect(events.querySelector("[data-deleted-mode='audit']")).toHaveTextContent("Mod removed");
    expect(document.querySelector("[data-testid='behavior-chat-preview']")).toBeNull();
  });

  it("names only the useful preview tooltip triggers and explains them on focus", async () => {
    renderWithProviders(<ChatSettingsSection only={["emotes"]} />);

    expect(screen.getByRole("img", { name: "7TV badge preview" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "BetterTTV badge preview" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "FrankerFaceZ badge preview" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "7TV username paint preview" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Overlay emote preview" })).not.toHaveLength(0);
    expect(screen.queryByRole("img", { name: /timestamp|font size|emote size/i })).toBeNull();
    for (const trigger of document.querySelectorAll("[data-preview-tooltip-trigger]")) {
      expect(trigger.className).not.toContain("cursor-help");
      expect(trigger.className).not.toContain("cursor-pointer");
    }

    fireEvent.focus(screen.getByRole("img", { name: "7TV username paint preview" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "7TV username paint. Controlled by the 7TV username paints setting."
    );
  });

  it("explains deleted-message styling on hover", async () => {
    renderWithProviders(<ChatSettingsSection only={["events"]} />);

    const trigger = screen.getByRole("img", { name: "Deleted message preview" });
    fireEvent.pointerMove(trigger);
    fireEvent.mouseEnter(trigger);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Controlled by Deleted message display and Moderation highlight style."
    );
  });

  it("keeps cosmetic previews offline and maps each provider switch independently", () => {
    setStore({
      chatDisplay: {
        ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        enable7tv: false,
        enableBttv: true,
        enableFfz: false,
        enable7tvUsernamePaints: false,
        systemMessageEmotes: false,
      },
      chat: { ...DEFAULT_CHAT_PREFERENCES },
    });
    renderWithProviders(<ChatSettingsSection only={["emotes"]} />);

    const preview = screen.getByTestId("emotes-chat-preview");
    expect(screen.queryByTestId("appearance-chat-preview")).toBeNull();
    expect(screen.queryByTestId("events-chat-preview")).toBeNull();
    expect(preview.querySelector("[data-preview-provider='7tv']")).toBeNull();
    expect(preview.querySelector("[data-preview-provider='bttv']")).not.toBeNull();
    expect(preview.querySelector("[data-preview-provider='ffz']")).toBeNull();
    expect(preview.querySelector("[data-preview-painted='false']")).not.toBeNull();
    expect(preview).not.toHaveTextContent("System emotes are enabled");
  });

  it("presents independent live settings for third-party chat badges and 7TV paints", () => {
    renderWithProviders(<ChatSettingsSection only={["emotes"]} />);

    expect(screen.getByText("7TV chat badges")).toBeInTheDocument();
    expect(
      screen.getByText("Show 7TV profile badges next to Twitch usernames.")
    ).toBeInTheDocument();
    expect(screen.getByText("7TV username paints")).toBeInTheDocument();
    expect(
      screen.getByText("Use 7TV gradients, image textures, and shadows on Twitch usernames.")
    ).toBeInTheDocument();
    expect(screen.getByText("BetterTTV chat badges")).toBeInTheDocument();
    expect(
      screen.getByText("Show BetterTTV profile badges next to Twitch usernames.")
    ).toBeInTheDocument();
    expect(screen.getByText("FrankerFaceZ chat badges")).toBeInTheDocument();
    expect(
      screen.getByText("Show FFZ global badges and channel-specific moderator or VIP artwork.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/in-message rendering is upcoming/i)).toBeNull();
  });

  it("persists each cosmetic switch immediately without dropping chatDisplay siblings", async () => {
    renderWithProviders(<ChatSettingsSection only={["emotes"]} />);

    const switches = [
      ["7TV chat badges", "enable7tvBadges"],
      ["7TV username paints", "enable7tvUsernamePaints"],
      ["BetterTTV chat badges", "enableBttvBadges"],
      ["FrankerFaceZ chat badges", "enableFfzBadges"],
    ] as const;

    for (const [label] of switches) {
      const row = screen.getByText(label).closest("div")!.parentElement!.parentElement!;
      fireEvent.click(row.querySelector('[role="switch"]')!);
    }

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(4));
    switches.forEach(([, field], index) => {
      const update = updatePreferences.mock.calls[index][0] as {
        chatDisplay: typeof DEFAULT_CHAT_DISPLAY_PREFERENCES;
      };
      expect(update.chatDisplay[field]).toBe(false);
      expect(update.chatDisplay.enable7tv).toBe(true);
      expect(update.chatDisplay.messageLimit).toBe(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit);
    });
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
