import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FollowSource } from "@/shared/auth-types";

import { fixtures, renderWithProviders, screen } from "../../test-utils";

const toggleFollow = vi.fn();
const openExternal = vi.fn();
const toastFn = vi.fn();
let mockIsFollowing = false;
let mockFollowSource: FollowSource | null = null;
let mockKickConnected = false;
let mockTwitchConnected = false;

vi.mock("@/store/follow-store", () => ({
  useFollowStore: () => ({
    isFollowing: () => mockIsFollowing,
    toggleFollow,
    getFollowSource: () => (mockIsFollowing ? mockFollowSource : null),
  }),
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (
    selector: (state: { kickConnected: boolean; twitchConnected: boolean }) => unknown
  ) => selector({ kickConnected: mockKickConnected, twitchConnected: mockTwitchConnected }),
}));

vi.mock("@/hooks/useElectron", () => ({
  useOpenExternal: () => openExternal,
}));

vi.mock("sonner", () => ({
  toast: (...args: unknown[]) => toastFn(...args),
}));

import { FollowButton } from "@/components/ui/follow-button";

describe("FollowButton", () => {
  // Guards: signed-in Kick follow clicks must use the account-write store route instead of creating a local fake follow or opening Kick.
  // Guards: authenticated follow help text must describe whether StreamFusion or the platform website performs the action.
  beforeEach(() => {
    toggleFollow.mockReset();
    openExternal.mockReset();
    toastFn.mockReset();
    mockIsFollowing = false;
    mockFollowSource = null;
    mockKickConnected = false;
    mockTwitchConnected = false;
  });

  it('renders "Follow" label when not following', () => {
    renderWithProviders(<FollowButton channel={fixtures.channel({ platform: "twitch" })} />);
    expect(screen.getByText("Follow")).toBeInTheDocument();
  });

  it("calls toggleFollow when clicked and stops event propagation", () => {
    const onParentClick = vi.fn();
    renderWithProviders(
      // biome-ignore lint/a11y/useKeyWithClickEvents: test
      <div onClick={onParentClick}>
        <FollowButton channel={fixtures.channel({ platform: "kick" })} />
      </div>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(toggleFollow).toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("renders icon-only when already following", () => {
    mockIsFollowing = true;
    mockFollowSource = "guest";
    renderWithProviders(<FollowButton channel={fixtures.channel({ platform: "twitch" })} />);
    expect(screen.queryByText("Follow")).not.toBeInTheDocument();
  });

  it("toggles locally on a guest-source row", () => {
    mockIsFollowing = true;
    mockFollowSource = "guest";
    renderWithProviders(<FollowButton channel={fixtures.channel({ platform: "twitch" })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(toggleFollow).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("routes a Twitch-source row through the StreamFusion account write path", () => {
    mockIsFollowing = true;
    mockFollowSource = "twitch";
    renderWithProviders(
      <FollowButton channel={fixtures.channel({ platform: "twitch", username: "xQc" })} />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(toggleFollow).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "twitch", username: "xQc" }),
      undefined
    );
    expect(toastFn).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("routes a Kick-source row through the StreamFusion follow store", () => {
    mockIsFollowing = true;
    mockFollowSource = "kick";
    renderWithProviders(
      <FollowButton channel={fixtures.channel({ platform: "kick", username: "Summit1G" })} />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(toggleFollow).toHaveBeenCalledTimes(1);
    expect(toastFn).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("routes signed-in Kick follow clicks through the account-write store option", () => {
    mockKickConnected = true;
    renderWithProviders(
      <FollowButton channel={fixtures.channel({ platform: "kick", username: "Summit1G" })} />
    );

    const button = screen.getByRole("button", { name: "Follow" });
    expect(button).toHaveAttribute("title", "Follow with your Kick account");
    fireEvent.click(button);

    expect(toggleFollow).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "kick", username: "Summit1G" }),
      { accountPlatform: "kick" }
    );
    expect(toastFn).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("routes signed-in Twitch follow clicks through the account-write store option", () => {
    mockTwitchConnected = true;
    renderWithProviders(
      <FollowButton channel={fixtures.channel({ platform: "twitch", username: "xQc" })} />
    );

    const button = screen.getByRole("button", { name: "Follow" });
    expect(button).toHaveAttribute("title", "Follow with your Twitch account");
    fireEvent.click(button);

    expect(toggleFollow).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "twitch", username: "xQc" }),
      { accountPlatform: "twitch" }
    );
    expect(toastFn).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("still toggles locally on a guest-source Kick row (regression guard for AE4)", () => {
    mockIsFollowing = true;
    mockFollowSource = "guest";
    renderWithProviders(<FollowButton channel={fixtures.channel({ platform: "kick" })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(toggleFollow).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
    expect(toastFn).not.toHaveBeenCalled();
  });
});
