import {
  KICK_ANDROID_REDIRECT_URI,
  KICK_APP_SCOPES,
  KICK_AUTHORIZE_URL,
} from "@streamfusion/core/auth";
import { getPlatformModule } from "../../../../../modules/streamfusion-native-contracts/src/platform";
import { requireStorageModule } from "../../../../../modules/streamfusion-native-contracts/src/storage";

const verifierAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function encodeBase64Url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function randomBytes(count: number): Uint8Array {
  const hex = requireStorageModule().randomBytes(count);
  if (hex.length !== count * 2 || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error("Secure random bytes are unavailable.");
  }
  return Uint8Array.from({ length: count }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

function randomVerifier(): string {
  const bytes = randomBytes(64);
  let verifier = "";
  for (const byte of bytes) verifier += verifierAlphabet[byte % verifierAlphabet.length];
  return verifier;
}

export async function createKickPkceAuthorization(input: {
  readonly clientId: string;
  readonly nowEpochMs: number;
  readonly channel: "development" | "production";
}): Promise<{
  readonly authorizeUrl: string;
  readonly codeVerifier: string;
  readonly expiresAtEpochMs: number;
  readonly redirectUri: string;
  readonly state: string;
}> {
  const codeVerifier = randomVerifier();
  const digest = await getPlatformModule().sha256(codeVerifier);
  const codeChallenge = digest.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  const state = `sf1.${input.channel === "development" ? "d" : "p"}.${encodeBase64Url(randomBytes(32))}`;
  const authorize = new URL(KICK_AUTHORIZE_URL);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", input.clientId);
  authorize.searchParams.set("redirect_uri", KICK_ANDROID_REDIRECT_URI);
  authorize.searchParams.set("scope", KICK_APP_SCOPES.join(" "));
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return {
    authorizeUrl: authorize.toString(),
    codeVerifier,
    expiresAtEpochMs: input.nowEpochMs + 10 * 60 * 1_000,
    redirectUri: KICK_ANDROID_REDIRECT_URI,
    state,
  };
}
