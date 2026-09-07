import type { ChannelTool, ChannelToolAccess } from "../../capabilities/channel-tools";

const policies: Record<ChannelTool, { read: string[]; write: string; own?: boolean }> = {
  "stream-info": {
    read: ["channel:manage:broadcast"],
    write: "channel:manage:broadcast",
    own: true,
  },
  bans: {
    read: ["moderator:manage:banned_users", "moderation:read"],
    write: "moderator:manage:banned_users",
  },
  unban: {
    read: ["moderator:read:unban_requests", "moderator:manage:unban_requests"],
    write: "moderator:manage:unban_requests",
  },
  moderators: {
    read: ["moderation:read", "channel:manage:moderators"],
    write: "channel:manage:moderators",
    own: true,
  },
  vips: {
    read: ["channel:read:vips", "channel:manage:vips"],
    write: "channel:manage:vips",
    own: true,
  },
  polls: {
    read: ["channel:read:polls", "channel:manage:polls"],
    write: "channel:manage:polls",
    own: true,
  },
  predictions: {
    read: ["channel:read:predictions", "channel:manage:predictions"],
    write: "channel:manage:predictions",
    own: true,
  },
  shield: {
    read: ["moderator:read:shield_mode", "moderator:manage:shield_mode"],
    write: "moderator:manage:shield_mode",
  },
  "automod-settings": {
    read: ["moderator:read:automod_settings", "moderator:manage:automod_settings"],
    write: "moderator:manage:automod_settings",
  },
  "blocked-terms": {
    read: ["moderator:read:blocked_terms", "moderator:manage:blocked_terms"],
    write: "moderator:manage:blocked_terms",
  },
};

export function twitchToolAccess(scopes: readonly string[], own: boolean): ChannelToolAccess {
  const granted = new Set(scopes);
  return Object.fromEntries(
    Object.entries(policies).map(([tool, policy]) => {
      const broadcasterOnly = Boolean(policy.own && !own);
      const readScopes = tool === "bans" && !own ? [policy.write] : policy.read;
      const hasRead = readScopes.some((scope) => granted.has(scope));
      const hasWrite = granted.has(policy.write);
      return [
        tool,
        {
          canRead: !broadcasterOnly && hasRead,
          canManage: !broadcasterOnly && hasWrite,
          broadcasterOnly,
          missingReadScopes: hasRead ? [] : [readScopes[0]],
          missingWriteScopes: hasWrite ? [] : [policy.write],
        },
      ];
    })
  ) as ChannelToolAccess;
}
