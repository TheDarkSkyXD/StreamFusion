import { sleep } from "@/lib/sleep";

export type ModerationBrowserFixture =
  | "history"
  | "empty"
  | "partial"
  | "error"
  | "reconnect"
  | "hidden"
  | "timeout-valid"
  | "timeout-unverifiable"
  | "timeout-pending"
  | "timeout-failure"
  | "timeout-success";

export type ModerationFixtureMatch = { matched: false } | { matched: true; value: unknown };

export function selectedModerationDevelopmentFixture(
  search: string,
  isDevelopment = import.meta.env.DEV
): ModerationBrowserFixture | null {
  if (!isDevelopment) return null;
  const value = new URLSearchParams(search).get("moderationFixture");
  return value === "history" ||
    value === "empty" ||
    value === "partial" ||
    value === "error" ||
    value === "reconnect" ||
    value === "hidden" ||
    value === "timeout-valid" ||
    value === "timeout-unverifiable" ||
    value === "timeout-pending" ||
    value === "timeout-failure" ||
    value === "timeout-success"
    ? value
    : null;
}

export function getModerationBrowserFixture(
  path: readonly string[],
  args: readonly unknown[],
  search: string
): ModerationFixtureMatch {
  const fixture = selectedModerationDevelopmentFixture(search);
  if (!fixture) return { matched: false };
  const method = path.join(".");

  if (method === "moderation.createTimeoutSnapshot") {
    if (fixture === "timeout-unverifiable") {
      return { matched: true, value: { state: "unavailable", reason: "unverifiable" } };
    }
    if (fixture.startsWith("timeout-")) {
      const binding =
        args[0] && typeof args[0] === "object" ? (args[0] as { platform?: "twitch" | "kick" }) : {};
      const kick = binding.platform === "kick";
      return {
        matched: true,
        value: {
          state: "available",
          snapshotId: "development-timeout-snapshot",
          verifiedAt: Date.now(),
          actorRole: "moderator",
          policy: kick
            ? {
                durationUnit: "minutes",
                minDuration: 1,
                maxDuration: 10_080,
                supportsReason: true,
                maxReasonLength: 100,
              }
            : {
                durationUnit: "seconds",
                minDuration: 1,
                maxDuration: 1_209_600,
                supportsReason: true,
                maxReasonLength: 500,
              },
        },
      };
    }
  }

  if (method === "moderation.submitTimeout" && fixture.startsWith("timeout-")) {
    if (fixture === "timeout-pending") {
      return {
        matched: true,
        value: (async () => {
          await sleep(30_000);
          return { state: "success", attemptId: "development-pending-attempt" };
        })(),
      };
    }
    if (fixture === "timeout-failure") {
      return {
        matched: true,
        value: {
          state: "failure",
          attemptId: "development-failure-attempt",
          code: "forbidden",
          message: "Kick rejected this timeout. Check your moderation access and try again.",
        },
      };
    }
    return {
      matched: true,
      value: { state: "success", attemptId: "development-success-attempt" },
    };
  }

  return { matched: false };
}
