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
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, boldUsernames: false, fontSizePx: 13 },
      chat: { ...DEFAULT_CHAT_PREFERENCES },
    });
  });

  it("toggling a switch writes chatDisplay with the spread preserved", async () => {
    renderWithProviders(<ChatSettingsSection only={["appearance"]} />);

    // Traverse to the outer SettingRow div (label <p> → inner text div → left
    // container → outer flex row), where the Switch lives in the right slot.
    const row = screen.getByText("Bold usernames").closest("div")!.parentElement!.parentElement!;
    fireEvent.click(row.querySelector('[role="switch"]')!);

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    const arg = updatePreferences.mock.calls[0][0] as {
      chatDisplay: typeof DEFAULT_CHAT_DISPLAY_PREFERENCES;
    };
    // Flipped field…
    expect(arg.chatDisplay.boldUsernames).toBe(true);
    // …siblings intact (spread preserved).
    expect(arg.chatDisplay.fontSizePx).toBe(13);
    expect(arg.chatDisplay.emoteSizePx).toBe(DEFAULT_CHAT_DISPLAY_PREFERENCES.emoteSizePx);
    expect(arg.chatDisplay.messageLimit).toBe(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit);
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

  it('"Hide chat panel" writes chat.position (not chatDisplay)', async () => {
    renderWithProviders(<ChatSettingsSection only={["behavior"]} />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    const arg = updatePreferences.mock.calls[0][0] as {
      chat: typeof DEFAULT_CHAT_PREFERENCES;
    };
    expect(arg.chat.position).toBe("hidden");
    // Sibling chat fields preserved.
    expect(arg.chat.size).toBe(DEFAULT_CHAT_PREFERENCES.size);
  });
});
