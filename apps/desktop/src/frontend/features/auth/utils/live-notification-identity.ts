export function normalizeLiveNotificationUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function resolveLiveNotificationDisplayName(
  channelName: string,
  ...candidates: Array<string | null | undefined>
): string {
  const username = channelName.trim();
  const normalizedUsername = normalizeLiveNotificationUsername(username);
  const safeDisplayNames = candidates
    .map((displayName) => displayName?.trim() ?? "")
    .filter(
      (displayName) =>
        displayName !== "" && normalizeLiveNotificationUsername(displayName) === normalizedUsername
    );

  return (
    safeDisplayNames.find((displayName) => displayName !== username) ??
    safeDisplayNames[0] ??
    username
  );
}
