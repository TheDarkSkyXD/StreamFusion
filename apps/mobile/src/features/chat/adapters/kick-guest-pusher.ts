import {
  kickChatroomId,
  kickPublicChannelUrl,
} from "@mobile/features/discovery/adapters/kick/kick-public-catalog";
import { requestInit } from "@mobile/features/discovery/utils/optional";

import type {
  WatchChatConnectInput,
  WatchChatMessage,
  WatchChatSocketFactory,
} from "../capabilities/watch-chat";
import { parseKickChatFrame } from "../domain/watch-chat-messages";

const PUSHER_URL =
  "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false";

export async function connectKickGuestChat(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly onClose: () => void;
  readonly onError: (detail: string) => void;
  readonly onMessage: (message: WatchChatMessage) => void;
  readonly onOpen: () => void;
  readonly signal: AbortSignal;
  readonly socketFactory: WatchChatSocketFactory;
  readonly target: WatchChatConnectInput;
}): Promise<() => void> {
  const chatroomId = await readKickChatroomId(input);
  if (chatroomId === "") {
    input.onError("Kick chatroom id was missing from the public channel read.");
    return () => undefined;
  }
  if (input.signal.aborted) return () => undefined;
  const socket = input.socketFactory(PUSHER_URL);
  const channel = `chatrooms.${chatroomId}.v2`;
  socket.onopen = () => undefined;
  socket.onmessage = (event) => {
    const frame = parseJson(event.data);
    if (frame === null) return;
    if (frame.event === "pusher:connection_established") {
      socket.send(
        JSON.stringify({
          event: "pusher:subscribe",
          data: { auth: "", channel },
        }),
      );
      input.onOpen();
      return;
    }
    if (frame.event === "pusher:ping") {
      socket.send(JSON.stringify({ event: "pusher:pong", data: {} }));
      return;
    }
    if (frame.event !== "App\\Events\\ChatMessageEvent") return;
    const payload =
      typeof frame.data === "string" ? parseJson(frame.data) : frame.data;
    const message = parseKickChatFrame(payload);
    if (message) input.onMessage(message);
  };
  socket.onerror = () => {
    input.onError("Kick chat closed before messages arrived.");
  };
  socket.onclose = () => {
    input.onClose();
  };
  return () => socket.close();
}

async function readKickChatroomId(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal;
  readonly target: WatchChatConnectInput;
}): Promise<string> {
  try {
    const response = await input.fetch(
      kickPublicChannelUrl(input.target.channelName),
      requestInit({ Accept: "application/json" }, input.signal),
    );
    if (!response.ok) return "";
    return kickChatroomId(await response.json());
  } catch {
    return "";
  }
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
