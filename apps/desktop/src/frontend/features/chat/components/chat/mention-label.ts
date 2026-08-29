export function formatMentionLabel(username: string): string {
  return username.startsWith("@") ? username : `@${username}`;
}
