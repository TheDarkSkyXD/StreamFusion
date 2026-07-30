import { TWITCH_APP_SCOPES, type TwitchUser } from "@/shared/auth-types";
import type { ModerationHistoryResult, ModLogEntry } from "@/shared/mod-log-types";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

export type ModerationBrowserFixture =
  | "history"
  | "empty"
  | "partial"
  | "error"
  | "reconnect"
  | "hidden";

export type ModerationFixtureMatch = { matched: false } | { matched: true; value: unknown };

const FIXTURE_TWITCH_USER: TwitchUser = {
  id: "fixture-moderator",
  login: "fixturemod",
  displayName: "FixtureMod",
  profileImageUrl: "",
  createdAt: "2013-07-30T00:00:00Z",
  broadcasterType: "",
};

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
    value === "hidden"
    ? value
    : null;
}

function makeHistoryEntry(index: number, filters: Record<string, unknown>): ModLogEntry {
  const occurredAt = Date.UTC(2026, 6, 30, 12, 0, 0) - index * 86_400_000;
  const platform = filters.platform === "kick" ? "kick" : "twitch";
  return {
    id: index + 1,
    platform,
    channelId: String(filters.channelId ?? "fixture-channel"),
    channelSlug: String(filters.channelSlug ?? "fixture-channel"),
    action: index % 2 === 0 ? "timeout" : "ban",
    targetUserId: String(filters.targetUserId ?? "fixture-user"),
    targetUsername: "FixtureUser",
    moderatorUserId: "fixture-moderator",
    moderatorUsername: "FixtureMod",
    durationSeconds: index % 2 === 0 ? 600 : null,
    reason: index % 2 === 0 ? "Fixture moderation reason" : null,
    provenance: platform === "kick" ? "kick-observed" : "twitch-eventsub",
    providerEventId: `fixture-event-${index + 1}`,
    occurredAt,
    observedAt: occurredAt + 1_000,
    createdAt: occurredAt,
  };
}

function historyResult(
  fixture: ModerationBrowserFixture,
  filters: Record<string, unknown>
): ModerationHistoryResult {
  const limit =
    typeof filters.limit === "number" && Number.isFinite(filters.limit)
      ? Math.max(0, filters.limit)
      : 5;
  const entries = Array.from({ length: Math.min(5, limit) }, (_, index) =>
    makeHistoryEntry(index, filters)
  );

  switch (fixture) {
    case "history":
      return { state: "ready", entries, coverage: "complete" };
    case "empty":
      return { state: "verified-empty", entries: [], coverage: "complete" };
    case "partial":
      return {
        state: "partial",
        entries,
        coverage: "partial",
        reason: "observation-window",
      };
    case "error":
      return {
        state: "error",
        entries: [],
        code: "query-failed",
        retryable: true,
      };
    default:
      return {
        state: "error",
        entries: [],
        code: "unverified",
        retryable: false,
      };
  }
}

export function applyModerationBrowserFixture(
  search: string,
  isDevelopment = import.meta.env.DEV
): void {
  const fixture = selectedModerationDevelopmentFixture(search, isDevelopment);
  if (!fixture) return;
  const twitchUser = fixture === "hidden" ? null : FIXTURE_TWITCH_USER;
  useAuthStore.setState({
    twitchUser,
    twitchConnected: Boolean(twitchUser),
    isGuest: !twitchUser,
  });
  useDevModOverrideStore.setState({
    forceModRole: fixture !== "hidden",
    forceModScopes: fixture !== "hidden" && fixture !== "reconnect",
    forceResolvedTwitchBroadcasterId: "fixture-channel",
  });
}

export function getModerationBrowserFixture(
  path: readonly string[],
  args: readonly unknown[],
  search: string
): ModerationFixtureMatch {
  const fixture = selectedModerationDevelopmentFixture(search);
  if (!fixture) return { matched: false };
  const method = path.join(".");

  if (method === "auth.getStatus") {
    const user = fixture === "hidden" ? null : FIXTURE_TWITCH_USER;
    return {
      matched: true,
      value: {
        twitch: {
          connected: Boolean(user),
          user,
          hasToken: Boolean(user),
          isExpired: false,
        },
        kick: { connected: false, user: null, hasToken: false, isExpired: false },
        isGuest: !user,
      },
    };
  }

  if (method === "auth.tokenStatus") {
    return {
      matched: true,
      value: {
        platform: "twitch",
        connected: fixture !== "hidden",
        valid: fixture !== "hidden",
        userId: fixture === "hidden" ? undefined : "fixture-moderator",
        scopes:
          fixture === "reconnect"
            ? TWITCH_APP_SCOPES.filter((scope) => scope !== "moderator:manage:chat_messages")
            : [...TWITCH_APP_SCOPES],
      },
    };
  }

  if (method === "auth.openTwitchLogin") {
    return { matched: true, value: undefined };
  }

  if (method === "auth.getToken") {
    return {
      matched: true,
      value:
        fixture === "hidden"
          ? null
          : { accessToken: "development-fixture", scope: [...TWITCH_APP_SCOPES] },
    };
  }

  if (method === "modLog.query") {
    const filters =
      args[0] && typeof args[0] === "object" ? (args[0] as Record<string, unknown>) : {};
    return { matched: true, value: historyResult(fixture, filters) };
  }

  return { matched: false };
}

export function getModerationDevelopmentHistoryFixture(
  filters: Record<string, unknown>,
  search: string,
  isDevelopment = import.meta.env.DEV
): ModerationHistoryResult | null {
  const fixture = selectedModerationDevelopmentFixture(search, isDevelopment);
  return fixture ? historyResult(fixture, filters) : null;
}
