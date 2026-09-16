import type {
  WatchChatConnectInput,
  WatchChatMessage,
  WatchChatSocketFactory,
} from "../capabilities/watch-chat";
import { parseTwitchPrivmsg } from "../domain/watch-chat-messages";

const TWITCH_IRC = "wss://irc-ws.chat.twitch.tv:443";

export function connectTwitchGuestIrc(input: {
  readonly onClose: () => void;
  readonly onError: (detail: string) => void;
  readonly onMessage: (message: WatchChatMessage) => void;
  readonly onOpen: () => void;
  readonly socketFactory: WatchChatSocketFactory;
  readonly target: WatchChatConnectInput;
}): () => void {
  const nick = `justinfan${Math.floor(1_000 + Math.random() * 8_000)}`;
  const socket = input.socketFactory(TWITCH_IRC);
  const channel = input.target.channelName.replace(/^#/, "").toLowerCase();
  socket.onopen = () => {
    socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
    socket.send("PASS SCHMOOPIIE");
    socket.send(`NICK ${nick}`);
    socket.send(`JOIN #${channel}`);
    input.onOpen();
  };
  socket.onmessage = (event) => {
    for (const line of event.data.split("\n")) {
      const trimmed = line.replace(/\r$/, "");
      if (trimmed.startsWith("PING ")) {
        socket.send(`PONG ${trimmed.slice(5)}`);
        continue;
      }
      const message = parseTwitchPrivmsg(trimmed);
      if (message) input.onMessage(message);
    }
  };
  socket.onerror = () => {
    input.onError("Twitch chat closed before messages arrived.");
  };
  socket.onclose = () => {
    input.onClose();
  };
  return () => socket.close();
}
