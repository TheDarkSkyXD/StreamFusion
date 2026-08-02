import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyModerationBrowserFixture,
  getModerationBrowserFixture,
  selectedModerationDevelopmentFixture,
} from "@/dev-relay/moderation-browser-fixtures";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

beforeEach(() => {
  useAuthStore.setState({ twitchUser: null, twitchConnected: false, isGuest: true });
  useDevModOverrideStore.getState().reset();
});

// Guards: query-string fixtures are inert in production even if a user supplies the parameter.
describe("moderation development fixture isolation", () => {
  it("preserves real authentication while changing only moderation overrides", () => {
    const authBefore = useAuthStore.getState();

    applyModerationBrowserFixture("?moderationFixture=history", true);

    expect(useAuthStore.getState()).toMatchObject({
      twitchUser: authBefore.twitchUser,
      twitchConnected: authBefore.twitchConnected,
      isGuest: authBefore.isGuest,
    });
    expect(useDevModOverrideStore.getState()).toMatchObject({
      forceModRole: true,
      forceModScopes: true,
    });
  });

  it("does not synthesize authentication, tokens, or moderation history", () => {
    const search = "?moderationFixture=history";

    for (const path of [
      ["auth", "getStatus"],
      ["auth", "tokenStatus"],
      ["auth", "getToken"],
      ["modLog", "query"],
    ]) {
      expect(getModerationBrowserFixture(path, [{}], search)).toEqual({ matched: false });
    }
  });

  it("does not select or apply moderation overrides when development mode is disabled", () => {
    const search = "?moderationFixture=history";

    expect(selectedModerationDevelopmentFixture(search, false)).toBeNull();
    applyModerationBrowserFixture(search, false);

    expect(useAuthStore.getState()).toMatchObject({
      twitchUser: null,
      twitchConnected: false,
      isGuest: true,
    });
    expect(useDevModOverrideStore.getState()).toMatchObject({
      forceModRole: false,
      forceModScopes: false,
    });
  });

  it("selects the explicit development moderation state without supplying view data", () => {
    const search = "?moderationFixture=empty";

    expect(selectedModerationDevelopmentFixture(search, true)).toBe("empty");
    expect(getModerationBrowserFixture(["modLog", "query"], [{}], search)).toEqual({
      matched: false,
    });
  });

  it.each([
    "timeout-valid",
    "timeout-unverifiable",
    "timeout-pending",
    "timeout-failure",
    "timeout-success",
  ] as const)("provides truthful %s snapshot and submission behavior", async (fixture) => {
    const usesTimer = fixture === "timeout-pending";
    if (usesTimer) vi.useFakeTimers();
    try {
      const search = `?moderationFixture=${fixture}`;
      const snapshot = getModerationBrowserFixture(
        ["moderation", "createTimeoutSnapshot"],
        [
          {
            platform: "kick",
            channelId: "channel-1",
            channelSlug: "streamer",
            targetUserId: "target-1",
            targetUsername: "viewer",
            action: "timeout",
          },
        ],
        search
      );
      expect(snapshot.matched).toBe(true);
      if (!snapshot.matched) return;

      if (fixture === "timeout-unverifiable") {
        expect(snapshot.value).toEqual({ state: "unavailable", reason: "unverifiable" });
        return;
      }
      expect(snapshot.value).toMatchObject({
        state: "available",
        snapshotId: "development-timeout-snapshot",
        policy: {
          durationUnit: "minutes",
          minDuration: 1,
          maxDuration: 10_080,
        },
      });

      const submission = getModerationBrowserFixture(
        ["moderation", "submitTimeout"],
        [{ snapshotId: "development-timeout-snapshot", duration: 10 }],
        search
      );
      expect(submission.matched).toBe(true);
      if (!submission.matched) return;

      if (fixture === "timeout-pending") {
        let settled = false;
        const pending = Promise.resolve(submission.value).then((value) => {
          settled = true;
          return value;
        });
        await vi.advanceTimersByTimeAsync(29_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toEqual({
          state: "success",
          attemptId: "development-pending-attempt",
        });
      } else if (fixture === "timeout-failure") {
        expect(submission.value).toEqual({
          state: "failure",
          attemptId: "development-failure-attempt",
          code: "forbidden",
          message: "Kick rejected this timeout. Check your moderation access and try again.",
        });
      } else {
        expect(submission.value).toEqual({
          state: "success",
          attemptId: "development-success-attempt",
        });
      }
    } finally {
      if (usesTimer) vi.useRealTimers();
    }
  });
});
