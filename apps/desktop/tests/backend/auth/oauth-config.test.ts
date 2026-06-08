import { describe, expect, it } from "vitest";

import { KICK_OAUTH_CONFIG, TWITCH_OAUTH_CONFIG } from "@/backend/auth/oauth-config";

// Guards: Twitch IRC chat-scope regression — `chat:read` + `chat:edit` MUST stay in `TWITCH_OAUTH_CONFIG.scopes`. Dropping either breaks tmi.js authentication with the user-invisible "Login unsuccessful" failure (the `twitch-irc-missing-chat-scopes-2026-05-19` bug class). The second `describe` exists specifically because the Helix-side `moderator:manage:chat_messages` scope is NOT accepted by IRC, so the test pins the IRC requirements separately from the broader Helix scope set.
// Guards: channel-management console scope set — 11 retained-feature scopes plus prior scopes. Per-item `toContain` (not snapshot-equality) so a casual "tidy up" PR can't silently drop a single scope while keeping the list "mostly right". After the b15bdec refactor removed AutoMod/Streamlabs/giveaway features, no AutoMod-specific scopes appear in this set — the explicit AutoMod-absence assertion (added U20.c) pins this so drift in either direction fails (drop a retained scope OR re-add an AutoMod scope without re-introducing the feature).
// Guards: no duplicate scopes — Twitch silently accepts duplicates but the dedupe test surfaces the bug at audit time when someone has copy-pasted a scope while adding a feature.

// The eleven scopes the channel-management console plan adds in one batch
// (U4's nine plus the two unban-requests scopes from the moderators/VIPs/
// unban-requests follow-up). Kept here as a literal so the test would catch
// a partial drop (e.g., someone removing one to "tidy up" before review).
const REQUIRED_NEW_SCOPES = [
  "moderator:manage:banned_users",
  "moderator:manage:shield_mode",
  "channel:manage:raids",
  "channel:manage:moderators",
  "channel:manage:vips",
  "channel:manage:predictions",
  "channel:manage:polls",
  "channel:edit:commercial",
  "user:manage:whispers",
  "moderator:read:unban_requests",
  "moderator:manage:unban_requests",
] as const;

// AutoMod / Streamlabs / giveaway feature were ripped out of the channel-management
// console in commit b15bdec. These scopes were granted alongside the U4 batch and
// MUST stay removed — if a refactor reintroduces them at OAuth time, the broken
// AutoMod code paths (deleted in b15bdec) will not be available and the consent
// dialog will show scopes the app cannot honor. (per b15bdec diff at
// apps/desktop/src/backend/auth/oauth-config.ts:87-90.)
const REMOVED_AUTOMOD_SCOPES = [
  "moderator:manage:automod",
  "moderator:manage:automod_settings",
  "moderator:read:chat_messages",
] as const;

describe("TWITCH_OAUTH_CONFIG scopes (U4 — channel-management console batch)", () => {
  it("includes all eleven new console scopes", () => {
    for (const scope of REQUIRED_NEW_SCOPES) {
      expect(TWITCH_OAUTH_CONFIG.scopes).toContain(scope);
    }
  });

  it("preserves the prior scopes that already shipped (pin + mod-channels + base)", () => {
    expect(TWITCH_OAUTH_CONFIG.scopes).toEqual(
      expect.arrayContaining([
        "user:read:email",
        "user:read:follows",
        "user:read:subscriptions",
        "user:read:moderated_channels",
        "moderator:manage:chat_messages",
      ])
    );
  });

  it("contains no duplicate scopes", () => {
    const set = new Set(TWITCH_OAUTH_CONFIG.scopes);
    expect(set.size).toBe(TWITCH_OAUTH_CONFIG.scopes.length);
  });

  it("does NOT include AutoMod scopes (removed in b15bdec when the AutoMod feature was ripped out)", () => {
    for (const scope of REMOVED_AUTOMOD_SCOPES) {
      expect(TWITCH_OAUTH_CONFIG.scopes).not.toContain(scope);
    }
  });
});

// Twitch IRC (tmi.js) authenticates via PASS oauth:<token>/NICK <login>. The
// token must carry chat:read to read messages and chat:edit to send them; any
// other scope (including moderator:manage:chat_messages, which only unlocks the
// Helix delete endpoint) is not accepted by IRC. Dropping either of these
// breaks authenticated chat connection with "Login unsuccessful".
describe("TWITCH_OAUTH_CONFIG scopes (IRC chat — tmi.js)", () => {
  it("includes chat:read so tmi.js can authenticate and read messages", () => {
    expect(TWITCH_OAUTH_CONFIG.scopes).toContain("chat:read");
  });

  it("includes chat:edit so tmi.js can send messages and replies", () => {
    expect(TWITCH_OAUTH_CONFIG.scopes).toContain("chat:edit");
  });
});

// Guards: Kick chat:write scope dropped 2026-05-29 — chat send now goes through
// kick.com/api/v2/messages/send/{chatroomId} via page-context fetch (see
// kick-send-window.ts). The public-API path (POST /public/v1/chat) is gated
// behind App Verification and silently drops un-verified sends, so requesting
// chat:write at OAuth time was wasted scope churn. Re-adding it requires
// reverting the page-context send path.
describe("KICK_OAUTH_CONFIG scopes (chat send)", () => {
  it("KICK_OAUTH_CONFIG no longer requests chat:write (page-context send replaces it)", () => {
    expect(KICK_OAUTH_CONFIG.scopes).not.toContain("chat:write");
  });

  it("preserves the prior base scopes (user:read + channel:read)", () => {
    expect(KICK_OAUTH_CONFIG.scopes).toEqual(
      expect.arrayContaining(["user:read", "channel:read"]),
    );
  });

  it("contains no duplicate scopes", () => {
    const set = new Set(KICK_OAUTH_CONFIG.scopes);
    expect(set.size).toBe(KICK_OAUTH_CONFIG.scopes.length);
  });
});
