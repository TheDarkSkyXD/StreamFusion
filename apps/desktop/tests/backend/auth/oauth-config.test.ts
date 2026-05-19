import { describe, expect, it } from "vitest";

import { TWITCH_OAUTH_CONFIG } from "@/backend/auth/oauth-config";

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
