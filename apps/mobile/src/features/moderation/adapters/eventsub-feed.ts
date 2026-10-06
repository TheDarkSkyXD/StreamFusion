import { z } from "zod";
import type {
  FeedKind,
  ModerationFeedGateway,
  ObservedEvent,
} from "../capabilities/provider-tools";
import type {
  ModerationChannel,
  ProviderCredential,
} from "../capabilities/moderation";
import { moderationFeedScopes } from "../domain/provider-tool-policy";
import { createProviderRequest, object } from "./provider-request";

type Subscription = {
  readonly type: string;
  readonly version: "1" | "2";
  readonly condition: Readonly<Record<string, string>>;
};
export function feedSubscriptions(
  channel: ModerationChannel,
  credential: ProviderCredential,
  feed: FeedKind,
): readonly Subscription[] {
  const channelCondition = { broadcaster_user_id: channel.id };
  const moderatorCondition = {
    ...channelCondition,
    moderator_user_id: credential.userId,
  };
  const spec = (
    type: string,
    version: "1" | "2",
    condition: Subscription["condition"],
  ): Subscription => ({ type, version, condition });
  switch (feed) {
    case "automod":
      return [
        spec("automod.message.hold", "2", moderatorCondition),
        spec("automod.message.update", "2", moderatorCondition),
      ];
    case "actions":
      return [spec("channel.moderate", "2", moderatorCondition)];
    case "suspicious":
      return [
        spec("channel.suspicious_user.message", "1", moderatorCondition),
        spec("channel.suspicious_user.update", "1", moderatorCondition),
      ];
    case "whispers":
      return [
        spec("user.whisper.message", "1", { user_id: credential.userId }),
      ];
    case "rewards":
      return [
        spec(
          "channel.channel_points_custom_reward_redemption.add",
          "1",
          channelCondition,
        ),
        spec(
          "channel.channel_points_custom_reward_redemption.update",
          "1",
          channelCondition,
        ),
      ];
    case "activity":
      return [
        spec("channel.follow", "2", moderatorCondition),
        spec("stream.online", "1", channelCondition),
        spec("stream.offline", "1", channelCondition),
        spec("channel.raid", "1", { to_broadcaster_user_id: channel.id }),
        ...(credential.userId === channel.id &&
        credential.scopes.includes("channel:read:subscriptions")
          ? [
              spec("channel.subscribe", "1", channelCondition),
              spec("channel.subscription.gift", "1", channelCondition),
              spec("channel.subscription.message", "1", channelCondition),
            ]
          : []),
        ...(credential.userId === channel.id &&
        credential.scopes.includes("bits:read")
          ? [spec("channel.cheer", "1", channelCondition)]
          : []),
      ];
  }
}
const envelope = z.object({
  metadata: z.object({
    message_id: z.string(),
    message_type: z.string(),
    message_timestamp: z
      .string()
      .refine((value) => Number.isFinite(Date.parse(value))),
  }),
  payload: z.object({
    session: z
      .object({
        id: z.string(),
        keepalive_timeout_seconds: z.number().nullable().optional(),
        reconnect_url: z.string().nullable().optional(),
      })
      .optional(),
    subscription: z
      .object({ type: z.string(), status: z.string().optional() })
      .optional(),
    event: z.unknown().optional(),
  }),
});
const user = z.object({ user_id: z.string(), user_name: z.string() });
const enabledSubscription = z.object({
  data: z
    .array(z.object({ id: z.string(), status: z.literal("enabled") }))
    .min(1),
});
export function parseObservedEvent(
  value: unknown,
  channel: ModerationChannel,
  actorId: string,
): ObservedEvent | null {
  const parsed = envelope.safeParse(value);
  if (!parsed.success || parsed.data.metadata.message_type !== "notification")
    return null;
  const { metadata, payload } = parsed.data;
  const event = object(payload.event);
  if (!event || !payload.subscription) return null;
  const type = payload.subscription.type;
  if (
    type === "user.whisper.message"
      ? event.to_user_id !== actorId
      : type === "channel.raid"
        ? event.to_broadcaster_user_id !== channel.id
        : event.broadcaster_user_id !== channel.id
  )
    return null;
  const base: ObservedEvent = {
    id: metadata.message_id,
    occurredAt: metadata.message_timestamp,
    userId: null,
    name: "Channel",
    detail: "",
    action: type,
    messageId: null,
    rewardId: null,
    redemptionId: null,
    status: null,
  };
  if (type === "user.whisper.message") {
    const row = z
      .object({
        from_user_id: z.string(),
        from_user_name: z.string(),
        whisper: z.object({ text: z.string() }),
      })
      .safeParse(event);
    return row.success
      ? {
          ...base,
          userId: row.data.from_user_id,
          name: row.data.from_user_name,
          detail: row.data.whisper.text,
        }
      : null;
  }
  if (type === "automod.message.hold" || type === "automod.message.update") {
    const row = user
      .extend({
        message_id: z.string(),
        message: z.object({ text: z.string() }),
        status: z.string().optional(),
      })
      .safeParse(event);
    return row.success
      ? {
          ...base,
          userId: row.data.user_id,
          name: row.data.user_name,
          detail: row.data.message.text,
          messageId: row.data.message_id,
          status:
            type === "automod.message.hold"
              ? "held"
              : (row.data.status ?? "updated"),
        }
      : null;
  }
  if (type === "channel.moderate") {
    if (
      typeof event.action !== "string" ||
      typeof event.moderator_user_name !== "string"
    )
      return null;
    const target = object(event[event.action]);
    return {
      ...base,
      action: event.action,
      name: event.moderator_user_name,
      userId: typeof target?.user_id === "string" ? target.user_id : null,
      detail: [
        typeof target?.user_name === "string" ? target.user_name : "",
        typeof target?.reason === "string" ? target.reason : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (type.startsWith("channel.suspicious_user.")) {
    const row = user
      .extend({
        low_trust_status: z.string(),
        message: z
          .object({ message_id: z.string(), text: z.string() })
          .optional(),
      })
      .safeParse(event);
    return row.success
      ? {
          ...base,
          userId: row.data.user_id,
          name: row.data.user_name,
          detail: row.data.message?.text ?? row.data.low_trust_status,
          status: row.data.low_trust_status,
          messageId: row.data.message?.message_id ?? null,
        }
      : null;
  }
  if (type.startsWith("channel.channel_points_custom_reward_redemption.")) {
    const row = user
      .extend({
        id: z.string(),
        user_input: z.string(),
        status: z.string(),
        reward: z.object({ id: z.string(), title: z.string() }),
      })
      .safeParse(event);
    return row.success
      ? {
          ...base,
          userId: row.data.user_id,
          name: row.data.user_name,
          detail: `${row.data.reward.title} · ${row.data.user_input}`,
          rewardId: row.data.reward.id,
          redemptionId: row.data.id,
          status: row.data.status,
        }
      : null;
  }
  if (type === "channel.raid") {
    const row = z
      .object({
        from_broadcaster_user_id: z.string(),
        from_broadcaster_user_name: z.string(),
        viewers: z.number(),
      })
      .safeParse(event);
    return row.success
      ? {
          ...base,
          userId: row.data.from_broadcaster_user_id,
          name: row.data.from_broadcaster_user_name,
          detail: `${row.data.viewers} viewers`,
        }
      : null;
  }
  if (type === "stream.online" || type === "stream.offline")
    return {
      ...base,
      name: channel.name,
      detail: type === "stream.online" ? "Stream started" : "Stream ended",
    };
  const parsedUser = user.safeParse(event);
  if (
    (type === "channel.follow" ||
      type === "channel.subscribe" ||
      type === "channel.subscription.message") &&
    !parsedUser.success
  )
    return null;
  const message = object(event.message);
  return {
    ...base,
    userId: parsedUser.success ? parsedUser.data.user_id : null,
    name: parsedUser.success ? parsedUser.data.user_name : "Anonymous",
    detail:
      typeof message?.text === "string"
        ? message.text
        : typeof event.message === "string"
          ? event.message
          : typeof event.total === "number"
            ? `${event.total} subscriptions`
            : typeof event.bits === "number"
              ? `${event.bits} Bits`
              : type.replace("channel.", "").replaceAll(".", " "),
  };
}

export function createEventSubFeed({
  fetch = globalThis.fetch,
  createSocket = (url) => new WebSocket(url),
  now = () => new Date().toISOString(),
}: {
  readonly fetch?: typeof globalThis.fetch;
  readonly createSocket?: (
    url: string,
  ) => Pick<WebSocket, "onmessage" | "onerror" | "onclose" | "close">;
  readonly now?: () => string;
} = {}): ModerationFeedGateway {
  const request = createProviderRequest(fetch);
  return {
    async subscribe(channel, credential, feed, receive, signal) {
      if (channel.platform !== "twitch") {
        receive({
          kind: "failure",
          detail:
            "Kick does not publish this live feed through its official API. Open the Kick channel for its available tools.",
        });
        return;
      }
      const since = now();
      let items: readonly ObservedEvent[] = [];
      let stopped = false;
      let registered = false;
      let socket: ReturnType<typeof createSocket> | null = null;
      const sockets = new Set<ReturnType<typeof createSocket>>();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const seen = new Set<string>();
      function shutdown() {
        if (timer) clearTimeout(timer);
        timer = null;
        for (const item of sockets) item.close();
        sockets.clear();
      }
      function disconnected() {
        if (stopped || signal.aborted) return;
        stopped = true;
        receive({ kind: "disconnected", since, items });
        shutdown();
      }
      function keepalive(seconds: number) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(disconnected, (seconds + 2) * 1000);
      }
      function connect(url: string, reconnect: boolean) {
        if (stopped || signal.aborted) return;
        const next = createSocket(url);
        sockets.add(next);
        let timeout = 30;
        keepalive(timeout);
        next.onmessage = async (message) => {
          if (stopped || signal.aborted || typeof message.data !== "string")
            return;
          let raw: unknown;
          try {
            raw = JSON.parse(message.data);
          } catch {
            return;
          }
          const parsed = envelope.safeParse(raw);
          if (!parsed.success) return;
          const { metadata, payload } = parsed.data;
          if (metadata.message_type === "session_welcome" && payload.session) {
            timeout = payload.session.keepalive_timeout_seconds ?? 30;
            keepalive(timeout);
            if (reconnect) {
              const old = socket;
              socket = next;
              if (old && old !== next) {
                sockets.delete(old);
                old.close();
              }
              receive({ kind: "live", since, items });
              return;
            }
            socket = next;
            const results = await Promise.all(
              feedSubscriptions(channel, credential, feed).map((spec) =>
                request({
                  credential,
                  signal,
                  method: "POST",
                  path: "/eventsub/subscriptions",
                  body: {
                    ...spec,
                    transport: {
                      method: "websocket",
                      session_id: payload.session?.id,
                    },
                  },
                }),
              ),
            );
            if (stopped || signal.aborted) return;
            const failed = results.find((result) => result.kind === "failure");
            if (failed?.kind === "failure") {
              stopped = true;
              receive(
                failed.reason === "auth" || failed.reason === "permission"
                  ? {
                      kind: "permission",
                      detail: failed.detail,
                      scopes: moderationFeedScopes(feed),
                    }
                  : { kind: "failure", detail: failed.detail },
              );
              shutdown();
              return;
            }
            if (
              results.some(
                (result) =>
                  result.kind === "success" &&
                  !enabledSubscription.safeParse(result.value).success,
              )
            ) {
              stopped = true;
              receive({
                kind: "failure",
                detail: "Twitch did not return an enabled feed subscription.",
              });
              shutdown();
              return;
            }
            registered = true;
            receive({ kind: "live", since, items });
            return;
          }
          if (metadata.message_type === "session_reconnect") {
            const url = payload.session?.reconnect_url;
            if (url && /^wss:\/\/eventsub\.wss\.twitch\.tv(?:\/|\?)/.test(url))
              connect(url, true);
            else disconnected();
            return;
          }
          if (metadata.message_type === "revocation") {
            stopped = true;
            receive({
              kind: "permission",
              detail:
                "Twitch revoked this feed subscription. Reconnect or grant its permissions.",
              scopes: moderationFeedScopes(feed),
            });
            shutdown();
            return;
          }
          keepalive(timeout);
          if (
            metadata.message_type !== "notification" ||
            seen.has(metadata.message_id)
          )
            return;
          const event = parseObservedEvent(raw, channel, credential.userId);
          if (
            !event ||
            !feedSubscriptions(channel, credential, feed).some(
              (spec) => spec.type === payload.subscription?.type,
            )
          )
            return;
          seen.add(metadata.message_id);
          if (seen.size > 1000) {
            const first = seen.values().next().value;
            if (first) seen.delete(first);
          }
          items =
            feed === "automod" && event.messageId
              ? [
                  event,
                  ...items.filter((item) => item.messageId !== event.messageId),
                ]
                  .filter((item) => item.status === "held")
                  .slice(0, 200)
              : [event, ...items].slice(0, 200);
          if (registered) receive({ kind: "live", since, items });
        };
        next.onclose = () => {
          sockets.delete(next);
          if (socket === next || socket === null) disconnected();
        };
        next.onerror = () => {
          if (socket === next || socket === null) disconnected();
        };
      }
      receive({ kind: "connecting" });
      signal.addEventListener(
        "abort",
        () => {
          stopped = true;
          shutdown();
        },
        { once: true },
      );
      try {
        connect(
          "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30",
          false,
        );
      } catch {
        disconnected();
      }
    },
  };
}
