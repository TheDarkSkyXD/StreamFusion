import { act } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fireEvent,
  installElectronAPIMock,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../../../../../../tests/test-utils";
import { AutoModQueue } from "@/features/moderation/components/screens/Mod/channel/workspace/AutoModQueue";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import { useReconnectDialogStore } from "@/features/auth/components/state/reconnect-dialog-store";

type EventSubAPI = Window["electronAPI"]["twitch"]["eventSub"];
type EventCallback = Parameters<EventSubAPI["onEvent"]>[0];
type StateCallback = Parameters<EventSubAPI["onState"]>[0];

const startOk = {
  ok: true,
  data: undefined,
} satisfies Awaited<ReturnType<EventSubAPI["start"]>>;

// Guards: AutoMod bounds retained requests, discloses missing coverage, and removes only confirmed resolutions.
// Guards: connection and mutation failures stay visible and recoverable while held rows remain usable.
// Guards: permission reconnect, retry, and unmount cleanup restart or stop the exact feed without stale updates.
describe("AutoModQueue", () => {
  let api: ReturnType<typeof installElectronAPIMock>;
  let eventCallbacks: EventCallback[];
  let stateCallbacks: StateCallback[];
  let eventCleanups: Array<ReturnType<typeof vi.fn>>;
  let stateCleanups: Array<ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    useAuthStore.setState({
      twitchUser: {
        id: "mod",
        login: "mod",
        displayName: "Mod",
        profileImageUrl: "https://example.com/mod.png",
        createdAt: "2026-01-01T00:00:00.000Z",
        broadcasterType: "",
      },
    });
    useReconnectDialogStore.setState({
      isOpen: false,
      platform: "twitch",
      phase: "idle",
      missingScopes: [],
      onReconnected: null,
    });
    api = installElectronAPIMock();
    eventCallbacks = [];
    stateCallbacks = [];
    eventCleanups = [];
    stateCleanups = [];
    api.twitch.eventSub.onEvent = vi.fn((callback) => {
      eventCallbacks.push(callback);
      const cleanup = vi.fn();
      eventCleanups.push(cleanup);
      return cleanup;
    });
    api.twitch.eventSub.onState = vi.fn((callback) => {
      stateCallbacks.push(callback);
      const cleanup = vi.fn();
      stateCleanups.push(cleanup);
      return cleanup;
    });
    api.twitch.eventSub.start = vi.fn(async () => startOk);
    api.twitch.eventSub.stop = vi.fn(async () => true);
    api.twitch.execute = vi.fn(async () => startOk);
  });

  function latest<T>(values: readonly T[]): T {
    const value = values.at(-1);
    if (!value) throw new Error("Expected an active EventSub callback");
    return value;
  }

  function hold(id: string) {
    return {
      subscription: { type: "automod.message.hold" },
      event: {
        message_id: id,
        user_name: `user-${id}`,
        message: { text: `held-${id}` },
        reason: "AutoMod",
      },
    };
  }

  function sendPayload(payload: unknown, feedId = "automod:42:mod") {
    act(() => latest(eventCallbacks)({ feedId, payload }));
  }

  function sendState(state: string, feedId = "automod:42:mod") {
    act(() => latest(stateCallbacks)({ feedId, state }));
  }

  function renderQueue(channelId = "42") {
    return renderWithProviders(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 120 }}>
        <AutoModQueue channelId={channelId} channel="chan" />
      </VirtuosoMockContext.Provider>
    );
  }

  it("deduplicates holds and removes an update carrying only the authoritative id", async () => {
    renderQueue();
    sendState("connected");
    sendPayload(hold("one"));
    sendPayload(hold("one"));
    expect(await screen.findAllByText("held-one")).toHaveLength(1);

    sendPayload({
      subscription: { type: "automod.message.update" },
      event: { message_id: "one" },
    });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No held messages"));
  });

  it("keeps a connected state when the initial start resolves afterward", async () => {
    const deferred = Promise.withResolvers<Awaited<ReturnType<EventSubAPI["start"]>>>();
    api.twitch.eventSub.start = vi.fn(() => deferred.promise);
    renderQueue();
    sendState("connected");

    await act(async () => {
      deferred.resolve(startOk);
      await deferred.promise;
    });

    expect(screen.getByRole("status")).toHaveTextContent("No held messages");
  });

  it("retries a rejected start and recovers on the replacement connection", async () => {
    let attempts = 0;
    api.twitch.eventSub.start = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("down");
      return startOk;
    });
    renderQueue();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("connection failed"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.twitch.eventSub.start).toHaveBeenCalledTimes(2));
    sendState("connected");
    expect(screen.getByRole("status")).toHaveTextContent("No held messages");
  });

  it("keeps row busy state independent and displays failures with existing messages", async () => {
    const action = Promise.withResolvers<Awaited<ReturnType<typeof api.twitch.execute>>>();
    api.twitch.execute = vi.fn(() => action.promise);
    renderQueue();
    sendState("connected");
    sendPayload(hold("one"));
    sendPayload(hold("two"));
    const allow = await screen.findAllByRole("button", { name: "Allow" });

    fireEvent.click(allow[0]);
    expect(allow[0]).toBeDisabled();
    expect(allow[1]).not.toBeDisabled();
    await act(async () => {
      action.resolve({ ok: false, error: { code: "unavailable", message: "retry action" } });
      await action.promise;
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("retry action");
    expect(screen.getByText("held-one")).toBeInTheDocument();
    expect(screen.getByText("held-two")).toBeInTheDocument();
    expect(allow[0]).not.toBeDisabled();

    sendState("error");
    expect(screen.getByRole("status")).toHaveTextContent("connection failed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("held-one")).toBeInTheDocument();
  });

  it("reconnects after a permission event and restarts the same feed once authorized", async () => {
    renderQueue();
    sendState("permission");
    fireEvent.click(await screen.findByRole("button", { name: "Reconnect Twitch" }));
    expect(useReconnectDialogStore.getState()).toMatchObject({
      isOpen: true,
      platform: "twitch",
      missingScopes: ["moderator:manage:automod"],
    });

    await act(async () => {
      await useReconnectDialogStore.getState().fireReconnected();
    });

    await waitFor(() => expect(api.twitch.eventSub.start).toHaveBeenCalledTimes(2));
    expect(api.twitch.eventSub.start).toHaveBeenNthCalledWith(1, {
      feedId: "automod:42:mod",
      userId: "mod",
      channelId: "42",
      eventTypes: ["automod.message.hold", "automod.message.update"],
    });
    expect(api.twitch.eventSub.start).toHaveBeenNthCalledWith(2, {
      feedId: "automod:42:mod",
      userId: "mod",
      channelId: "42",
      eventTypes: ["automod.message.hold", "automod.message.update"],
    });
  });

  it("opens reconnect with the AutoMod scope when no Twitch user exists", async () => {
    useAuthStore.setState({ twitchUser: null });
    renderQueue();
    fireEvent.click(await screen.findByRole("button", { name: "Reconnect Twitch" }));

    expect(useReconnectDialogStore.getState()).toMatchObject({
      isOpen: true,
      platform: "twitch",
      missingScopes: ["moderator:manage:automod"],
    });
    expect(api.twitch.eventSub.start).not.toHaveBeenCalled();
  });

  it("cleans up subscriptions and ignores callbacks retained after unmount", async () => {
    const first = renderQueue();
    const staleEvent = latest(eventCallbacks);
    const staleState = latest(stateCallbacks);
    first.unmount();

    expect(eventCleanups[0]).toHaveBeenCalledTimes(1);
    expect(stateCleanups[0]).toHaveBeenCalledTimes(1);
    expect(api.twitch.eventSub.stop).toHaveBeenCalledWith("automod:42:mod");
    renderQueue();
    act(() => {
      staleEvent({ feedId: "automod:42:mod", payload: hold("stale") });
      staleState({ feedId: "automod:42:mod", state: "permission" });
    });

    expect(screen.queryByText("held-stale")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconnect Twitch" })).not.toBeInTheDocument();
    expect(api.twitch.eventSub.start).toHaveBeenCalledTimes(2);
  });

  it("bounds live holds and discloses older requests are no longer shown", async () => {
    renderQueue();
    sendState("connected");
    const callback = latest(eventCallbacks);
    act(() => {
      for (let index = 0; index <= 100; index += 1) {
        callback({ feedId: "automod:42:mod", payload: hold(String(index)) });
      }
    });

    expect(await screen.findByText("held-1")).toBeInTheDocument();
    expect(screen.queryByText("held-0")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Showing the latest 100 received requests. Older requests are no longer shown."
      )
    ).toBeInTheDocument();
  });
  it("keeps interrupted requests visibly unverified and disables decisions after reconnect", async () => {
    renderQueue();
    sendState("connected");
    sendPayload(hold("old"));
    expect(await screen.findByRole("button", { name: "Allow" })).not.toBeDisabled();
    sendState("reconnecting");
    sendState("connected");
    expect(screen.getByText("held-old")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This request may have changed while disconnected. Check its status in Twitch Mod View."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(api.twitch.execute).not.toHaveBeenCalled();
    sendPayload(hold("new"));
    expect(screen.getAllByRole("button", { name: "Allow" })[1]).not.toBeDisabled();
    sendPayload({ subscription: { type: "automod.message.update" }, event: { message_id: "old" } });
    expect(screen.queryByText("held-old")).not.toBeInTheDocument();
    expect(screen.getByText("held-new")).toBeInTheDocument();
  });

  it("ignores decision completion from a queue that was restarted", async () => {
    const action = Promise.withResolvers<Awaited<ReturnType<typeof api.twitch.execute>>>();
    api.twitch.execute = vi.fn(() => action.promise);
    renderQueue();
    sendState("connected");
    sendPayload(hold("one"));
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    sendState("error");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    sendState("connected");
    sendPayload(hold("one"));
    await act(async () => {
      action.resolve({ ok: true, data: null });
      await action.promise;
    });
    expect(screen.getByText("held-one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).not.toBeDisabled();
  });
});
