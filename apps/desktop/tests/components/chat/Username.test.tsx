import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Username } from "@/components/chat/Username";
import { type ChatDisplayPreferences, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

// Drive Username's chatDisplay-derived behavior by seeding the auth store.
// Mirrors the PredictionBanner test's preferences-merge idiom.
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
  // Reset to default prefs before each render so chatDisplay branching is
  // predictable and no prior test's overrides leak in (mirrors PredictionBanner).
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
    } as typeof s.preferences,
  }));
});

describe("Username", () => {
  it("renders the displayName", () => {
    render(<Username userId="1" username="ninja" displayName="Ninja" platform="twitch" />);
    expect(screen.getByText("Ninja")).toBeInTheDocument();
  });

  it("uses provided color via inline style", () => {
    // themeAdaptUsernameColor would lift a too-dark color; #ff0000 is bright
    // enough (luminance above the floor) so it passes through unchanged.
    render(
      <Username userId="1" username="ninja" displayName="Ninja" color="#ff0000" platform="twitch" />
    );
    expect(screen.getByText("Ninja")).toHaveStyle({ color: "rgb(255, 0, 0)" });
  });

  it("falls back to twitch purple when no color and readable-color is off", () => {
    setChatDisplay({ readableColorForUncolored: false });
    render(<Username userId="1" username="ninja" displayName="Ninja" platform="twitch" />);
    expect(screen.getByText("Ninja")).toHaveStyle({ color: "rgb(145, 70, 255)" });
  });

  it("falls back to kick green when no color and readable-color is off", () => {
    setChatDisplay({ readableColorForUncolored: false });
    render(<Username userId="1" username="xqc" displayName="xQc" platform="kick" />);
    expect(screen.getByText("xQc")).toHaveStyle({ color: "rgb(83, 252, 24)" });
  });

  it("fires onClick handler", () => {
    const onClick = vi.fn();
    render(
      <Username
        userId="1"
        username="ninja"
        displayName="Ninja"
        platform="twitch"
        onClick={onClick}
      />
    );
    fireEvent.click(screen.getByText("Ninja"));
    expect(onClick).toHaveBeenCalled();
  });

  it("keeps Twitch-style username hover separate from the message row hover", () => {
    render(<Username userId="1" username="ninja" displayName="Ninja" platform="twitch" />);
    const displayName = screen.getByText("Ninja");
    const usernameButton = screen.getByRole("button", { name: "Ninja" });
    const usernameContainer = usernameButton.parentElement;

    expect(usernameContainer?.className).toContain("chat-line__username-container--hoverable");
    expect(usernameContainer?.className).toContain("inline-block");
    expect(usernameContainer?.className).toContain("rounded-[4px]");
    expect(usernameContainer?.className).toContain("-mx-0.5");
    expect(usernameContainer?.className).toContain("px-0.5");
    expect(usernameContainer?.className).toContain("hover:bg-[rgba(255,255,255,0.16)]");
    expect(usernameContainer?.className).toContain("active:bg-[rgba(255,255,255,0.16)]");
    expect(usernameContainer?.className).toContain("focus-within:bg-[rgba(255,255,255,0.16)]");
    expect(usernameButton.className).toContain("chat-line__username");
    expect(usernameButton.className).toContain("cursor-pointer");
    expect(usernameButton.className).toContain("hover:no-underline");
    expect(usernameButton.className).not.toContain("hover:underline");
    expect(displayName.className).toContain("chat-author__display-name");
    expect(displayName).toHaveAttribute("data-a-target", "chat-message-username");
    expect(displayName).toHaveAttribute("data-a-user", "ninja");
  });
});

describe("Username chatDisplay (U2)", () => {
  it("assigns a deterministic readable color to an uncolored user", () => {
    // readableColorForUncolored defaults true.
    render(<Username userId="1" username="ninja" displayName="Ninja" platform="twitch" />);
    const el = screen.getByText("Ninja");
    // Not the platform default purple — a derived color instead.
    expect(el).not.toHaveStyle({ color: "rgb(145, 70, 255)" });
    expect(el.style.color).not.toBe("");
  });

  it("produces the same color across renders for the same username", () => {
    const { unmount } = render(
      <Username userId="1" username="determinist" displayName="Determinist" platform="twitch" />
    );
    const first = screen.getByText("Determinist").style.color;
    unmount();
    render(
      <Username userId="1" username="determinist" displayName="Determinist" platform="twitch" />
    );
    const second = screen.getByText("Determinist").style.color;
    expect(second).toBe(first);
    expect(first).not.toBe("");
  });

  it("gives different usernames different deterministic colors", () => {
    const { unmount } = render(
      <Username userId="1" username="alpha" displayName="Alpha" platform="twitch" />
    );
    const a = screen.getByText("Alpha").style.color;
    unmount();
    render(<Username userId="2" username="omega-zzz" displayName="Omega" platform="twitch" />);
    const b = screen.getByText("Omega").style.color;
    expect(a).not.toBe(b);
  });

  it("applies font-bold when boldUsernames is true", () => {
    setChatDisplay({ boldUsernames: true });
    render(<Username userId="1" username="ninja" displayName="Ninja" platform="twitch" />);
    expect(screen.getByText("Ninja").className).toContain("font-bold");
  });

  it("keeps font-bold when boldUsernames is false", () => {
    setChatDisplay({ boldUsernames: false });
    render(<Username userId="1" username="ninja" displayName="Ninja" platform="twitch" />);
    expect(screen.getByText("Ninja").className).toContain("font-bold");
  });

  it("keeps Kick usernames bold when boldUsernames is false", () => {
    setChatDisplay({ boldUsernames: false });
    render(<Username userId="1" username="xqc" displayName="xQc" platform="kick" />);
    expect(screen.getByText("xQc").className).toContain("font-bold");
  });

  it("lifts a too-dark chosen color when themeAdaptUsernameColor is on", () => {
    setChatDisplay({ themeAdaptUsernameColor: true });
    // #000080 (navy) is below the dark-theme luminance floor -> lifted toward white.
    render(
      <Username userId="1" username="ninja" displayName="Ninja" color="#000080" platform="twitch" />
    );
    expect(screen.getByText("Ninja")).not.toHaveStyle({ color: "rgb(0, 0, 128)" });
  });

  it("leaves a too-dark chosen color untouched when themeAdaptUsernameColor is off", () => {
    setChatDisplay({ themeAdaptUsernameColor: false });
    render(
      <Username userId="1" username="ninja" displayName="Ninja" color="#000080" platform="twitch" />
    );
    expect(screen.getByText("Ninja")).toHaveStyle({ color: "rgb(0, 0, 128)" });
  });
});
