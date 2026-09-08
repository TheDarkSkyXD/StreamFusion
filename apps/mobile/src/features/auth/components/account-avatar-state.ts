export function shouldShowTwitchAvatar(
  profileImageUrl: string | null,
  failedImageUrl: string | null,
): profileImageUrl is string {
  return profileImageUrl !== null && profileImageUrl !== failedImageUrl;
}
