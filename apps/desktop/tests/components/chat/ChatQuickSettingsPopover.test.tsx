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

vi.mock("@/store/auth-store", () => {
  // useChatDisplay reads `preferences?.chatDisplay` reactively AND pulls the
  // freshest value imperatively via getState() inside the writer, so both the
  // selector and getState resolve from the mutable holder.
  const buildState = () => ({
    preferences: { chatDisplay: mockChatDisplay.value },
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

describe("ChatQuickSettingsPopover", () => {
  beforeEach(() => {
    installElectronAPIMock();
    navigateMock.mockReset();
    updatePreferencesMock.mockReset();
    mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES };
  });

  it("renders the root menu (Chat appearance entry + More settings)", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /chat appearance/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more settings/i })).toBeInTheDocument();
  });

  it("drills into the Chat appearance sub-view to show the quick subset", () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    expect(screen.getByLabelText("Font size")).toBeInTheDocument();
    expect(screen.getByLabelText("Emote size")).toBeInTheDocument();
    expect(screen.getByText("Density")).toBeInTheDocument();
    expect(screen.getByText("Show timestamps")).toBeInTheDocument();
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
      fireEvent.change(fontRange, { target: { value: "18" } });
    });
    expect(updatePreferencesMock).toHaveBeenCalledTimes(1);
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, fontSizePx: 18 },
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
