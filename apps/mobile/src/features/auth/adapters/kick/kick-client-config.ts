export interface KickClientConfiguration {
  readonly clientId: string;
}

export function parseKickClientConfiguration(
  clientId: string | undefined,
): KickClientConfiguration {
  if (!clientId?.trim())
    throw new Error("Mobile Kick account configuration is unavailable.");
  return { clientId: clientId.trim() };
}
