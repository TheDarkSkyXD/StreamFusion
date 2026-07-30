import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserProfileHeader } from "@/components/chat/mod/UserPopout/UserProfileHeader";
import { TooltipProvider } from "@/components/ui/tooltip";

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
    <TooltipProvider>
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

  it("renders absolute dates with a relative-age tooltip on keyboard focus", async () => {
    renderHeader({ state: "failed", message: "Unavailable" });
    const date = screen.getByText("May 6, 2012");
    expect(date.tagName).toBe("TIME");
    fireEvent.focus(date);
    expect((await screen.findAllByText(/years ago|months ago|days ago/)).length).toBeGreaterThan(0);
  });

  it("renders stale reconnect-required follow state as retryable unavailable", () => {
    const retry = vi.fn();
    render(
      <TooltipProvider>
        <UserProfileHeader
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
        />
      </TooltipProvider>
    );
    expect(screen.queryByText("Reconnect Twitch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unavailable · Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
