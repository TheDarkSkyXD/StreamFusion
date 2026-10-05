import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type {
  ChatCommands,
  ChatCommandResult,
} from "../capabilities/chat-interactions";
import { array, object, string } from "../utils/provider-json";

export function createPlatformChatCommands(input: {
  readonly access: AuthenticatedPlatformAccess;
  readonly fetch: typeof globalThis.fetch;
  readonly openUrl: (url: string) => Promise<void>;
}): ChatCommands {
  return {
    subscribe: (listener) => input.access.subscribe(listener),
    async access(target) {
      const access = await input.access.read(target.platform, [
        ...(target.platform === "twitch"
          ? ["user:write:chat"]
          : ["chat:write", "channel:read"]),
      ]);
      return access.kind === "ready"
        ? { allowed: true, detail: `Chatting as ${access.username}.` }
        : { allowed: false, detail: access.detail };
    },
    async send(target, text, replyId, signal) {
      const access = await input.access.read(target.platform, [
        ...(target.platform === "twitch"
          ? ["user:write:chat"]
          : ["chat:write", "channel:read"]),
      ]);
      if (access.kind === "blocked")
        return { kind: "blocked", detail: access.detail };
      if (signal.aborted)
        return { kind: "blocked", detail: "The account or channel changed." };
      const twitch = target.platform === "twitch";
      if (twitch && !/^\d+$/.test(target.channelId))
        return {
          kind: "blocked",
          detail: "Chat needs the broadcaster's platform user ID.",
        };
      if (new TextEncoder().encode(text).length > 2048)
        return {
          kind: "blocked",
          detail: "The message exceeds the platform's byte limit.",
        };
      try {
        let broadcaster = 0;
        if (!twitch) {
          const channelResponse = await input.fetch(
            `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(target.channelName)}`,
            {
              signal,
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${access.accessToken}`,
              },
            },
          );
          if (!channelResponse.ok)
            return {
              kind: "failed",
              detail: "Kick could not resolve the broadcaster's user ID.",
            };
          const channel = object(
            array(object(await channelResponse.json()).data)[0],
          );
          broadcaster = Number(channel.broadcaster_user_id);
          if (!Number.isSafeInteger(broadcaster) || broadcaster <= 0)
            return {
              kind: "failed",
              detail: "Kick did not provide the broadcaster's user ID.",
            };
        }
        if (signal.aborted)
          return { kind: "blocked", detail: "The account or channel changed." };
        const response = await input.fetch(
          twitch
            ? "https://api.twitch.tv/helix/chat/messages"
            : "https://api.kick.com/public/v1/chat",
          {
            method: "POST",
            signal,
            headers: {
              Authorization: `Bearer ${access.accessToken}`,
              "Content-Type": "application/json",
              ...(twitch ? { "Client-Id": access.clientId } : {}),
            },
            body: JSON.stringify(
              twitch
                ? {
                    broadcaster_id: target.channelId,
                    sender_id: access.userId,
                    message: text,
                    ...(replyId ? { reply_parent_message_id: replyId } : {}),
                  }
                : {
                    broadcaster_user_id: broadcaster,
                    type: "user",
                    content: text,
                    ...(replyId ? { reply_to_message_id: replyId } : {}),
                  },
            ),
          },
        );
        if (!response.ok)
          return {
            kind: "failed",
            detail:
              response.status === 429
                ? "Chat is rate limited. Wait before sending again."
                : `Message rejected (${response.status}).`,
          };
        const body = object(await response.json());
        const result = object(twitch ? array(body.data)[0] : body.data);
        if (result.is_sent === false)
          return {
            kind: "failed",
            detail:
              string(object(result.drop_reason).message) ||
              "The platform did not accept this message.",
          };
        const messageId = string(result.message_id);
        if (result.is_sent !== true || !messageId)
          return {
            kind: "uncertain",
            detail:
              "The platform returned no delivery receipt. Check chat before trying again.",
          };
        return { kind: "sent", messageId };
      } catch {
        return {
          kind: "uncertain",
          detail:
            "Delivery could not be confirmed. Check chat before trying again.",
        };
      }
    },
    async userAction(
      target,
      message,
      action,
      signal,
    ): Promise<ChatCommandResult> {
      if (
        action === "block" &&
        target.platform === "twitch" &&
        message.userId
      ) {
        const access = await input.access.read("twitch", [
          "user:manage:blocked_users",
        ]);
        if (access.kind === "blocked")
          return { kind: "blocked", detail: access.detail };
        if (signal.aborted)
          return { kind: "blocked", detail: "The account or channel changed." };
        try {
          const response = await input.fetch(
            `https://api.twitch.tv/helix/users/blocks?target_user_id=${encodeURIComponent(message.userId)}`,
            {
              method: "PUT",
              signal,
              headers: {
                Authorization: `Bearer ${access.accessToken}`,
                "Client-Id": access.clientId,
              },
            },
          );
          return response.ok
            ? { kind: "completed" }
            : {
                kind: "failed",
                detail: `Blocking failed (${response.status}).`,
              };
        } catch {
          return { kind: "failed", detail: "Blocking could not be confirmed." };
        }
      }
      const username = message.username ?? message.displayName;
      try {
        await input.openUrl(
          target.platform === "twitch"
            ? `https://www.twitch.tv/${encodeURIComponent(username)}`
            : `https://kick.com/${encodeURIComponent(username)}`,
        );
        return {
          kind: "blocked",
          detail: `Complete ${action === "report" ? "reporting" : "blocking"} in the platform's user menu.`,
        };
      } catch {
        return {
          kind: "failed",
          detail: "The platform user page could not be opened.",
        };
      }
    },
  };
}
