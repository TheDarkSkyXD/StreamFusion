import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TwitchEventSubClient } from "@/backend/api/platforms/twitch/twitch-eventsub-client";
import type { TwitchEventSubConnectionState } from "@/backend/api/platforms/twitch/twitch-eventsub-types";

vi.mock("@/backend/api/unified/platform-health", () => ({
  recordPlatformFailure: vi.fn(),
  recordPlatformSuccess: vi.fn(),
}));

import { recordPlatformFailure, recordPlatformSuccess } from "@/backend/api/unified/platform-health";
import {
  attachEventSubHealthBridge,
  EVENTSUB_DISCONNECT_DEBOUNCE_MS,
} from "@/backend/api/platforms/twitch/eventsub-health-bridge";

type StateListener = (state: TwitchEventSubConnectionState) => void;

function createMockClient(): TwitchEventSubClient & { fire(state: TwitchEventSubConnectionState): void } {
  const listeners = new Set<StateListener>();
  return {
    connectionState: "idle" as TwitchEventSubConnectionState,
    subscribe: vi.fn(() => () => {}),
    onConnectionStateChange(listener: StateListener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    close: vi.fn(),
    fire(state: TwitchEventSubConnectionState) {
      (this as { connectionState: TwitchEventSubConnectionState }).connectionState = state;
      for (const fn of listeners) fn(state);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(recordPlatformFailure).mockClear();
  vi.mocked(recordPlatformSuccess).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("attachEventSubHealthBridge", () => {
  it("short reconnect blip (<5s) does not record a failure", () => {
    const client = createMockClient();
    attachEventSubHealthBridge(client);

    client.fire("reconnecting");
    vi.advanceTimersByTime(3_000);
    client.fire("connected");

    vi.advanceTimersByTime(EVENTSUB_DISCONNECT_DEBOUNCE_MS);
    expect(recordPlatformFailure).not.toHaveBeenCalled();
  });

  it("short reconnect blip records a success on reconnection", () => {
    const client = createMockClient();
    attachEventSubHealthBridge(client);

    client.fire("reconnecting");
    vi.advanceTimersByTime(2_000);
    client.fire("connected");

    expect(recordPlatformSuccess).toHaveBeenCalledWith("twitch");
    expect(recordPlatformSuccess).toHaveBeenCalledTimes(1);
  });

  it("sustained disconnect (>=5s) records exactly one net-error failure", () => {
    const client = createMockClient();
    attachEventSubHealthBridge(client);

    client.fire("reconnecting");
    vi.advanceTimersByTime(EVENTSUB_DISCONNECT_DEBOUNCE_MS);

    expect(recordPlatformFailure).toHaveBeenCalledWith("twitch", "net-error");
    expect(recordPlatformFailure).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(EVENTSUB_DISCONNECT_DEBOUNCE_MS * 2);
    expect(recordPlatformFailure).toHaveBeenCalledTimes(1);
  });

  it("multiple rapid disconnect/reconnect cycles within 5s coalesce into at most one failure", () => {
    const client = createMockClient();
    attachEventSubHealthBridge(client);

    client.fire("reconnecting");
    vi.advanceTimersByTime(1_000);
    client.fire("connected");
    vi.advanceTimersByTime(500);
    client.fire("reconnecting");
    vi.advanceTimersByTime(1_000);
    client.fire("connected");
    vi.advanceTimersByTime(500);
    client.fire("reconnecting");
    vi.advanceTimersByTime(1_000);
    client.fire("connected");

    vi.advanceTimersByTime(EVENTSUB_DISCONNECT_DEBOUNCE_MS);
    expect(recordPlatformFailure).not.toHaveBeenCalled();
  });

  it("transition to error records failure immediately without waiting 5s", () => {
    const client = createMockClient();
    attachEventSubHealthBridge(client);

    client.fire("reconnecting");
    vi.advanceTimersByTime(1_000);
    client.fire("error");

    expect(recordPlatformFailure).toHaveBeenCalledWith("twitch", "net-error");
    expect(recordPlatformFailure).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(EVENTSUB_DISCONNECT_DEBOUNCE_MS);
    expect(recordPlatformFailure).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops monitoring and clears pending timer", () => {
    const client = createMockClient();
    const unsubscribe = attachEventSubHealthBridge(client);

    client.fire("reconnecting");
    vi.advanceTimersByTime(2_000);

    unsubscribe();

    vi.advanceTimersByTime(EVENTSUB_DISCONNECT_DEBOUNCE_MS);
    expect(recordPlatformFailure).not.toHaveBeenCalled();
    expect(recordPlatformSuccess).not.toHaveBeenCalled();
  });
});
