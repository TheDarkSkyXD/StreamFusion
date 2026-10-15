import { TWITCH_APP_CLIENT_ID } from "@streamfusion/core/auth";

export interface TwitchClientConfiguration {
  readonly clientId: string;
}

export function parseTwitchClientConfiguration(
  clientId: string | undefined,
): TwitchClientConfiguration {
  return { clientId: clientId?.trim() || TWITCH_APP_CLIENT_ID };
}
