export type ModLogAction =
  | "ban"
  | "timeout"
  | "untimeout"
  | "unban"
  | "delete"
  | "clear"
  | "shield"
  | "raid"
  | "unraid"
  | "commercial"
  | "uniqueChat"
  | "uniquechat"
  | "followers"
  | "followersoff"
  | "slow"
  | "slowoff"
  | "subscribers"
  | "subscribersoff"
  | "emoteonly"
  | "emoteonlyoff"
  | "automod-level"
  | "mod"
  | "unmod"
  | "vip"
  | "unvip"
  | "blocked-term"
  | "permitted-term"
  | "automod_terms"
  | "shoutout"
  | "warn"
  | "unban_request"
  | "unban-request-approved"
  | "unban-request-denied"
  | "suspicious-user-update"
  | "guest-star"
  | "prediction-start"
  | "prediction-lock"
  | "prediction-resolve"
  | "prediction-cancel"
  | "poll-start"
  | "poll-terminate";

export interface ModLogActionFilter {
  id:
    | "all"
    | "message-deletions"
    | "chat-mode-changes"
    | "automod-level-changes"
    | "mods-and-vips"
    | "timeouts-and-untimeouts"
    | "blocked-and-permitted-terms"
    | "shoutouts"
    | "chat-warnings"
    | "bans-and-unbans"
    | "raids"
    | "unban-requests"
    | "suspicious-users"
    | "guest-star"
    | "roles";
  label: string;
  actions?: readonly ModLogAction[];
}

export const MOD_LOG_ACTION_FILTERS = [
  { id: "all", label: "All" },
  { id: "message-deletions", label: "Message Deletions", actions: ["delete"] },
  {
    id: "chat-mode-changes",
    label: "Chat Mode Changes",
    actions: [
      "clear",
      "shield",
      "uniqueChat",
      "uniquechat",
      "followers",
      "followersoff",
      "slow",
      "slowoff",
      "subscribers",
      "subscribersoff",
      "emoteonly",
      "emoteonlyoff",
    ],
  },
  { id: "automod-level-changes", label: "AutoMod Level Changes", actions: ["automod-level"] },
  { id: "mods-and-vips", label: "Mods and VIPs", actions: ["mod", "unmod", "vip", "unvip"] },
  {
    id: "timeouts-and-untimeouts",
    label: "Timeouts and Untimeouts",
    actions: ["timeout", "untimeout"],
  },
  {
    id: "blocked-and-permitted-terms",
    label: "Blocked and Permitted Terms",
    actions: ["blocked-term", "permitted-term", "automod_terms"],
  },
  { id: "shoutouts", label: "Shoutouts", actions: ["shoutout"] },
  { id: "chat-warnings", label: "Chat Warnings", actions: ["warn"] },
  { id: "bans-and-unbans", label: "Bans and Unbans", actions: ["ban", "unban"] },
  { id: "raids", label: "Raids", actions: ["raid", "unraid"] },
  {
    id: "unban-requests",
    label: "Unban Requests",
    actions: ["unban-request-approved", "unban-request-denied", "unban_request"],
  },
  {
    id: "suspicious-users",
    label: "Suspicious Users",
    actions: ["suspicious-user-update"],
  },
  { id: "guest-star", label: "Guest Star", actions: ["guest-star"] },
  { id: "roles", label: "Roles", actions: ["mod", "unmod", "vip", "unvip"] },
] as const satisfies readonly ModLogActionFilter[];
