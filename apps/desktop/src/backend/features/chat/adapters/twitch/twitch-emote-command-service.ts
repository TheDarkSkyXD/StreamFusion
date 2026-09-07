import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";
import { z } from "zod";

import type { TwitchHelixRequest } from "../../capabilities/twitch-helix-request";

type TwitchEmoteCommand = Extract<
  TwitchApiCommand,
  { operation: "get-global-emotes" | "get-channel-emotes" | "get-emote-set" | "get-user-emotes" }
>;

const helixEnvelope = z
  .object({
    data: z.array(z.unknown()),
    pagination: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

function isTwitchEmoteCommand(command: TwitchApiCommand): command is TwitchEmoteCommand {
  return ["get-global-emotes", "get-channel-emotes", "get-emote-set", "get-user-emotes"].includes(
    command.operation
  );
}

function query(path: string, values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, value);
  }
  return `${path}?${params.toString()}`;
}

/** Executes only chat-emote commands; other Twitch commands stay untouched. */
export async function executeTwitchEmoteCommand(
  requestor: TwitchHelixRequest,
  command: TwitchApiCommand
): Promise<TwitchApiResult | null> {
  if (!isTwitchEmoteCommand(command)) return null;

  let endpoint: string;
  switch (command.operation) {
    case "get-global-emotes":
      endpoint = "/chat/emotes/global";
      break;
    case "get-channel-emotes":
      endpoint = query("/chat/emotes", { broadcaster_id: command.broadcasterId });
      break;
    case "get-emote-set":
      endpoint = query("/chat/emotes/set", { emote_set_id: command.emoteSetId });
      break;
    case "get-user-emotes":
      endpoint = query("/chat/emotes/user", { user_id: command.userId, after: command.after });
      break;
  }

  return { ok: true, data: helixEnvelope.parse(await requestor.request(endpoint)) };
}
