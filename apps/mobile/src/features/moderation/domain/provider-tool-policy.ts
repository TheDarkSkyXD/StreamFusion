import type {
  ChannelTool,
  ChannelToolCommand,
  FeedKind,
} from "../capabilities/provider-tools";

export function channelToolScopes(
  tool: ChannelTool | ChannelToolCommand,
): readonly string[] {
  const kind = typeof tool === "string" ? tool : tool.kind;
  switch (kind) {
    case "stream-info":
      return typeof tool === "string" ? [] : ["channel:manage:broadcast"];
    case "shield":
      return [
        typeof tool === "string"
          ? "moderator:read:shield_mode"
          : "moderator:manage:shield_mode",
      ];
    case "automod-policy":
      return [
        typeof tool === "string"
          ? "moderator:read:automod_settings"
          : "moderator:manage:automod_settings",
      ];
    case "blocked-terms":
      return ["moderator:read:blocked_terms"];
    case "add-term":
    case "remove-term":
      return ["moderator:manage:blocked_terms"];
    case "community":
      return ["moderator:read:chatters"];
    case "rewards":
      return ["channel:read:redemptions"];
    case "reward-decision":
      return ["channel:manage:redemptions"];
    case "raid-targets":
      return [];
    case "raid":
    case "cancel-raid":
      return ["channel:manage:raids"];
    case "suspicious-status":
      return ["moderator:manage:suspicious_users"];
    case "whisper":
      return ["user:manage:whispers"];
  }
}
export function moderationFeedScopes(feed: FeedKind): readonly string[] {
  switch (feed) {
    case "automod":
      return ["moderator:manage:automod"];
    case "actions":
      return [
        "moderator:read:blocked_terms",
        "moderator:read:chat_settings",
        "moderator:read:unban_requests",
        "moderator:read:banned_users",
        "moderator:read:chat_messages",
        "moderator:read:warnings",
        "moderator:read:moderators",
        "moderator:read:vips",
      ];
    case "activity":
      return ["moderator:read:followers"];
    case "suspicious":
      return ["moderator:read:suspicious_users"];
    case "rewards":
      return ["channel:read:redemptions"];
    case "whispers":
      return ["user:read:whispers"];
  }
}
export function acceptedScopes(
  scopes: readonly string[],
  granted: readonly string[],
): readonly string[] {
  return scopes.map((scope) => {
    const alternate = scope.replace(":read:", ":manage:");
    return !granted.includes(scope) && granted.includes(alternate)
      ? alternate
      : scope;
  });
}
export function broadcasterTool(
  tool: ChannelTool | ChannelToolCommand,
): boolean {
  const kind = typeof tool === "string" ? tool : tool.kind;
  return (
    kind === "stream-info" ||
    kind === "rewards" ||
    kind === "reward-decision" ||
    kind === "raid" ||
    kind === "cancel-raid"
  );
}

export function toolCommandProblem(command: ChannelToolCommand): string | null {
  switch (command.kind) {
    case "stream-info":
      if (
        !command.value.title.trim() ||
        command.value.title.length > 140 ||
        (command.value.categoryId !== "" &&
          !/^\d+$/.test(command.value.categoryId)) ||
        !/^(?:[a-z]{2}|other)$/.test(command.value.language) ||
        command.value.tags.length > 10 ||
        command.value.tags.some((tag) => !/^[\p{L}\p{N}]{1,25}$/u.test(tag))
      )
        return "Check the title, numeric category ID, language, and up to 10 alphanumeric tags of 25 characters each.";
      return null;
    case "automod-policy": {
      const levels =
        command.value.overall === null
          ? Object.values(command.value.categories)
          : [command.value.overall];
      return levels.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 4,
      )
        ? null
        : "AutoMod levels must be whole numbers from 0 to 4.";
    }
    case "add-term":
      return command.text.trim().length >= 2 && command.text.length <= 500
        ? null
        : "Blocked terms must have 2 to 500 characters.";
    case "remove-term":
      return command.id ? null : "Select a blocked term.";
    case "raid":
      return /^\d+$/.test(command.targetId)
        ? null
        : "Select a live Twitch channel.";
    case "reward-decision":
      return command.rewardId && command.redemptionId
        ? null
        : "Select an eligible pending redemption.";
    case "suspicious-status":
      return /^\d+$/.test(command.userId) ? null : "Select a Twitch user.";
    case "whisper":
      return /^\d+$/.test(command.userId) &&
        command.text.trim().length > 0 &&
        command.text.length <= 500
        ? null
        : "Enter a numeric recipient ID and a message of up to 500 characters.";
    case "shield":
    case "cancel-raid":
      return null;
  }
}
