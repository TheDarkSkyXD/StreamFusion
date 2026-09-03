export const protectedCatalogValuePattern =
  /https?:\/\/[^\s"')]+|\b(?:StreamFusion|Twitch|Kick|7TV|BTTV|FFZ|Chromium|Discord|GitHub|Windows|macOS)\b/g;

export function isUntranslatedEnglishProse(englishValue, translatedValue) {
  if (translatedValue !== englishValue) return false;
  const words = englishValue
    .replaceAll(/{{[^}]+}}/g, "")
    .replaceAll(protectedCatalogValuePattern, "")
    .match(/[A-Za-z]+/g);
  return (words?.length ?? 0) >= 3;
}
