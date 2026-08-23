import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast }));

import { FollowButton } from "@/components/ui/follow-button";
import { CHANNEL_KEYS } from "@/hooks/queries/useChannels";
import { FOLLOWED_CONTENT_KEYS } from "@/hooks/queries/useFollowedContent";
import { STREAM_KEYS } from "@/hooks/queries/useStreams";
import { queryClient } from "@/providers/query-provider";
import type { KickAccountFollowWriteChangedEvent } from "@/shared/auth-types";
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
  id: "kick-channel-7",
  kickUserId: "411439",
  platform: "kick",
  username: "Summit1G",
  displayName: "Summit1G",
});
const identityEquivalentChannel = fixtures.channel({
  id: "411439",
  platform: "kick",
  username: "summit1g",
  displayName: "SUMMIT1G",
});

// Guards: an authenticated confirmed Kick follow must unfollow through StreamFusion and remove the authoritative row from every directly-backed followed-channel surface.
// Guards: failed Kick account writes must restore the exact confirmed row even when fallback hydration fails and must surface user-facing error copy.
// Guards: account-write pending state must be shared by channel identity so duplicate controls stay honest and cannot submit twice.
// Guards: backend-pending Kick writes remain visibly pending after IPC resolves until a transition event confirms authoritative state.
// Guards: a terminal Kick write failure clears shared busy state once without altering confirmed follows or caches, and leaves retry available.
// Guards: an auth-paused Kick write clears shared busy state without falling back locally and asks for reconnection once.
// Guards: duplicate auth-paused result and event delivery produces one reconnect message regardless of delivery order.
// Guards: persisted authenticated Kick writes hydrate after renderer restart into shared, deduplicated pending controls.
// Guards: a Kick account channel can be followed again after authoritative unfollow through the same confirmed write source without creating a stale duplicate.
// Guards: authoritative Kick confirmation must merge with renderer follow state created while the account write was in flight.
// Guards: a hydrated legacy Kick row keeps its account source when the current channel resolves to a newer stable id.
describe("FollowButton authenticated Kick account write", () => {
  beforeEach(() => {
    toast.mockReset();
    queryClient.clear();
    useAuthStore.setState({ kickConnected: true });
    useFollowStore.setState({
      isHydrated: true,
      localFollows: [channel],
      pendingAccountActions: [],
      sourceByKey: new Map([["kick:kick-channel-7", "kick"]]),
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    useAuthStore.setState({ kickConnected: false });
    useFollowStore.setState({
      isHydrated: false,
      localFollows: [],
      pendingAccountActions: [],
      sourceByKey: new Map(),
    });
  });

  it("unfollows a confirmed Kick channel and applies the authoritative followed list", async () => {
    const api = installElectronAPIMock();
    api.follows.writeAccount = vi.fn().mockResolvedValue({
      status: "confirmed",
      activeFollows: [],
    });
    queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), [channel]);

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    await userEvent.click(screen.getByRole("button", { name: "Unfollow" }));

    expect(api.follows.writeAccount).toHaveBeenCalledTimes(1);
    expect(api.follows.writeAccount).toHaveBeenCalledWith({
      action: "unfollow",
      follow: {
        platform: "kick",
        channelId: "411439",
        channelName: "Summit1G",
        displayName: "Summit1G",
        profileImage: "https://example.com/avatar.png",
      },
    });
    await waitFor(() => {
      expect(useFollowStore.getState().isFollowing(channel)).toBe(false);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([]);
    });
  });

  it("keeps a legacy-id hydrated Kick follow account-managed on the canonical channel", async () => {
    const api = installElectronAPIMock();
    const legacyChannel = fixtures.channel({
      id: "legacy-kick-channel-7",
      platform: "kick",
      username: "summit1g",
      displayName: "Summit1G",
    });
    api.follows.writeAccount = vi.fn().mockResolvedValue({
      status: "confirmed",
      activeFollows: [],
    });
    api.follows.remove = vi.fn();
    useFollowStore.setState({
      localFollows: [legacyChannel],
      sourceByKey: new Map([["kick:legacy-kick-channel-7", "kick"]]),
    });

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    expect(screen.getByText("Unfollow")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Unfollow" }));

    expect(api.follows.writeAccount).toHaveBeenCalledTimes(1);
    expect(api.follows.remove).not.toHaveBeenCalled();
  });

  it("preserves an unrelated renderer follow added while Kick unfollow is in flight", async () => {
    const api = installElectronAPIMock();
    const twitchChannel = fixtures.channel({
      id: "twitch-friend",
      platform: "twitch",
      username: "ConcurrentFriend",
      displayName: "Concurrent Friend",
    });
    const kickStream = fixtures.stream({
      id: "kick-target-live",
      platform: "kick",
      channelId: "kick-channel-7",
      channelName: "Summit1G",
    });
    const twitchStream = fixtures.stream({
      id: "twitch-friend-live",
      platform: "twitch",
      channelId: "twitch-friend",
      channelName: "ConcurrentFriend",
    });
    let confirmWrite!: (result: { status: "confirmed"; activeFollows: [] }) => void;
    api.follows.writeAccount = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        confirmWrite = resolve;
      })
    );
    api.follows.add = vi.fn().mockResolvedValue({ source: "guest" });
    queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), [channel]);
    queryClient.setQueryData(STREAM_KEYS.followed("kick"), [kickStream]);

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    await userEvent.click(screen.getByRole("button", { name: "Unfollow" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unfollowing..." })).toBeDisabled();
      expect(api.follows.writeAccount).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await useFollowStore.getState().followChannel(twitchChannel);
    });
    queryClient.setQueryData(CHANNEL_KEYS.followed("twitch"), [twitchChannel]);
    queryClient.setQueryData(STREAM_KEYS.followed("twitch"), [twitchStream]);
    queryClient.setQueryData(STREAM_KEYS.followed(), [kickStream, twitchStream]);

    expect(useFollowStore.getState().localFollows).toEqual([channel, twitchChannel]);
    expect(useFollowStore.getState().getFollowSource(twitchChannel)).toBe("guest");

    act(() => {
      confirmWrite({ status: "confirmed", activeFollows: [] });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
      expect(useFollowStore.getState().localFollows).toEqual([twitchChannel]);
      expect(useFollowStore.getState().getFollowSource(twitchChannel)).toBe("guest");
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed("kick"))).toEqual([]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed())).toEqual([twitchStream]);
    });
    expect(queryClient.getQueryData(CHANNEL_KEYS.followed("twitch"))).toEqual([twitchChannel]);
    expect(queryClient.getQueryData(STREAM_KEYS.followed("twitch"))).toEqual([twitchStream]);
  });

  it("evicts an unfollowed Kick identity from every followed cache without disturbing other creators", async () => {
    const api = installElectronAPIMock();
    const unrelatedKickChannel = fixtures.channel({
      id: "kick-channel-99",
      kickUserId: "999",
      platform: "kick",
      username: "OfflineFriend",
      displayName: "Offline Friend",
      isLive: false,
    });
    const unrelatedKickFollow = {
      id: "kick-follow-99",
      platform: "kick" as const,
      channelId: "999",
      channelName: "offlinefriend",
      displayName: "Offline Friend",
      profileImage: unrelatedKickChannel.avatarUrl,
      followedAt: "2026-08-03T00:00:00.000Z",
      source: "kick" as const,
      isLive: false,
    };
    const targetKickStream = fixtures.stream({
      id: "kick-target-live",
      platform: "kick",
      channelId: "kick-public-channel-7",
      channelName: "SUMMIT1G",
      channelDisplayName: "Summit1G",
    });
    const unrelatedKickStream = fixtures.stream({
      id: "kick-unrelated-live",
      platform: "kick",
      channelId: "kick-public-channel-99",
      channelName: "OFFLINEFRIEND",
      channelDisplayName: "Offline Friend",
    });
    const sameSlugTwitchStream = fixtures.stream({
      id: "twitch-same-slug-live",
      platform: "twitch",
      channelId: "twitch-user-7",
      channelName: "summit1g",
      channelDisplayName: "Summit1G on Twitch",
    });
    const sameSlugTwitchChannel = fixtures.channel({
      id: "twitch-user-7",
      platform: "twitch",
      username: "summit1g",
      displayName: "Summit1G on Twitch",
    });

    api.follows.writeAccount = vi.fn().mockResolvedValue({
      status: "confirmed",
      activeFollows: [unrelatedKickFollow],
    });
    useFollowStore.setState({
      localFollows: [channel, unrelatedKickChannel],
      sourceByKey: new Map([
        ["kick:kick-channel-7", "kick"],
        ["kick:kick-channel-99", "kick"],
      ]),
    });
    queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), [
      channel,
      identityEquivalentChannel,
      unrelatedKickChannel,
    ]);
    queryClient.setQueryData(CHANNEL_KEYS.followed("twitch"), [sameSlugTwitchChannel]);
    queryClient.setQueryData(STREAM_KEYS.followed("kick"), [
      targetKickStream,
      unrelatedKickStream,
    ]);
    queryClient.setQueryData(STREAM_KEYS.followed("twitch"), [sameSlugTwitchStream]);
    queryClient.setQueryData(STREAM_KEYS.followed(), [
      targetKickStream,
      sameSlugTwitchStream,
      unrelatedKickStream,
    ]);
    queryClient.setQueryData(FOLLOWED_CONTENT_KEYS.all, { seeded: true });

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    await userEvent.click(screen.getByRole("button", { name: "Unfollow" }));

    const canonicalUnrelatedChannel = {
      id: "999",
      platform: "kick",
      username: "offlinefriend",
      displayName: "Offline Friend",
      avatarUrl: unrelatedKickChannel.avatarUrl,
      bannerUrl: "",
      bio: "",
      isLive: false,
      isVerified: false,
      isPartner: false,
    };
    await waitFor(() => {
      expect(useFollowStore.getState().localFollows).toEqual([canonicalUnrelatedChannel]);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([
        canonicalUnrelatedChannel,
      ]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed("kick"))).toEqual([
        unrelatedKickStream,
      ]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed())).toEqual([
        sameSlugTwitchStream,
        unrelatedKickStream,
      ]);
    });

    expect(queryClient.getQueryData(CHANNEL_KEYS.followed("twitch"))).toEqual([
      sameSlugTwitchChannel,
    ]);
    expect(queryClient.getQueryData(STREAM_KEYS.followed("twitch"))).toEqual([
      sameSlugTwitchStream,
    ]);
    expect(queryClient.getQueryState(CHANNEL_KEYS.followed("kick"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(STREAM_KEYS.followed("kick"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(STREAM_KEYS.followed())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(FOLLOWED_CONTENT_KEYS.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(STREAM_KEYS.followed("twitch"))?.isInvalidated).toBe(false);
  });

  it("restores the exact confirmed follow when the write and fallback hydrate fail", async () => {
    const api = installElectronAPIMock();
    api.follows.writeAccount = vi.fn().mockRejectedValue(new Error("Kick write unavailable"));
    api.follows.getAll = vi.fn().mockRejectedValue(new Error("Follow reload unavailable"));
    queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), [channel]);

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    await userEvent.click(screen.getByRole("button", { name: "Unfollow" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unfollow" })).toBeInTheDocument();
      expect(useFollowStore.getState().localFollows).toEqual([channel]);
      expect(useFollowStore.getState().sourceByKey).toEqual(
        new Map([["kick:kick-channel-7", "kick"]])
      );
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([channel]);
      expect(toast).toHaveBeenCalledWith("Couldn't update follow", {
        description: "Your follow list was restored. Try Summit1G again.",
      });
    });
    expect(api.follows.getAll).toHaveBeenCalledTimes(1);
  });

  it("shares honest pending state across identity-equivalent controls and deduplicates the write", async () => {
    const api = installElectronAPIMock();
    let confirmWrite!: (result: { status: "confirmed"; activeFollows: [] }) => void;
    api.follows.writeAccount = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        confirmWrite = resolve;
      })
    );
    queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), [channel]);

    renderWithProviders(
      <>
        <FollowButton channel={channel} />
        <FollowButton channel={identityEquivalentChannel} />
      </>,
      { queryClient }
    );

    const unfollowButtons = screen.getAllByRole("button", { name: "Unfollow" });
    await userEvent.click(unfollowButtons[0]);

    await waitFor(() => {
      const pendingButtons = screen.getAllByRole("button", { name: "Unfollowing..." });
      expect(pendingButtons).toHaveLength(2);
      for (const button of pendingButtons) {
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("aria-busy", "true");
      }
      expect(api.follows.writeAccount).toHaveBeenCalledTimes(1);
      expect(useFollowStore.getState().localFollows).toEqual([channel]);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([channel]);
    });

    await userEvent.click(screen.getAllByRole("button", { name: "Unfollowing..." })[1]);
    expect(api.follows.writeAccount).toHaveBeenCalledTimes(1);

    confirmWrite({ status: "confirmed", activeFollows: [] });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Follow" })).toHaveLength(2);
      expect(useFollowStore.getState().localFollows).toEqual([]);
    });
  });

  it("keeps an unfollow pending after IPC resolves until the backend confirms it", async () => {
    const api = installElectronAPIMock();
    const confirmedRow = {
      id: "kick-confirmed-original",
      platform: "kick" as const,
      channelId: "411439",
      channelName: "summit1g",
      displayName: "Summit1G",
      profileImage: channel.avatarUrl,
      followedAt: "2026-08-03T00:00:00.000Z",
      source: "kick" as const,
    };
    const cachedStream = fixtures.stream({
      id: "kick-summit-live",
      platform: "kick",
      channelId: "kick-public-channel-7",
      channelName: "SUMMIT1G",
      channelDisplayName: "Summit1G",
    });
    let emitAccountWriteChanged!: (event: {
      status: "confirmed";
      action: "unfollow";
      target: { platform: "kick"; channelId: string; channelName: string };
      activeFollows: [];
    }) => void;
    api.follows.onAccountWriteChanged = vi.fn((callback) => {
      emitAccountWriteChanged = callback;
      return vi.fn();
    });
    api.follows.writeAccount = vi.fn().mockResolvedValue({
      status: "pending",
      activeFollows: [confirmedRow],
    });
    queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), [channel]);
    queryClient.setQueryData(STREAM_KEYS.followed("kick"), [cachedStream]);
    queryClient.setQueryData(STREAM_KEYS.followed(), [cachedStream]);

    renderWithProviders(
      <>
        <FollowButton channel={channel} />
        <FollowButton channel={identityEquivalentChannel} />
      </>,
      { queryClient }
    );

    await userEvent.click(screen.getAllByRole("button", { name: "Unfollow" })[0]);

    await waitFor(() => {
      const pendingButtons = screen.getAllByRole("button", { name: "Unfollowing..." });
      expect(pendingButtons).toHaveLength(2);
      for (const button of pendingButtons) {
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("aria-busy", "true");
      }
      expect(api.follows.writeAccount).toHaveBeenCalledTimes(1);
      expect(useFollowStore.getState().localFollows).toEqual([channel]);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([channel]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed("kick"))).toEqual([cachedStream]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed())).toEqual([cachedStream]);
    });

    await userEvent.click(screen.getAllByRole("button", { name: "Unfollowing..." })[1]);
    expect(api.follows.writeAccount).toHaveBeenCalledTimes(1);

    act(() => {
      emitAccountWriteChanged({
        status: "confirmed",
        action: "unfollow",
        target: {
          platform: "kick",
          channelId: "411439",
          channelName: "summit1g",
        },
        activeFollows: [],
      });
    });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Follow" })).toHaveLength(2);
      expect(useFollowStore.getState().localFollows).toEqual([]);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed("kick"))).toEqual([]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed())).toEqual([]);
    });
    expect(api.follows.onAccountWriteChanged).toHaveBeenCalledTimes(1);
  });

  it("clears a failed unfollow without changing confirmed state and allows retry", async () => {
    const api = installElectronAPIMock();
    const confirmedRow = {
      id: "kick-confirmed-original",
      platform: "kick" as const,
      channelId: "411439",
      channelName: "summit1g",
      displayName: "Summit1G",
      profileImage: channel.avatarUrl,
      followedAt: "2026-08-03T00:00:00.000Z",
      source: "kick" as const,
    };
    const cachedStream = fixtures.stream({
      id: "kick-summit-live",
      platform: "kick",
      channelId: "kick-public-channel-7",
      channelName: "SUMMIT1G",
      channelDisplayName: "Summit1G",
    });
    let emitAccountWriteChanged!: (event: KickAccountFollowWriteChangedEvent) => void;
    api.follows.onAccountWriteChanged = vi.fn((callback) => {
      emitAccountWriteChanged = callback;
      return vi.fn();
    });
    api.follows.writeAccount = vi.fn().mockResolvedValue({
      status: "pending",
      activeFollows: [confirmedRow],
    });
    queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), [channel]);
    queryClient.setQueryData(STREAM_KEYS.followed("kick"), [cachedStream]);
    queryClient.setQueryData(STREAM_KEYS.followed(), [cachedStream]);

    renderWithProviders(
      <>
        <FollowButton channel={channel} />
        <FollowButton channel={identityEquivalentChannel} />
      </>,
      { queryClient }
    );

    await userEvent.click(screen.getAllByRole("button", { name: "Unfollow" })[0]);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Unfollowing..." })).toHaveLength(2);
    });

    act(() => {
      emitAccountWriteChanged({
        status: "failed",
        action: "unfollow",
        target: {
          platform: "kick",
          channelId: "legacy-kick-id",
          channelName: "SUMMIT1G",
        },
        activeFollows: [confirmedRow],
        reason: "retry-expired",
      });
    });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Unfollow" })).toHaveLength(2);
      expect(useFollowStore.getState().localFollows).toEqual([channel]);
      expect(useFollowStore.getState().pendingAccountActions).toEqual([]);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([channel]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed("kick"))).toEqual([cachedStream]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed())).toEqual([cachedStream]);
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith("Couldn't update follow", {
        description: "Kick couldn't confirm the unfollow. Your follow is unchanged. Try again.",
      });
    });

    await userEvent.click(screen.getAllByRole("button", { name: "Unfollow" })[1]);
    await waitFor(() => {
      expect(api.follows.writeAccount).toHaveBeenCalledTimes(2);
      expect(screen.getAllByRole("button", { name: "Unfollowing..." })).toHaveLength(2);
    });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("clears an auth-paused unfollow across equivalent controls and asks to reconnect once", async () => {
    const api = installElectronAPIMock();
    const confirmedRow = {
      id: "kick-confirmed-original",
      platform: "kick" as const,
      channelId: "411439",
      channelName: "summit1g",
      displayName: "Summit1G",
      profileImage: channel.avatarUrl,
      followedAt: "2026-08-03T00:00:00.000Z",
      source: "kick" as const,
    };
    const cachedStream = fixtures.stream({
      id: "kick-summit-live",
      platform: "kick",
      channelId: "kick-public-channel-7",
      channelName: "SUMMIT1G",
      channelDisplayName: "Summit1G",
    });
    let emitAccountWriteChanged!: (event: KickAccountFollowWriteChangedEvent) => void;
    api.follows.onAccountWriteChanged = vi.fn((callback) => {
      emitAccountWriteChanged = callback;
      return vi.fn();
    });
    api.follows.writeAccount = vi.fn().mockResolvedValue({
      status: "pending",
      activeFollows: [confirmedRow],
    });
    api.follows.add = vi.fn();
    api.follows.remove = vi.fn();
    queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), [channel]);
    queryClient.setQueryData(STREAM_KEYS.followed("kick"), [cachedStream]);
    queryClient.setQueryData(STREAM_KEYS.followed(), [cachedStream]);

    renderWithProviders(
      <>
        <FollowButton channel={channel} />
        <FollowButton channel={identityEquivalentChannel} />
      </>,
      { queryClient }
    );

    await userEvent.click(screen.getAllByRole("button", { name: "Unfollow" })[0]);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Unfollowing..." })).toHaveLength(2);
    });

    act(() => {
      emitAccountWriteChanged({
        status: "auth-paused",
        action: "unfollow",
        target: {
          platform: "kick",
          channelId: "legacy-kick-id",
          channelName: "SUMMIT1G",
        },
        activeFollows: [confirmedRow],
        reason: "auth-failed",
      });
    });

    await waitFor(() => {
      const readyButtons = screen.getAllByRole("button", { name: "Unfollow" });
      expect(readyButtons).toHaveLength(2);
      for (const button of readyButtons) {
        expect(button).not.toBeDisabled();
        expect(button).toHaveAttribute("aria-busy", "false");
      }
      expect(useFollowStore.getState().pendingAccountActions).toEqual([]);
      expect(useFollowStore.getState().localFollows).toEqual([channel]);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([channel]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed("kick"))).toEqual([cachedStream]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed())).toEqual([cachedStream]);
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith("Reconnect Kick to continue", {
        description:
          "Kick authentication expired before the unfollow could be confirmed. Your follow is unchanged.",
      });
    });
    expect(api.follows.writeAccount).toHaveBeenCalledTimes(1);
    expect(api.follows.add).not.toHaveBeenCalled();
    expect(api.follows.remove).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalledWith("Couldn't update follow", expect.anything());
  });

  it("deduplicates auth-paused result and event feedback regardless of delivery order", async () => {
    const confirmedRow = {
      id: "kick-confirmed-original",
      platform: "kick" as const,
      channelId: "411439",
      channelName: "summit1g",
      displayName: "Summit1G",
      profileImage: channel.avatarUrl,
      followedAt: "2026-08-03T00:00:00.000Z",
      source: "kick" as const,
    };
    const cachedStream = fixtures.stream({
      id: "kick-summit-live",
      platform: "kick",
      channelId: "kick-public-channel-7",
      channelName: "SUMMIT1G",
      channelDisplayName: "Summit1G",
    });
    const event: KickAccountFollowWriteChangedEvent = {
      status: "auth-paused",
      action: "unfollow",
      target: {
        platform: "kick",
        channelId: "legacy-kick-id",
        channelName: "SUMMIT1G",
      },
      activeFollows: [confirmedRow],
      reason: "auth-failed",
    };
    const toastCallsByOrder: unknown[][][] = [];

    for (const order of ["event-before-result", "result-before-event"] as const) {
      cleanup();
      toast.mockReset();
      queryClient.clear();
      useFollowStore.setState({
        isHydrated: true,
        localFollows: [channel],
        pendingAccountActions: [],
        sourceByKey: new Map([["kick:kick-channel-7", "kick"]]),
      });

      const api = installElectronAPIMock();
      let emitAccountWriteChanged!: (writeEvent: KickAccountFollowWriteChangedEvent) => void;
      let resolveWrite!: (result: {
        status: "auth-paused";
        activeFollows: [typeof confirmedRow];
      }) => void;
      api.follows.onAccountWriteChanged = vi.fn((callback) => {
        emitAccountWriteChanged = callback;
        return vi.fn();
      });
      api.follows.writeAccount = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveWrite = resolve;
        }),
      );
      api.follows.add = vi.fn();
      api.follows.remove = vi.fn();
      queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), [channel]);
      queryClient.setQueryData(STREAM_KEYS.followed("kick"), [cachedStream]);
      queryClient.setQueryData(STREAM_KEYS.followed(), [cachedStream]);
      queryClient.setQueryData(FOLLOWED_CONTENT_KEYS.all, [channel]);

      renderWithProviders(
        <>
          <FollowButton channel={channel} />
          <FollowButton channel={identityEquivalentChannel} />
        </>,
        { queryClient },
      );

      await userEvent.click(screen.getAllByRole("button", { name: "Unfollow" })[0]);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Unfollowing..." })).toHaveLength(2);
      });

      if (order === "event-before-result") {
        act(() => {
          emitAccountWriteChanged(event);
          resolveWrite({ status: "auth-paused", activeFollows: [confirmedRow] });
        });
      } else {
        act(() => {
          resolveWrite({ status: "auth-paused", activeFollows: [confirmedRow] });
        });
        await waitFor(() => {
          expect(useFollowStore.getState().pendingAccountActions).toEqual([]);
        });
        act(() => emitAccountWriteChanged(event));
      }

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Unfollow" })).toHaveLength(2);
        expect(useFollowStore.getState().pendingAccountActions).toEqual([]);
      });
      expect(api.follows.writeAccount).toHaveBeenCalledTimes(1);
      expect(api.follows.add).not.toHaveBeenCalled();
      expect(api.follows.remove).not.toHaveBeenCalled();
      expect(useFollowStore.getState().localFollows).toEqual([channel]);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([channel]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed("kick"))).toEqual([cachedStream]);
      expect(queryClient.getQueryData(STREAM_KEYS.followed())).toEqual([cachedStream]);
      expect(queryClient.getQueryData(FOLLOWED_CONTENT_KEYS.all)).toEqual([channel]);
      toastCallsByOrder.push(toast.mock.calls.map((call) => [...call]));
    }

    expect(toastCallsByOrder).toEqual(
      ["event-before-result", "result-before-event"].map(() => [
        [
          "Reconnect Kick to continue",
          {
            description:
              "Kick authentication expired before the unfollow could be confirmed. Your follow is unchanged.",
          },
        ],
      ]),
    );
  });

  it("hydrates a persisted unfollow into both identity-equivalent controls after restart", async () => {
    const api = installElectronAPIMock();
    const authPausedChannel = fixtures.channel({
      id: "paused-channel-id",
      platform: "kick",
      username: "needs-reconnect",
      displayName: "Needs Reconnect",
    });
    const confirmedRow = {
      id: "kick-confirmed-original",
      platform: "kick" as const,
      channelId: "411439",
      channelName: "summit1g",
      displayName: "Summit1G",
      profileImage: channel.avatarUrl,
      followedAt: "2026-08-03T00:00:00.000Z",
      source: "kick" as const,
    };
    api.follows.getAll = vi.fn().mockResolvedValue([confirmedRow]);
    api.follows.getAccountWrites = vi.fn().mockResolvedValue([
      {
        status: "pending",
        action: "unfollow",
        target: {
          platform: "kick",
          channelId: "legacy-kick-id",
          channelName: "SUMMIT1G",
        },
        attemptedAt: "2026-08-03T00:00:00.000Z",
        nextAttemptAt: "2026-08-03T00:00:01.000Z",
        expiresAt: "2026-08-03T00:10:00.000Z",
        attemptCount: 1,
        lastError: "not-confirmed",
      },
      {
        status: "auth-paused",
        action: "follow",
        target: {
          platform: "kick",
          channelId: "paused-channel-id",
          channelName: "needs-reconnect",
        },
        attemptedAt: "2026-08-03T00:00:00.000Z",
        nextAttemptAt: "2026-08-03T00:00:01.000Z",
        expiresAt: "2026-08-03T00:10:00.000Z",
        attemptCount: 1,
        lastError: "auth-failed",
      },
    ]);
    api.follows.writeAccount = vi.fn();
    api.follows.onAccountWriteChanged = vi.fn(() => vi.fn());
    useFollowStore.setState({
      isHydrated: false,
      localFollows: [],
      pendingAccountActions: [],
      sourceByKey: new Map(),
    });

    await act(async () => {
      await useFollowStore.getState().hydrate();
    });

    renderWithProviders(
      <>
        <FollowButton channel={channel} />
        <FollowButton channel={identityEquivalentChannel} />
        <FollowButton channel={authPausedChannel} />
      </>,
      { queryClient }
    );

    const pendingButtons = screen.getAllByRole("button", { name: "Unfollowing..." });
    expect(pendingButtons).toHaveLength(2);
    for (const button of pendingButtons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
    }
    const authPausedButton = screen.getByRole("button", { name: "Follow" });
    expect(authPausedButton).not.toBeDisabled();
    expect(authPausedButton).toHaveAttribute("aria-busy", "false");
    await userEvent.click(pendingButtons[1]);

    expect(api.follows.getAll).toHaveBeenCalledTimes(1);
    expect(api.follows.getAccountWrites).toHaveBeenCalledTimes(1);
    expect(api.follows.onAccountWriteChanged).toHaveBeenCalledTimes(1);
    expect(api.follows.writeAccount).not.toHaveBeenCalled();
    expect(useFollowStore.getState().localFollows).toHaveLength(1);
    expect(useFollowStore.getState().pendingAccountActions).toHaveLength(1);
  });

  it("follows again through the authoritative Kick account write after unfollow", async () => {
    const api = installElectronAPIMock();
    const confirmedRow = {
      id: "kick-confirmed-new",
      platform: "kick" as const,
      channelId: "411439",
      channelName: "summit1g",
      displayName: "Summit1G account",
      profileImage: "account.webp",
      followedAt: "2026-08-03T00:00:00.000Z",
      source: "kick" as const,
    };
    let confirmFollow!: (result: {
      status: "confirmed";
      activeFollows: [typeof confirmedRow];
    }) => void;
    api.follows.writeAccount = vi
      .fn()
      .mockResolvedValueOnce({ status: "confirmed", activeFollows: [] })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          confirmFollow = resolve;
        })
      );
    api.follows.add = vi.fn();
    api.openExternal = vi.fn();
    queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), [channel]);

    renderWithProviders(<FollowButton channel={channel} />, { queryClient });

    await userEvent.click(screen.getByRole("button", { name: "Unfollow" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
      expect(useFollowStore.getState().localFollows).toEqual([]);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([]);
    });

    vi.mocked(api.follows.writeAccount).mockClear();
    toast.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() => {
      const pendingButton = screen.getByRole("button", { name: "Following..." });
      expect(pendingButton).toBeDisabled();
      expect(pendingButton).toHaveAttribute("aria-busy", "true");
      expect(api.follows.writeAccount).toHaveBeenCalledTimes(1);
      expect(api.follows.writeAccount).toHaveBeenCalledWith({
        action: "follow",
        follow: {
          platform: "kick",
          channelId: "411439",
          channelName: "Summit1G",
          displayName: "Summit1G",
          profileImage: "https://example.com/avatar.png",
        },
      });
      expect(api.follows.add).not.toHaveBeenCalled();
      expect(api.openExternal).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
      expect(useFollowStore.getState().localFollows).toEqual([]);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([]);
    });

    confirmFollow({ status: "confirmed", activeFollows: [confirmedRow] });

    const canonicalChannel = {
      id: "411439",
      platform: "kick",
      username: "summit1g",
      displayName: "Summit1G account",
      avatarUrl: "account.webp",
      bannerUrl: "",
      bio: "",
      isLive: false,
      isVerified: false,
      isPartner: false,
    };
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unfollow" })).toBeInTheDocument();
      expect(useFollowStore.getState().localFollows).toEqual([canonicalChannel]);
      expect(queryClient.getQueryData(CHANNEL_KEYS.followed("kick"))).toEqual([
        canonicalChannel,
      ]);
    });
  });
});
