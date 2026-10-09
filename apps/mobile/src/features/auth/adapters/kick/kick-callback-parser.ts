import {
  KICK_ANDROID_REDIRECT_URI,
  type KickCallbackInput,
} from "@streamfusion/core/auth";

export function parseKickCallbackUrl(
  value: string,
  receivedAtEpochMs: number,
): KickCallbackInput | null {
  const callbackAddresses = [
    KICK_ANDROID_REDIRECT_URI,
    "streamfusion-development://auth/kick/callback",
    "streamfusion://auth/kick/callback",
  ];
  if (value.length > 8192) return null;
  if (!callbackAddresses.some((address) => value.startsWith(`${address}?`)))
    return null;
  if (/%(?![0-9a-fA-F]{2})/u.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.hash || parsed.username || parsed.password || parsed.port)
    return null;
  const address = value.slice(0, value.indexOf("?"));
  if (!callbackAddresses.includes(address)) return null;
  if (
    parsed.searchParams.getAll("state").length !== 1 ||
    parsed.searchParams.getAll("code").length > 1 ||
    parsed.searchParams.getAll("error").length > 1 ||
    parsed.searchParams.getAll("error_description").length > 1 ||
    parsed.searchParams.getAll("scope").length > 1 ||
    (parsed.searchParams.get("error_description")?.length ?? 0) > 1024 ||
    (parsed.searchParams.get("scope")?.length ?? 0) > 1024 ||
    parsed.searchParams.getAll("code").length +
      parsed.searchParams.getAll("error").length !==
      1
  )
    return null;
  const code = parsed.searchParams.get("code");
  const error = parsed.searchParams.get("error");
  const state = parsed.searchParams.get("state");
  if (!state || !/^sf1\.[dp]\.[A-Za-z0-9_-]{43}$/u.test(state)) return null;
  const payload = code ?? error;
  if (
    !payload ||
    payload.length > (code !== null ? 2048 : 128) ||
    !/^[\x21-\x7E]+$/u.test(payload)
  )
    return null;
  return {
    code,
    error,
    receivedAtEpochMs,
    redirectUri: KICK_ANDROID_REDIRECT_URI,
    state,
  };
}
