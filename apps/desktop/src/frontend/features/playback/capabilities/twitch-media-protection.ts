export type TwitchMediaProtection =
  | { kind: "none" }
  | {
      kind: "widevine";
      requestLicense(challenge: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
    };
