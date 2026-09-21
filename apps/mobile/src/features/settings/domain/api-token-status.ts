import type { KickAccountSessionSnapshot } from "@mobile/features/auth/domain/kick-account-session-controller";
import type { TwitchAccountSessionSnapshot } from "@mobile/features/auth/domain/twitch-account-session-controller";

import type {
  ApiTokenPlatformView,
  ApiTokenSettingsView,
  ApiTokenStatus,
} from "../capabilities/api-token-settings";

export function composeApiTokenSettingsView(input: {
  readonly kick: KickAccountSessionSnapshot;
  readonly twitch: TwitchAccountSessionSnapshot;
}): ApiTokenSettingsView {
  return {
    twitch: composePlatformView("twitch", "Twitch", input.twitch),
    kick: composePlatformView("kick", "Kick", input.kick),
    disclosure:
      "Read-only token status. Values never leave this device. Connect or reconnect from Integrations / Accounts.",
  };
}

function composePlatformView(
  platform: "twitch" | "kick",
  label: string,
  snapshot: TwitchAccountSessionSnapshot | KickAccountSessionSnapshot,
): ApiTokenPlatformView {
  return {
    platform,
    label,
    status: statusFromSnapshot(snapshot),
  };
}

export function statusFromSnapshot(
  snapshot: TwitchAccountSessionSnapshot | KickAccountSessionSnapshot,
): ApiTokenStatus {
  switch (snapshot.kind) {
    case "restoring":
    case "requesting":
    case "validating":
    case "committing":
    case "launching":
    case "pending":
      return { kind: "loading" };
    case "connected":
      return {
        kind: "valid",
        login: snapshot.login,
        userId: null,
        expiresAtEpochMs: snapshot.expiresAtEpochMs,
        scopes: snapshot.scopes,
      };
    case "auth-lost":
      return {
        kind: "invalid",
        reason: snapshot.reason || "Token invalid or expired",
      };
    case "failed":
      return { kind: "invalid", reason: snapshot.message };
    case "unavailable":
      return { kind: "invalid", reason: snapshot.guidance };
    case "disconnected":
    default:
      return { kind: "not-connected" };
  }
}

export function integrationsSummary(
  snapshot: TwitchAccountSessionSnapshot | KickAccountSessionSnapshot,
): string {
  switch (snapshot.kind) {
    case "connected":
      return `Signed in as ${snapshot.displayName}`;
    case "restoring":
    case "requesting":
    case "validating":
    case "committing":
    case "launching":
    case "pending":
      return "Connecting…";
    case "auth-lost":
      return "Session lost — reconnect required";
    case "failed":
      return snapshot.message;
    case "unavailable":
      return snapshot.guidance;
    case "disconnected":
    default:
      return "Not signed in";
  }
}
