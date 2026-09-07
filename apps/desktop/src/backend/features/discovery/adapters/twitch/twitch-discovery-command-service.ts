import type {
  ResolvedTwitchChannel,
  TwitchApiCommand,
  TwitchApiResult,
} from "@shared/twitch-api-types";
import type { TwitchHelixRequestPort as TwitchRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import {
  requestDecoded,
  unknownResponseSchema,
  resolvedUserResponseSchema,
} from "@backend/api/platforms/twitch/twitch-command-request";

export async function executeTwitchDiscoveryCommand(
  requestor: TwitchRequestPort,
  command: TwitchApiCommand
): Promise<TwitchApiResult | null> {
  if (command.operation === "get-users") {
    const params = new URLSearchParams();
    for (const userId of command.userIds) params.append("id", userId);
    const response = await requestDecoded(
      requestor,
      unknownResponseSchema,
      `/users?${params.toString()}`
    );
    return { ok: true, data: response };
  }

  if (command.operation === "resolve-channel") {
    const response = await requestDecoded(
      requestor,
      resolvedUserResponseSchema,
      `/users?login=${encodeURIComponent(command.login.toLowerCase())}`
    );
    const user = response.data?.[0];
    const data: ResolvedTwitchChannel | null = user
      ? { id: user.id, login: user.login, displayName: user.display_name }
      : null;
    return { ok: true, data };
  }
  return null;
}
