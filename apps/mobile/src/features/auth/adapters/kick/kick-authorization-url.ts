import {
  KICK_ANDROID_REDIRECT_URI,
  KICK_APP_SCOPES,
  KICK_AUTHORIZE_URL,
} from "@streamfusion/core/auth";
import * as Crypto from "expo-crypto";

const verifierAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function encodeBase64Url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function randomVerifier(): string {
  const bytes = Crypto.getRandomBytes(64);
  let verifier = "";
  for (const byte of bytes) verifier += verifierAlphabet[byte % verifierAlphabet.length];
  return verifier;
}

export async function createKickPkceAuthorization(input: {
  readonly clientId: string;
  readonly nowEpochMs: number;
}): Promise<{
  readonly authorizeUrl: string;
  readonly codeVerifier: string;
  readonly expiresAtEpochMs: number;
  readonly redirectUri: string;
  readonly state: string;
}> {
  const codeVerifier = randomVerifier();
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    codeVerifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const codeChallenge = digest.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  const state = encodeBase64Url(Crypto.getRandomBytes(32));
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
