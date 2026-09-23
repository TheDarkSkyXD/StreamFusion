import type {
  WatchChatConnectInput,
  WatchChatMessage,
  WatchChatSocket,
  WatchChatSocketFactory,
} from "../capabilities/watch-chat";
import { parseTwitchPrivmsg } from "../domain/watch-chat-messages";

const TWITCH_IRC = "wss://irc-ws.chat.twitch.tv:443";
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000] as const;

/**
 * Anonymous Twitch IRC (justinfan) over WSS — same guest path desktop uses via tmi.js.
 * Read-only: PASS SCHMOOPIIE + justinfan nick, JOIN #login, parse tagged PRIVMSG.
 */
export function connectTwitchGuestIrc(input: {
  readonly onClose: () => void;
  readonly onError: (detail: string) => void;
  readonly onMessage: (message: WatchChatMessage) => void;
  readonly onOpen: () => void;
  readonly socketFactory: WatchChatSocketFactory;
  readonly target: WatchChatConnectInput;
}): () => void {
  const channel = normalizeTwitchLogin(input.target.channelName);
  if (channel === "") {
    input.onError("Twitch chat needs a channel login to join.");
    return () => undefined;
  }

  let disposed = false;
  let socket: WatchChatSocket | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let opened = false;
  let buffer = "";

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (disposed) return;
    clearReconnect();
    const delay =
      RECONNECT_DELAYS_MS[
        Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
      ] ?? 15_000;
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  };

  const handleLine = (line: string) => {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed === "") return;
    if (trimmed.startsWith("PING ")) {
      socket?.send(`PONG ${trimmed.slice(5)}`);
      return;
    }
    const message = parseTwitchPrivmsg(trimmed);
    if (message) input.onMessage(message);
  };

  const openSocket = () => {
    if (disposed) return;
    buffer = "";
    const nick = `justinfan${Math.floor(1_000 + Math.random() * 80_000)}`;
    const next = input.socketFactory(TWITCH_IRC);
    socket = next;
    next.onopen = () => {
      opened = true;
      reconnectAttempt = 0;
      next.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      next.send("PASS SCHMOOPIIE");
      next.send(`NICK ${nick}`);
      next.send(`JOIN #${channel}`);
      input.onOpen();
    };
    next.onmessage = (event) => {
      const chunk = socketDataToString(event.data);
      if (chunk === "") return;
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) handleLine(part);
      if (buffer.includes("PRIVMSG ") || buffer.startsWith("PING ")) {
        handleLine(buffer);
        buffer = "";
      }
    };
    next.onerror = () => {
      if (disposed || opened) return;
      input.onError("Twitch chat closed before messages arrived.");
    };
    next.onclose = () => {
      const wasOpen = opened;
      opened = false;
      socket = null;
      if (disposed) {
        input.onClose();
        return;
      }
      if (wasOpen) {
        scheduleReconnect();
        return;
      }
      input.onClose();
    };
  };

  openSocket();

  return () => {
    disposed = true;
    clearReconnect();
    const current = socket;
    socket = null;
    current?.close();
  };
}

export function normalizeTwitchLogin(channelName: string): string {
  return channelName.trim().replace(/^#/, "").toLowerCase();
}

function socketDataToString(data: unknown): string {
  if (typeof data === "string") return data;
  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return "";
}
