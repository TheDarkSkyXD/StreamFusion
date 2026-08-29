import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserPopout } from "@/features/chat/components/chat/mod/UserPopout/UserPopout";
import type { ProfileFieldState } from "@shared/user-profile-types";

import { installElectronAPIMock, renderWithProviders } from "../../../../test-utils";

// Guards: profile fields that resolve after the dialog opens update visibly without moving focus from an existing date control.
describe("UserPopout focus stability", () => {
  it("keeps focus on an existing date while a later profile field becomes visible", async () => {
    const api = installElectronAPIMock();
    let resolveFollow: (value: ProfileFieldState<string>) => void = () => undefined;
    const followResponse = new Promise<ProfileFieldState<string>>((resolve) => {
      resolveFollow = resolve;
    });

    api.userProfiles.getTwitchIdentity = vi.fn(async () => ({
      state: "known" as const,
      source: "official" as const,
      value: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "",
      },
    }));
    api.userProfiles.getTwitchAccountCreated = vi.fn(async () => ({
      state: "known" as const,
      source: "first-party-fallback" as const,
      value: "2020-01-01T00:00:00Z",
    }));
    api.userProfiles.getTwitchFollow = vi.fn(() => followResponse);
    api.userProfiles.resolveTwitchChannel = vi.fn(async () => ({
      state: "known" as const,
      source: "official" as const,
      value: { id: "u1", username: "alice", displayName: "Alice" },
    }));

    renderWithProviders(
      <UserPopout
        userId="u1"
        username="alice"
        platform="twitch"
        channelId="c1"
        channelSlug="streamer"
        open
        onOpenChange={() => undefined}
      />
    );

    const accountDate = await screen.findByText("Jan 1, 2020");
    await act(async () => {
      accountDate.focus();
    });
    expect(accountDate).toHaveFocus();

    await act(async () => {
      resolveFollow({
        state: "known",
        source: "official",
        value: "2021-02-03T00:00:00Z",
      });
    });

    expect(await screen.findByText("Feb 3, 2021")).toBeVisible();
    expect(accountDate).toHaveFocus();
  });
});
