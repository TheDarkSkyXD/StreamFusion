import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast }));

import { FollowButton } from "@/components/ui/follow-button";
import { queryClient } from "@/providers/query-provider";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";

import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../test-utils";

const channel = fixtures.channel({
  id: "141981764",
  platform: "twitch",
  username: "Example_Channel",
  displayName: "Example Channel",
  avatarUrl: "https://static.example/stale.png",
});

// Guards: authenticated Twitch clicks use the account-write bridge, publish only
// confirmed Twitch rows, and keep Twitch's authoritative display metadata.
describe("FollowButton authenticated Twitch account write", () => {
  beforeEach(() => {
    toast.mockReset();
    queryClient.clear();
    useAuthStore.setState({ twitchConnected: true });
    useFollowStore.setState({
      isHydrated: true,
      localFollows: [],
      pendingAccountActions: [],
      sourceByKey: new Map(),
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    useAuthStore.setState({ twitchConnected: false });
    useFollowStore.setState({
      isHydrated: false,
      localFollows: [],
      pendingAccountActions: [],
      sourceByKey: new Map(),
    });
  });

  it("follows through Twitch and applies only the confirmed authoritative row", async () => {
    const api = installElectronAPIMock();
    api.follows.writeAccount = vi.fn().mockResolvedValue({
      status: "confirmed",
      activeFollows: [
        {
          id: "twitch:141981764",
          platform: "twitch",
          channelId: "141981764",
          channelName: "example_channel",
          displayName: "Authoritative Name",
          profileImage: "https://static.example/authoritative.png",
          followedAt: "2026-08-03T12:00:00.000Z",
          source: "twitch",
        },
      ],
    });

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    await userEvent.click(screen.getByRole("button", { name: "Follow" }));

    expect(api.follows.writeAccount).toHaveBeenCalledWith({
      action: "follow",
      follow: {
        platform: "twitch",
        channelId: "141981764",
        channelName: "Example_Channel",
        displayName: "Example Channel",
        profileImage: "https://static.example/stale.png",
      },
    });
    await waitFor(() => {
      expect(useFollowStore.getState().localFollows).toEqual([
        expect.objectContaining({
          id: "141981764",
          username: "example_channel",
          displayName: "Authoritative Name",
          avatarUrl: "https://static.example/authoritative.png",
        }),
      ]);
      expect(useFollowStore.getState().getFollowSource(channel)).toBe("twitch");
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it("unfollows through Twitch and removes state only after confirmation", async () => {
    const api = installElectronAPIMock();
    api.follows.writeAccount = vi.fn().mockResolvedValue({
      status: "confirmed",
      activeFollows: [],
    });
    useFollowStore.setState({
      localFollows: [channel],
      sourceByKey: new Map([["twitch:141981764", "twitch"]]),
    });

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    await userEvent.click(screen.getByRole("button", { name: "Unfollow" }));

    expect(api.follows.writeAccount).toHaveBeenCalledWith({
      action: "unfollow",
      follow: {
        platform: "twitch",
        channelId: "141981764",
        channelName: "Example_Channel",
        displayName: "Example Channel",
        profileImage: "https://static.example/stale.png",
      },
    });
    await waitFor(() => {
      expect(useFollowStore.getState().isFollowing(channel)).toBe(false);
      expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
    });
    expect(api.follows.remove).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("keeps confirmed state unchanged and explains a transient Twitch failure", async () => {
    const api = installElectronAPIMock();
    api.follows.writeAccount = vi
      .fn()
      .mockRejectedValue(new Error("Twitch could not confirm the follow change. Try again."));
    api.follows.getAll = vi.fn().mockResolvedValue([]);

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    await userEvent.click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() => {
      expect(useFollowStore.getState().isFollowing(channel)).toBe(false);
      expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
      expect(toast).toHaveBeenCalledWith("Twitch couldn't confirm the follow change", {
        description: "Your Twitch follow is unchanged. Try again.",
      });
    });
    expect(api.follows.add).not.toHaveBeenCalled();
  });

  it("explains when Twitch follow authorization must be reconnected", async () => {
    const api = installElectronAPIMock();
    api.follows.writeAccount = vi
      .fn()
      .mockRejectedValue(new Error("Reconnect Twitch follow access, then try again."));
    api.follows.getAll = vi.fn().mockResolvedValue([]);

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    await userEvent.click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() => {
      expect(useFollowStore.getState().isFollowing(channel)).toBe(false);
      expect(toast).toHaveBeenCalledWith("Reconnect Twitch follow access", {
        description: "Reconnect Twitch follow access, then try again.",
      });
    });
    expect(api.follows.add).not.toHaveBeenCalled();
  });

  it("keeps signed-out Twitch follows local and separate from account writes", async () => {
    const api = installElectronAPIMock();
    useAuthStore.setState({ twitchConnected: false });
    api.follows.add = vi.fn().mockResolvedValue({
      id: "guest:twitch:141981764",
      platform: "twitch",
      channelId: "141981764",
      channelName: "Example_Channel",
      displayName: "Example Channel",
      profileImage: "https://static.example/stale.png",
      followedAt: "2026-08-03T12:00:00.000Z",
      source: "guest",
    });
    api.follows.writeAccount = vi.fn();

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    await userEvent.click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() => {
      expect(useFollowStore.getState().isFollowing(channel)).toBe(true);
      expect(useFollowStore.getState().getFollowSource(channel)).toBe("guest");
    });
    expect(api.follows.add).toHaveBeenCalledOnce();
    expect(api.follows.writeAccount).not.toHaveBeenCalled();
  });

  it("hydrates an authoritative Twitch account row after a renderer refresh", async () => {
    const api = installElectronAPIMock();
    api.follows.getAll = vi.fn().mockResolvedValue([
      {
        id: "twitch:141981764",
        platform: "twitch",
        channelId: "141981764",
        channelName: "example_channel",
        displayName: "Authoritative Name",
        profileImage: "https://static.example/authoritative.png",
        followedAt: "2026-08-03T12:00:00.000Z",
        source: "twitch",
      },
    ]);
    api.follows.getAccountWrites = vi.fn().mockResolvedValue([]);
    useFollowStore.setState({
      isHydrated: false,
      localFollows: [],
      pendingAccountActions: [],
      sourceByKey: new Map(),
    });

    await act(async () => {
      await useFollowStore.getState().hydrate();
    });
    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    expect(useFollowStore.getState().getFollowSource(channel)).toBe("twitch");
    expect(useFollowStore.getState().localFollows).toEqual([
      expect.objectContaining({
        displayName: "Authoritative Name",
        avatarUrl: "https://static.example/authoritative.png",
      }),
    ]);
    expect(screen.getByRole("button", { name: "Unfollow" })).toBeInTheDocument();
  });
});
