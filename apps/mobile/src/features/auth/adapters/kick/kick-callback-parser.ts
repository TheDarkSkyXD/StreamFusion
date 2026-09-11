import {
  KICK_ANDROID_REDIRECT_URI,
  type KickCallbackInput,
} from "@streamfusion/core/auth";

export function parseKickCallbackUrl(
  value: string,
  receivedAtEpochMs: number,
): KickCallbackInput | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const redirectUri = `${parsed.origin}${parsed.pathname}`;
  if (redirectUri !== KICK_ANDROID_REDIRECT_URI) return null;
  const code = parsed.searchParams.get("code");
  const error = parsed.searchParams.get("error");
  const state = parsed.searchParams.get("state");
  return {
    code: code && code.length > 0 ? code : null,
    error: error && error.length > 0 ? error : null,
    receivedAtEpochMs,
    redirectUri,
    state: state && state.length > 0 ? state : null,
  };
}
