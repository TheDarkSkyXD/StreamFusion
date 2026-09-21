import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGuestLiveAlertPoller,
  DEFAULT_LIVE_ALERT_POLL_INTERVAL_MS,
} from "../domain/guest-live-alert-poller";

afterEach(() => {
  vi.useRealTimers();
});

describe("createGuestLiveAlertPoller", () => {
  it("ticks on foreground enter and on interval while foreground", async () => {
    vi.useFakeTimers();
    const hydrateLive = vi.fn(async () => undefined);
    const poller = createGuestLiveAlertPoller({
      hydrateLive,
      intervalMs: DEFAULT_LIVE_ALERT_POLL_INTERVAL_MS,
    });

    poller.setForeground(true);
    await Promise.resolve();
    expect(hydrateLive).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_LIVE_ALERT_POLL_INTERVAL_MS);
    expect(hydrateLive).toHaveBeenCalledTimes(2);

    poller.setForeground(false);
    await vi.advanceTimersByTimeAsync(DEFAULT_LIVE_ALERT_POLL_INTERVAL_MS * 2);
    expect(hydrateLive).toHaveBeenCalledTimes(2);

    poller.dispose();
  });

  it("does not start while backgrounded", async () => {
    const hydrateLive = vi.fn(async () => undefined);
    const poller = createGuestLiveAlertPoller({ hydrateLive });
    await poller.tick();
    expect(hydrateLive).not.toHaveBeenCalled();
    poller.dispose();
  });
});
