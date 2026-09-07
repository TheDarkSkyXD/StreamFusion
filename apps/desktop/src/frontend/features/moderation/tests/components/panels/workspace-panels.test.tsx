import { act, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../../../../tests/test-utils";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import type { WorkspacePanelsPort } from "../../../capabilities/workspace-panels";
import type { ModerationFeedEvent } from "@shared/moderation-types";
import { ActivityFeedPanel } from "../../../components/panels/ActivityFeedPanel";
import { SuspiciousActivityPanel } from "../../../components/panels/SuspiciousActivityPanel";
import { WhispersPanel } from "../../../components/panels/WhispersPanel";
import { CommunityPanel } from "../../../components/panels/CommunityPanel";
import { RewardRequestsPanel } from "../../../components/panels/RewardRequestsPanel";
import { ChannelSwitcher } from "../../../components/panels/ChannelSwitcher";
import { PanelDecision } from "../../../components/panels/PanelDecision";
import { appendWorkspaceEvent, workspaceFeedPlan } from "../../../domain/workspace-feed";
vi.mock("@tanstack/react-router", async () => {
  const { routerMock } = await import("../../../../../../../tests/test-utils");
  return routerMock();
});

const dependency = vi.hoisted(() => ({ port: null as WorkspacePanelsPort | null }));
vi.mock("../../../composition/workspace-panels", () => ({
  getWorkspacePanelsPort: () => dependency.port,
}));
const account = {
  id: "100",
  login: "owner",
  displayName: "Owner",
  profileImageUrl: "",
  createdAt: "2026-01-01",
  broadcasterType: "" as const,
};
const props = { channelId: "100", channelName: "owner" };
const identity = { id: "300", login: "viewer", displayName: "Viewer" };
const stamp = "2026-09-06T12:00:00.000Z";
function activity(id: string): Extract<ModerationFeedEvent, { kind: "activity" }> {
  return {
    id,
    kind: "activity",
    accountId: "100",
    channelId: "100",
    occurredAt: stamp,
    coverageStartedAt: stamp,
    action: "follow",
    user: identity,
    count: null,
    message: `event-${id}`,
  };
}

describe("Mod View read panels", () => {
  let port: WorkspacePanelsPort;
  let eventListener: Parameters<WorkspacePanelsPort["onEvent"]>[0];
  let stateListener: Parameters<WorkspacePanelsPort["onState"]>[0];
  let eventCleanup: ReturnType<typeof vi.fn<() => void>>;
  let stateCleanup: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(() => {
    useAuthStore.setState({ twitchUser: account });
    eventCleanup = vi.fn();
    stateCleanup = vi.fn();
    port = {
      setSuspiciousStatus: vi.fn<WorkspacePanelsPort["setSuspiciousStatus"]>(async () => ({
        ok: true,
        data: null,
      })),
      decideRedemption: vi.fn<WorkspacePanelsPort["decideRedemption"]>(async () => ({
        ok: true,
        data: null,
      })),
      tokenStatus: vi.fn<WorkspacePanelsPort["tokenStatus"]>(async () => ({
        platform: "twitch",
        connected: true,
        valid: true,
        userId: "100",
        scopes: [
          "moderator:read:followers",
          "moderator:read:suspicious_users",
          "user:read:whispers",
          "moderator:read:chatters",
          "moderation:read",
          "channel:read:redemptions",
        ],
      })),
      startFeed: vi.fn<WorkspacePanelsPort["startFeed"]>(async () => ({ ok: true, data: null })),
      stopFeed: vi.fn<WorkspacePanelsPort["stopFeed"]>(async () => true),
      onEvent: vi.fn<WorkspacePanelsPort["onEvent"]>((callback) => {
        eventListener = callback;
        return eventCleanup;
      }),
      onState: vi.fn<WorkspacePanelsPort["onState"]>((callback) => {
        stateListener = callback;
        return stateCleanup;
      }),
      chatters: vi.fn<WorkspacePanelsPort["chatters"]>(async () => ({
        ok: true,
        data: { items: [identity], cursor: "next", total: 400, observedAt: stamp },
      })),
      activeModerators: vi.fn<WorkspacePanelsPort["activeModerators"]>(async () => ({
        ok: true,
        data: {
          items: [identity],
          cursor: null,
          total: 400,
          observedAt: stamp,
          coverage: "chatters-page",
          rosterComplete: false,
        },
      })),
      rewards: vi.fn<WorkspacePanelsPort["rewards"]>(async () => ({
        ok: true,
        data: { items: [{ id: "r1", title: "Read a poem", cost: 100 }] },
      })),
      redemptions: vi.fn<WorkspacePanelsPort["redemptions"]>(async () => ({
        ok: true,
        data: {
          items: [
            {
              redemptionId: "1",
              rewardId: "r1",
              rewardTitle: "Read a poem",
              cost: 100,
              user: identity,
              input: "A short poem",
              status: "unfulfilled",
              redeemedAt: stamp,
            },
          ],
          cursor: null,
        },
      })),
      moderatedChannels: vi.fn<WorkspacePanelsPort["moderatedChannels"]>(async () => [
        { id: "200", login: "friend", displayName: "Friend" },
      ]),
      followedChannels: vi.fn<WorkspacePanelsPort["followedChannels"]>(async () => [
        { id: "300", login: "viewer", displayName: "Viewer", isLive: true },
      ]),
      openTwitch: vi.fn<WorkspacePanelsPort["openTwitch"]>(async () => undefined),
    };
    dependency.port = port;
  });
  async function feedId() {
    await waitFor(() => expect(port.startFeed).toHaveBeenCalled());
    return vi.mocked(port.startFeed).mock.calls.at(-1)![0].feedId;
  }

  it("bounds received activity, ignores foreign events, and removes listeners on unmount", async () => {
    const mounted = renderWithProviders(<ActivityFeedPanel {...props} />);
    const id = await feedId();
    act(() => {
      stateListener({ feedId: id, state: "connected" });
      for (let index = 0; index < 105; index++)
        eventListener({ feedId: id, payload: activity(String(index)) });
      eventListener({ feedId: id, payload: { ...activity("foreign"), accountId: "200" } });
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(100);
    expect(screen.queryByText("event-0")).not.toBeInTheDocument();
    expect(screen.queryByText("event-foreign")).not.toBeInTheDocument();
    expect(screen.getByText(/Earlier history is unavailable/)).toBeInTheDocument();
    mounted.unmount();
    expect(eventCleanup).toHaveBeenCalledOnce();
    expect(stateCleanup).toHaveBeenCalledOnce();
    expect(port.stopFeed).toHaveBeenCalledWith(id);
  });
  it("stops a delayed start after its panel has already unmounted", async () => {
    let resolveStart: (
      value: Awaited<ReturnType<WorkspacePanelsPort["startFeed"]>>
    ) => void = () => {};
    vi.mocked(port.startFeed).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        })
    );
    const mounted = renderWithProviders(<ActivityFeedPanel {...props} />);
    const id = await feedId();
    mounted.unmount();
    await act(async () => resolveStart({ ok: true, data: null }));
    expect(vi.mocked(port.stopFeed).mock.calls.filter(([value]) => value === id)).toHaveLength(2);
  });
  it("clears account-scoped whispers and ignores the previous listener after switching accounts", async () => {
    renderWithProviders(<WhispersPanel {...props} />);
    const id = await feedId();
    const oldListener = eventListener;
    const whisper: ModerationFeedEvent = {
      id: "w1",
      kind: "whisper",
      accountId: "100",
      channelId: "100",
      occurredAt: stamp,
      coverageStartedAt: stamp,
      from: identity,
      to: { id: "100", login: "owner", displayName: "Owner" },
      message: "Private incoming text",
    };
    act(() => oldListener({ feedId: id, payload: whisper }));
    expect(screen.getByText("Private incoming text")).toBeInTheDocument();
    act(() => useAuthStore.setState({ twitchUser: { ...account, id: "200" } }));
    act(() => oldListener({ feedId: id, payload: whisper }));
    expect(screen.queryByText("Private incoming text")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reconnect Twitch" })).toBeInTheDocument()
    );
    expect(port.startFeed).toHaveBeenCalledTimes(1);
  });
  it("gates suspicious feeds before subscribing and exposes reconnect", async () => {
    vi.mocked(port.tokenStatus).mockResolvedValue({
      platform: "twitch",
      valid: true,
      connected: true,
      userId: "100",
      scopes: [],
    });
    renderWithProviders(<SuspiciousActivityPanel {...props} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reconnect Twitch" })).toBeInTheDocument()
    );
    expect(port.startFeed).not.toHaveBeenCalled();
  });
  it("filters only supported activity types, reports no matches, and restores All", async () => {
    renderWithProviders(<ActivityFeedPanel {...props} />);
    const id = await feedId();
    act(() => {
      stateListener({ feedId: id, state: "connected" });
      eventListener({ feedId: id, payload: activity("follow-1") });
      eventListener({ feedId: id, payload: { ...activity("raid-1"), action: "raid" } });
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter" }), { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "Filter activity type" });
    expect(
      within(menu).queryByRole("menuitemcheckbox", { name: "Subscription" })
    ).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: "Cheer" })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "All" }));
    expect(screen.getByText("No received events match this filter.")).toBeInTheDocument();
    expect(
      screen.queryByText("No events received during this connection.")
    ).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Follow" }));
    expect(screen.getByText("event-follow-1")).toBeInTheDocument();
    expect(screen.queryByText("event-raid-1")).not.toBeInTheDocument();
    act(() => eventListener({ feedId: id, payload: { ...activity("raid-2"), action: "raid" } }));
    expect(screen.queryByText("event-raid-2")).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "All" }));
    expect(screen.getByText("event-raid-1")).toBeInTheDocument();
    expect(screen.getByText("event-raid-2")).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
  it("filters suspicious statuses and resets the selection for a new channel", async () => {
    const mounted = renderWithProviders(<SuspiciousActivityPanel {...props} />);
    const id = await feedId();
    act(() => {
      eventListener({
        feedId: id,
        payload: {
          ...activity("s1"),
          kind: "suspicious-message",
          user: identity,
          status: "active_monitoring",
          message: "Monitoring event",
          messageId: "m1",
        },
      });
      eventListener({
        feedId: id,
        payload: {
          ...activity("s2"),
          kind: "suspicious-message",
          user: identity,
          status: "restricted",
          message: "Restricted event",
          messageId: "m2",
        },
      });
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter" }), { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "Filter monitoring status" });
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "All" }));
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Restricted" }));
    expect(screen.getByText("Restricted event")).toBeInTheDocument();
    expect(screen.queryByText("Monitoring event")).not.toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" });
    mounted.rerender(<SuspiciousActivityPanel {...props} channelId="200" />);
    await waitFor(() => expect(port.startFeed).toHaveBeenCalledTimes(2));
    const nextId = vi.mocked(port.startFeed).mock.calls[1][0].feedId;
    act(() =>
      eventListener({
        feedId: nextId,
        payload: {
          ...activity("s3"),
          channelId: "200",
          kind: "suspicious-message",
          user: identity,
          status: "active_monitoring",
          message: "New channel monitoring",
          messageId: "m3",
        },
      })
    );
    expect(screen.getByText("New channel monitoring")).toBeInTheDocument();
    expect(screen.queryByText("Restricted event")).not.toBeInTheDocument();
  });
  it("renders real suspicious messages and connection interruption state", async () => {
    renderWithProviders(<SuspiciousActivityPanel {...props} />);
    const id = await feedId();
    act(() => {
      stateListener({ feedId: id, state: "reconnecting" });
      eventListener({
        feedId: id,
        payload: {
          ...activity("s1"),
          kind: "suspicious-message",
          user: identity,
          message: "Flagged text",
          messageId: "m1",
          status: "restricted",
        },
      });
    });
    expect(screen.getByText("Flagged text")).toBeInTheDocument();
    expect(screen.getByText("Restricted")).toBeInTheDocument();
    expect(screen.getByText(/events may be missing/)).toBeInTheDocument();
  });
  it("replaces chatter pages and labels the partial active moderator intersection", async () => {
    renderWithProviders(<CommunityPanel {...props} />);
    await waitFor(() => expect(screen.getByText("Viewer")).toBeInTheDocument());
    vi.mocked(port.chatters).mockResolvedValue({
      ok: true,
      data: {
        items: [{ ...identity, id: "301", displayName: "Next Viewer" }],
        cursor: null,
        total: 400,
        observedAt: stamp,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByText("Next Viewer")).toBeInTheDocument());
    expect(screen.queryByText("Viewer")).not.toBeInTheDocument();
    expect(port.chatters).toHaveBeenLastCalledWith("100", "100", "next");
    fireEvent.click(screen.getByRole("button", { name: "Active Mods" }));
    await waitFor(() => expect(screen.getByText(/roster was also limited/)).toBeInTheDocument());
    expect(screen.getByText(/not a complete online moderator list/)).toBeInTheDocument();
  });
  it("keeps broadcaster-only reads off a remote moderator account", async () => {
    renderWithProviders(<CommunityPanel {...props} channelId="200" />);
    fireEvent.click(screen.getByRole("button", { name: "Active Mods" }));
    expect(screen.getByText(/available to the broadcaster/)).toBeInTheDocument();
    expect(port.activeModerators).not.toHaveBeenCalled();
  });
  it("shows app-owned reward requests without offering fulfillment mutations", async () => {
    renderWithProviders(<RewardRequestsPanel {...props} />);
    await waitFor(() => expect(screen.getByText("A short poem")).toBeInTheDocument());
    expect(port.redemptions).toHaveBeenCalledWith("100", "r1", undefined);
    expect(screen.getByText(/Only unfulfilled requests/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Twitch Mod View" }));
    expect(port.openTwitch).toHaveBeenCalledWith("owner");
    expect(screen.queryByRole("button", { name: /fulfill|reject/i })).not.toBeInTheDocument();
  });
  it("shows read failures without a fake empty reward queue", async () => {
    vi.mocked(port.rewards).mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "Twitch is unavailable" },
    });
    renderWithProviders(<RewardRequestsPanel {...props} />);
    await waitFor(() => expect(screen.getByText("Twitch is unavailable")).toBeInTheDocument());
    expect(screen.queryByText(/No rewards created/)).not.toBeInTheDocument();
  });
  it("refreshes the selected app-owned reward queue when its real redemption feed changes", async () => {
    renderWithProviders(<RewardRequestsPanel {...props} />);
    await screen.findByText("A short poem");
    const id = await feedId();
    const reads = vi.mocked(port.redemptions).mock.calls.length;
    vi.mocked(port.redemptions).mockResolvedValue({ ok: true, data: { items: [], cursor: null } });
    act(() =>
      eventListener({
        feedId: id,
        payload: {
          id: "reward-update",
          kind: "reward",
          accountId: "100",
          channelId: "100",
          occurredAt: stamp,
          coverageStartedAt: stamp,
          redemptionId: "1",
          rewardId: "r1",
          rewardTitle: "Read a poem",
          cost: 100,
          user: identity,
          input: "A short poem",
          status: "fulfilled",
          redeemedAt: stamp,
        },
      })
    );
    await waitFor(() => expect(port.redemptions).toHaveBeenCalledTimes(reads + 1));
    await waitFor(() => expect(screen.queryByText("A short poem")).not.toBeInTheDocument());
  });
  it("requires confirmation and manage scope before changing suspicious status", async () => {
    vi.mocked(port.tokenStatus).mockResolvedValue({
      platform: "twitch",
      connected: true,
      valid: true,
      userId: "100",
      scopes: ["moderator:read:suspicious_users", "moderator:manage:suspicious_users"],
    });
    renderWithProviders(<SuspiciousActivityPanel {...props} />);
    const id = await feedId();
    act(() =>
      eventListener({
        feedId: id,
        payload: {
          ...activity("s1"),
          kind: "suspicious-update",
          user: identity,
          status: "active_monitoring",
        },
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Restrict user" }));
    expect(port.setSuspiciousStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep unchanged" }));
    expect(port.setSuspiciousStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove monitoring" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(port.setSuspiciousStatus).toHaveBeenCalledWith("100", "100", "300", "NO_TREATMENT")
    );
  });
  it("keeps failed reward decisions visible and does not mutate until confirmed", async () => {
    vi.mocked(port.tokenStatus).mockResolvedValue({
      platform: "twitch",
      connected: true,
      valid: true,
      userId: "100",
      scopes: ["channel:manage:redemptions"],
    });
    vi.mocked(port.decideRedemption).mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "Decision failed" },
    });
    renderWithProviders(<RewardRequestsPanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fulfill request" }));
    expect(port.decideRedemption).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByText("Decision failed")).toBeInTheDocument());
    expect(port.decideRedemption).toHaveBeenCalledWith("100", "r1", "1", "FULFILLED");
    expect(screen.getByText("A short poem")).toBeInTheDocument();
  });
  it("routes moderated channels to their workspace and followed channels to watching", async () => {
    renderWithProviders(<ChannelSwitcher currentChannelId="100" />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Friend" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Friend" })).toHaveAttribute(
      "data-to",
      "/mod/twitch/$channel"
    );
    expect(screen.getByRole("link", { name: "Viewer Live" })).toHaveAttribute(
      "data-to",
      "/stream/$platform/$channel"
    );
    expect(screen.getByRole("link", { name: "Owner" })).toHaveAttribute("aria-current", "page");
  });
});

describe("workspace feed policy", () => {
  it("locks repeated confirmations synchronously and ignores completion after unmount", async () => {
    let complete: (value: { ok: true; data: null }) => void = () => {};
    const apply = vi.fn(
      () =>
        new Promise<{ ok: true; data: null }>((resolve) => {
          complete = resolve;
        })
    );
    const onSuccess = vi.fn();
    const mounted = renderWithProviders(
      <PanelDecision
        actions={[{ value: "RESTRICTED", label: "Restrict user" }]}
        apply={apply}
        onSuccess={onSuccess}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Restrict user" }));
    const confirm = screen.getByRole("button", { name: "Confirm" });
    act(() => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(apply).toHaveBeenCalledOnce();
    mounted.unmount();
    await act(async () => complete({ ok: true, data: null }));
    expect(onSuccess).not.toHaveBeenCalled();
  });
  it("never requests broadcaster activity with a remote moderator token", () => {
    expect(
      workspaceFeedPlan("activity", false, ["channel:read:subscriptions", "bits:read"]).events
    ).toEqual(["channel.raid"]);
    expect(workspaceFeedPlan("whispers", false, ["user:manage:whispers"]).events).toEqual([
      "user.whisper.message",
    ]);
  });
  it("deduplicates by provider event id while retaining the newest payload", () => {
    const result = appendWorkspaceEvent([activity("1"), activity("2")], {
      ...activity("1"),
      message: "updated",
    });
    expect(result).toHaveLength(2);
    expect("message" in result[0] ? result[0].message : null).toBe("updated");
  });
});
