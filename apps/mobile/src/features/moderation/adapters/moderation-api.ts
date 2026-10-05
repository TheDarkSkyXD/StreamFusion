import type {
  BannedPage,
  ChatSettings,
  ModerationChannel,
  ModerationCommand,
  ModerationGateway,
  ProviderCredential,
  ProviderResult,
  ReviewItem,
  ReviewPage,
  ReviewTool,
} from "../capabilities/moderation";
import {
  createProviderRequest,
  malformed,
  object,
  rows,
} from "./provider-request";

export function createModerationApi({
  fetch = globalThis.fetch,
}: { readonly fetch?: typeof globalThis.fetch } = {}): ModerationGateway {
  const request = createProviderRequest(fetch);
  const unsupported = (detail: string): ProviderResult<never> => ({
    kind: "failure",
    reason: "unsupported",
    detail,
  });
  async function channels(
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<readonly ModerationChannel[]>> {
    const own: ModerationChannel = {
      platform: credential.platform,
      id: credential.userId,
      login: credential.username,
      name: credential.username,
    };
    if (credential.platform === "kick") {
      const result = await request({
        credential,
        signal,
        path: `/channels?broadcaster_user_id=${encodeURIComponent(credential.userId)}`,
      });
      if (result.kind === "failure") return result;
      const data = rows(result.value);
      if (!data) return malformed();
      const verified = data.some(
        (item) =>
          String(object(item)?.broadcaster_user_id) === credential.userId,
      );
      return verified
        ? { kind: "success", value: [own] }
        : unsupported(
            "Kick could not verify your broadcaster channel. Open Kick to moderate another channel.",
          );
    }
    const all: ModerationChannel[] = [own];
    const seen = new Set<string>();
    let cursor = "";
    do {
      const result = await request({
        credential,
        signal,
        path: `/moderation/channels?user_id=${encodeURIComponent(credential.userId)}&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
      });
      if (result.kind === "failure") return result;
      const data = rows(result.value);
      if (!data) return malformed();
      for (const item of data) {
        const row = object(item);
        if (
          !row ||
          typeof row.broadcaster_id !== "string" ||
          typeof row.broadcaster_login !== "string" ||
          typeof row.broadcaster_name !== "string"
        )
          return malformed();
        if (!all.some((channel) => channel.id === row.broadcaster_id))
          all.push({
            platform: "twitch",
            id: row.broadcaster_id,
            login: row.broadcaster_login,
            name: row.broadcaster_name,
          });
      }
      const next = object(object(result.value)?.pagination)?.cursor;
      if (next !== undefined && typeof next !== "string") return malformed();
      cursor = typeof next === "string" ? next : "";
      if (cursor && seen.has(cursor)) return malformed();
      seen.add(cursor);
    } while (cursor && !signal.aborted);
    return { kind: "success", value: all };
  }
  async function verify(
    channel: ModerationChannel,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<"broadcaster" | "moderator">> {
    if (channel.platform !== credential.platform)
      return unsupported(
        "The selected channel belongs to a different provider.",
      );
    if (channel.id === credential.userId && channel.platform === "twitch")
      return { kind: "success", value: "broadcaster" };
    const result = await channels(credential, signal);
    if (result.kind === "failure") return result;
    return result.value.some((item) => item.id === channel.id)
      ? {
          kind: "success",
          value: channel.id === credential.userId ? "broadcaster" : "moderator",
        }
      : {
          kind: "failure",
          reason: "permission",
          detail:
            "This account is not a verified moderator of this channel. Open the provider to check your role.",
        };
  }
  async function execute(
    channel: ModerationChannel,
    command: ModerationCommand,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<void>> {
    const query = `broadcaster_id=${encodeURIComponent(channel.id)}&moderator_id=${encodeURIComponent(credential.userId)}`;
    let result: ProviderResult<unknown>;
    if (channel.platform === "kick") {
      if (
        command.kind === "chat-settings" ||
        command.kind === "automod" ||
        command.kind === "membership" ||
        command.kind === "resolve-unban"
      )
        return unsupported(
          "Kick does not publish this moderation API. Open Kick to use this tool.",
        );
      if (command.kind === "delete-message")
        result = await request({
          credential,
          signal,
          method: "DELETE",
          path: `/chat/${encodeURIComponent(command.messageId)}`,
        });
      else {
        const broadcaster = Number(channel.id);
        const user = Number(command.userId);
        if (
          !Number.isSafeInteger(broadcaster) ||
          broadcaster <= 0 ||
          !Number.isSafeInteger(user) ||
          user <= 0
        )
          return {
            kind: "failure",
            reason: "invalid",
            detail: "Kick requires numeric broadcaster and user IDs.",
          };
        if (
          command.kind === "timeout" &&
          (command.durationSeconds % 60 !== 0 ||
            command.durationSeconds < 60 ||
            command.durationSeconds > 604800)
        )
          return {
            kind: "failure",
            reason: "invalid",
            detail:
              "Kick timeouts must be whole minutes, from 1 minute to 7 days.",
          };
        const body = {
          broadcaster_user_id: broadcaster,
          user_id: user,
          ...(command.kind === "unban"
            ? {}
            : {
                reason: command.reason,
                ...(command.kind === "timeout"
                  ? { duration: command.durationSeconds / 60 }
                  : {}),
              }),
        };
        result = await request({
          credential,
          signal,
          method: command.kind === "unban" ? "DELETE" : "POST",
          path: "/moderation/bans",
          body,
        });
      }
    } else {
      switch (command.kind) {
        case "ban":
        case "timeout":
          result = await request({
            credential,
            signal,
            method: "POST",
            path: `/moderation/bans?${query}`,
            body: {
              data: {
                user_id: command.userId,
                reason: command.reason,
                ...(command.kind === "timeout"
                  ? { duration: command.durationSeconds }
                  : {}),
              },
            },
          });
          break;
        case "unban":
          result = await request({
            credential,
            signal,
            method: "DELETE",
            path: `/moderation/bans?${query}&user_id=${encodeURIComponent(command.userId)}`,
          });
          break;
        case "delete-message":
          result = await request({
            credential,
            signal,
            method: "DELETE",
            path: `/moderation/chat?${query}&message_id=${encodeURIComponent(command.messageId)}`,
          });
          break;
        case "automod":
          result = await request({
            credential,
            signal,
            method: "POST",
            path: "/moderation/automod/message",
            body: {
              user_id: credential.userId,
              msg_id: command.messageId,
              action: command.action,
            },
          });
          break;
        case "resolve-unban":
          result = await request({
            credential,
            signal,
            method: "PATCH",
            path: `/moderation/unban_requests?${query}&unban_request_id=${encodeURIComponent(command.requestId)}&status=${command.status}&resolution_text=${encodeURIComponent(command.resolutionText)}`,
          });
          break;
        case "membership":
          if (channel.id !== credential.userId)
            return unsupported(
              "Only the Twitch broadcaster can change moderators and VIPs.",
            );
          result = await request({
            credential,
            signal,
            method: command.operation === "add" ? "POST" : "DELETE",
            path: `${command.group === "moderators" ? "/moderation/moderators" : "/channels/vips"}?broadcaster_id=${encodeURIComponent(channel.id)}&user_id=${encodeURIComponent(command.userId)}`,
          });
          break;
        case "chat-settings": {
          const s = command.settings;
          result = await request({
            credential,
            signal,
            method: "PATCH",
            path: `/chat/settings?${query}`,
            body: {
              slow_mode: s.slowMode,
              ...(s.slowMode ? { slow_mode_wait_time: s.slowSeconds } : {}),
              follower_mode: s.followersOnly,
              ...(s.followersOnly
                ? { follower_mode_duration: s.followerMinutes }
                : {}),
              subscriber_mode: s.subscribersOnly,
              emote_mode: s.emoteOnly,
              unique_chat_mode: s.uniqueChat,
            },
          });
          break;
        }
      }
    }
    return result.kind === "failure"
      ? result
      : { kind: "success", value: undefined };
  }
  async function settings(
    channel: ModerationChannel,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<ChatSettings>> {
    if (channel.platform !== "twitch")
      return unsupported("Open Kick to manage chat settings.");
    const result = await request({
      credential,
      signal,
      path: `/chat/settings?broadcaster_id=${encodeURIComponent(channel.id)}&moderator_id=${encodeURIComponent(credential.userId)}`,
    });
    if (result.kind === "failure") return result;
    const row = object(rows(result.value)?.[0]);
    if (
      !row ||
      typeof row.slow_mode !== "boolean" ||
      typeof row.follower_mode !== "boolean" ||
      typeof row.subscriber_mode !== "boolean" ||
      typeof row.emote_mode !== "boolean" ||
      typeof row.unique_chat_mode !== "boolean" ||
      (row.slow_mode_wait_time !== null &&
        typeof row.slow_mode_wait_time !== "number") ||
      (row.follower_mode_duration !== null &&
        typeof row.follower_mode_duration !== "number")
    )
      return malformed();
    return {
      kind: "success",
      value: {
        slowMode: row.slow_mode,
        slowSeconds:
          typeof row.slow_mode_wait_time === "number"
            ? row.slow_mode_wait_time
            : 30,
        followersOnly: row.follower_mode,
        followerMinutes:
          typeof row.follower_mode_duration === "number"
            ? row.follower_mode_duration
            : 0,
        subscribersOnly: row.subscriber_mode,
        emoteOnly: row.emote_mode,
        uniqueChat: row.unique_chat_mode,
      },
    };
  }
  async function banned(
    channel: ModerationChannel,
    cursor: string | null,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<BannedPage>> {
    if (channel.platform !== "twitch" || channel.id !== credential.userId)
      return unsupported(
        "The provider only exposes the banned-user list to the Twitch broadcaster. Open the provider to review it.",
      );
    const result = await request({
      credential,
      signal,
      path: `/moderation/banned?broadcaster_id=${encodeURIComponent(channel.id)}&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
    });
    if (result.kind === "failure") return result;
    const data = rows(result.value);
    if (!data) return malformed();
    const users = [];
    for (const item of data) {
      const row = object(item);
      if (
        !row ||
        typeof row.user_id !== "string" ||
        typeof row.user_name !== "string" ||
        typeof row.reason !== "string" ||
        typeof row.expires_at !== "string"
      )
        return malformed();
      users.push({
        id: row.user_id,
        name: row.user_name,
        reason: row.reason,
        expiresAt: row.expires_at,
      });
    }
    const next = object(object(result.value)?.pagination)?.cursor;
    if (next !== undefined && typeof next !== "string") return malformed();
    return {
      kind: "success",
      value: { users, cursor: typeof next === "string" && next ? next : null },
    };
  }
  async function review(
    channel: ModerationChannel,
    tool: ReviewTool,
    cursor: string | null,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<ReviewPage>> {
    if (
      channel.platform !== "twitch" ||
      (tool !== "unban-requests" && channel.id !== credential.userId)
    )
      return unsupported(
        "Open the provider to review this tool. Moderator and VIP lists require the Twitch broadcaster account.",
      );
    const query = `broadcaster_id=${encodeURIComponent(channel.id)}&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;
    const path =
      tool === "unban-requests"
        ? `/moderation/unban_requests?${query}&moderator_id=${encodeURIComponent(credential.userId)}&status=pending`
        : `${tool === "moderators" ? "/moderation/moderators" : "/channels/vips"}?${query}`;
    const result = await request({ credential, signal, path });
    if (result.kind === "failure") return result;
    const data = rows(result.value);
    if (!data) return malformed();
    const items: ReviewItem[] = [];
    for (const entry of data) {
      const row = object(entry);
      if (
        !row ||
        typeof row.user_id !== "string" ||
        typeof row.user_name !== "string"
      )
        return malformed();
      if (tool === "unban-requests") {
        if (
          typeof row.id !== "string" ||
          typeof row.text !== "string" ||
          row.status !== "pending"
        )
          return malformed();
        items.push({
          kind: "unban",
          id: row.id,
          userId: row.user_id,
          name: row.user_name,
          text: row.text,
        });
      } else
        items.push({
          kind: "member",
          userId: row.user_id,
          name: row.user_name,
        });
    }
    const next = object(object(result.value)?.pagination)?.cursor;
    if (next !== undefined && typeof next !== "string") return malformed();
    return {
      kind: "success",
      value: {
        tool,
        items,
        cursor: typeof next === "string" && next ? next : null,
      },
    };
  }
  return { channels, verify, execute, settings, banned, review };
}
