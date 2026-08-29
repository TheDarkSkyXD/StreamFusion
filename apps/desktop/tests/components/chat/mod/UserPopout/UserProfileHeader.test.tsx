import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { UserProfileHeader } from "@/features/chat/components/chat/mod/UserPopout/UserProfileHeader";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AccountCreatedFieldState } from "@shared/user-profile-types";

const identity = {
  state: "known" as const,
  source: "official" as const,
  value: {
    userId: "u1",
    username: "alice",
    displayName: "Alice",
    avatarUrl: "",
  },
};
const accountCreated = {
  state: "known" as const,
  source: "first-party-fallback" as const,
  value: "2012-05-06T00:00:00Z",
};
const customAvatarUrl =
  "https://static-cdn.jtvnw.net/jtv_user_pictures/alice-profile_image-0123456789abcdef-300x300.jpeg";

function renderHeader(
  follow:
    | { state: "reconnect-required"; missingScopes: string[] }
    | { state: "failed"; message: string },
  retryFollow = vi.fn(),
  headerIdentity = identity
) {
  render(
    <TooltipProvider delayDuration={0}>
      <UserProfileHeader
        fallbackUsername="alice"
        identity={headerIdentity}
        accountCreated={accountCreated}
        follow={follow}
        retryIdentity={vi.fn()}
        retryAccountCreated={vi.fn()}
        retryFollow={retryFollow}
      />
    </TooltipProvider>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("UserProfileHeader field states", () => {
  it("shows badge tooltips only while pointer-hovered and keeps source context accessible", async () => {
    const badges = Array.from({ length: 6 }, (_, index) => ({
      setId: `badge-${index}`,
      version: "1",
      imageUrl: `https://example.com/badge-${index}.png`,
      title: `Badge ${index}`,
    }));
    render(
      <TooltipProvider delayDuration={0}>
        <UserProfileHeader
          platform="twitch"
          fallbackUsername="alice"
          identity={identity}
          accountCreated={accountCreated}
          follow={{ state: "failed", message: "Unavailable" }}
          badges={{ state: "known", badges }}
          retryIdentity={vi.fn()}
          retryAccountCreated={vi.fn()}
          retryFollow={vi.fn()}
        />
      </TooltipProvider>
    );

    expect(screen.getByText("Badges")).toBeInTheDocument();
    const badgeButtons = screen.getAllByRole("img", {
      name: /^Badge \d\./,
    });
    expect(badgeButtons).toHaveLength(6);
    expect(badgeButtons[0]).toHaveAccessibleName("Badge 0. Source: Twitch · Live chat");

    fireEvent.focus(badgeButtons[0]);
    await act(async () => {});
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(badgeButtons[0]);
    await act(async () => {});
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.pointerEnter(badgeButtons[0], { pointerType: "mouse" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Badge 0 · Twitch · Live chat");

    fireEvent.pointerLeave(badgeButtons[0], { pointerType: "mouse" });
    await act(async () => {});
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("routes a known custom Twitch avatar through the image proxy contract", () => {
    renderHeader({ state: "failed", message: "Unavailable" }, vi.fn(), {
      ...identity,
      value: { ...identity.value, avatarUrl: customAvatarUrl },
    });

    expect(screen.getByRole("img", { name: "Alice avatar" })).toHaveAttribute(
      "src",
      expect.stringMatching(/^twitch-image:\/\/image\?u=/)
    );
  });

  it("exposes an accessible fallback after a known avatar exhausts proxy retries", async () => {
    vi.useFakeTimers();
    renderHeader({ state: "failed", message: "Unavailable" }, vi.fn(), {
      ...identity,
      value: { ...identity.value, avatarUrl: customAvatarUrl },
    });
    const avatar = screen.getByRole("img", { name: "Alice avatar" });

    fireEvent.error(avatar);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    fireEvent.error(avatar);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    fireEvent.error(avatar);

    expect(screen.getByRole("img", { name: "Alice avatar unavailable" })).toBeInTheDocument();
    expect(screen.getByText("May 6, 2012")).toBeInTheDocument();
  });

  it("shows relative-age tooltips only while pointer-hovered and keeps both dates accessible", async () => {
    renderHeader({ state: "failed", message: "Unavailable" });
    const date = screen.getByText("May 6, 2012");
    expect(date.tagName).toBe("TIME");

    fireEvent.focus(date);
    await act(async () => {});
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(date);
    await act(async () => {});
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    expect(date).toHaveAccessibleName(/May 6, 2012\. \d+ years ago/);

    fireEvent.pointerEnter(date, { pointerType: "mouse" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /years ago|months ago|days ago|Today/
    );

    fireEvent.pointerLeave(date, { pointerType: "mouse" });
    await act(async () => {});
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.pointerEnter(date, { pointerType: "mouse" });
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerCancel(date, { pointerType: "mouse" });
    await act(async () => {});
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders reconnect-required follow state distinctly from unavailable and failed", () => {
    const retry = vi.fn();
    render(
      <TooltipProvider>
        <UserProfileHeader
          platform="kick"
          fallbackUsername="alice"
          identity={identity}
          accountCreated={accountCreated}
          follow={{
            state: "reconnect-required",
            missingScopes: ["moderator:read:followers"],
          }}
          retryIdentity={vi.fn()}
          retryAccountCreated={vi.fn()}
          retryFollow={retry}
          reconnect={retry}
        />
      </TooltipProvider>
    );
    const reconnect = screen.getByRole("button", { name: "Reconnect Kick · Retry" });
    expect(reconnect).toHaveAttribute("data-profile-state", "reconnect-required");
    fireEvent.click(reconnect);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("excludes negative account-created states from the component contract", () => {
    type NegativeAccountCreatedState = Extract<AccountCreatedFieldState, { state: "negative" }>;

    expectTypeOf<NegativeAccountCreatedState>().toEqualTypeOf<never>();
  });
});
