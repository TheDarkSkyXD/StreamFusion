export interface TwitchClientConfiguration {
  readonly clientId: string;
}

export function parseTwitchClientConfiguration(
  clientId: string | undefined,
): TwitchClientConfiguration {
  if (!clientId?.trim())
    throw new Error("Mobile Twitch Device Code configuration is unavailable.");
  return { clientId: clientId.trim() };
}
