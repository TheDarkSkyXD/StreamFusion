import {
  kickChatroomId,
  kickPublicChannelUrl,
} from "@mobile/features/discovery/adapters/kick/kick-public-catalog";
import { requestInit } from "@mobile/features/discovery/utils/optional";

import type {
  WatchChatConnectInput,
  WatchChatMessage,
  WatchChatEvent,
  WatchChatSocket,
  WatchChatSocketFactory,
} from "../capabilities/watch-chat";
import { parseKickChatFrame } from "../domain/watch-chat-messages";
import { parseKickChatEvent } from "../domain/watch-chat-events";
import { getBundledBadgeUrl } from "../utils/kick-badge-assets";

const REALTIME_URL = "https://web.kick.com/api/v1/realtime/connection";
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000] as const;

export async function connectKickGuestChat(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly onClose: () => void;
  readonly onError: (detail: string) => void;
  readonly onMessage: (message: WatchChatMessage) => void;
  readonly onEvent?: (event: WatchChatEvent) => void;
  readonly onOpen: () => void;
  readonly randomUuid: () => string;
  readonly signal: AbortSignal;
  readonly socketFactory: WatchChatSocketFactory;
  readonly target: WatchChatConnectInput;
}): Promise<() => void> {
  if (input.signal.aborted) return () => undefined;
  let chatroomId = "";
  let disposed = false;
  let socket: WatchChatSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  const scheduleReconnect = (failedSocket: WatchChatSocket | null) => {
    if (disposed || input.signal.aborted || socket !== failedSocket) return;
    socket = null;
    failedSocket?.close();
    input.onClose();
    const delay = RECONNECT_DELAYS_MS[
      Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ];
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void openSocket();
    }, delay);
  };
  const openSocket = async () => {
    try {
      if (chatroomId === "") chatroomId = await readKickChatroomId(input);
      if (disposed || input.signal.aborted) return;
      if (chatroomId === "") {
        input.onError("Kick chatroom id was missing from the public channel read.");
        return;
      }
      const channel = `chatrooms.${chatroomId}.v2`;
      const endpoint = await readKickRealtimeEndpoint(input);
      if (disposed || input.signal.aborted) return;
      const next = input.socketFactory(endpoint);
      socket = next;
      let subscribed = false;
      next.onopen = () => undefined;
      next.onmessage = (event) => {
        if (disposed || input.signal.aborted || socket !== next || event.data.length > 65_536) return;
        const frame = parseJson(event.data);
        if (frame === null) return;
        if (frame.event === "pusher:connection_established") {
          next.send(JSON.stringify({ event: "pusher:subscribe", data: { auth: "", channel } }));
          return;
        }
        if (frame.event === "pusher:ping") {
          next.send(JSON.stringify({ event: "pusher:pong", data: {} }));
          return;
        }
        if (
          frame.event === "pusher:error" ||
          (frame.event === "pusher:subscription_error" &&
            (frame.channel === undefined || frame.channel === channel))
        ) {
          scheduleReconnect(next);
          return;
        }
        if (frame.channel !== channel) return;
        if (
          frame.event === "pusher_internal:subscription_succeeded" ||
          frame.event === "pusher:subscription_succeeded"
        ) {
          if (!subscribed) {
            subscribed = true;
            reconnectAttempt = 0;
            input.onOpen();
          }
          return;
        }
        if (!subscribed) return;
        const payload = typeof frame.data === "string" ? parseJson(frame.data) : frame.data;
        if (frame.event === "App\\Events\\ChatMessageEvent") {
          const message = parseKickChatFrame(payload, getBundledBadgeUrl);
          if (message) {
            if (input.onEvent) input.onEvent({ kind: "message", message });
            else input.onMessage(message);
          }
          return;
        }
        if (typeof frame.event !== "string") return;
        const chatEvent = parseKickChatEvent(frame.event, payload);
        if (chatEvent) input.onEvent?.(chatEvent);
      };
      next.onerror = () => scheduleReconnect(next);
      next.onclose = () => scheduleReconnect(next);
    } catch {
      scheduleReconnect(null);
    }
  };
  const close = () => {
    disposed = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const current = socket;
    socket = null;
    current?.close();
  };
  input.signal.addEventListener("abort", close, { once: true });
  await openSocket();
  return () => {
    input.signal.removeEventListener("abort", close);
    close();
  };
}

async function readKickRealtimeEndpoint(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly randomUuid: () => string;
  readonly signal: AbortSignal;
}): Promise<string> {
  const response = await input.fetch(REALTIME_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://kick.com",
      Referer: "https://kick.com/",
    },
    body: JSON.stringify({
      client: { id: input.randomUuid(), type: "web" },
      capabilities: { accepted_providers: [{ provider: "pusher" }] },
    }),
    cache: "no-store",
    credentials: "omit",
    signal: input.signal,
  });
  if (!response.ok) throw new Error("Kick realtime negotiation failed.");
  const payload: unknown = await response.json();
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  if (data?.mode !== "websocket" || !Array.isArray(data.connections))
    throw new Error("Kick realtime response was invalid.");
  for (const candidate of data.connections) {
    const connection = asRecord(candidate);
    if (connection?.provider !== "pusher") continue;
    const credentials = asRecord(connection.credentials);
    const key = credentials?.app_key;
    const cluster = credentials?.cluster;
    if (
      typeof key === "string" &&
      /^[a-zA-Z0-9]{1,128}$/.test(key) &&
      typeof cluster === "string" &&
      /^[a-z0-9-]{1,32}$/.test(cluster)
    )
      return `wss://ws-${cluster}.pusher.com/app/${key}?protocol=7&client=js&version=8.4.0&flash=false`;
  }
  throw new Error("Kick realtime response was invalid.");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readKickChatroomId(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal;
  readonly target: WatchChatConnectInput;
}): Promise<string> {
  const response = await input.fetch(
    kickPublicChannelUrl(input.target.channelName),
    requestInit({ Accept: "application/json" }, input.signal),
  );
  if (!response.ok) throw new Error("Kick public channel read failed.");
  return kickChatroomId(await response.json());
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
