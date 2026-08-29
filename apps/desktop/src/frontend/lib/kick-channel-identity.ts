const KICK_AVATAR_USER_ID_PATTERN = /\/images\/user\/(\d+)\//i;

export function getKickBroadcasterUserIdFromAvatar(
  avatarUrl: string | null | undefined
): string | null {
  const match = avatarUrl?.match(KICK_AVATAR_USER_ID_PATTERN);
  return match?.[1] ?? null;
}

export function firstValidKickBroadcasterUserId(
  ...candidates: Array<string | number | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const value = String(candidate).trim();
    if (/^[1-9]\d*$/.test(value)) return value;
  }
  return null;
}
