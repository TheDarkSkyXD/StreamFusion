const MEDIA_BEARING_TAGS = [
  "#EXTINF",
  "#EXT-X-BYTERANGE",
  "#EXT-X-MAP",
  "#EXT-X-PART",
  "#EXT-X-PRELOAD-HINT",
  "#EXT-X-RENDITION-REPORT",
  "#EXT-X-TWITCH-PREFETCH",
];

export function holdUnsafeTwitchMediaPlaylist(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("#")) return false;
      return !MEDIA_BEARING_TAGS.some((tag) => trimmed.startsWith(tag));
    })
    .join("\n");
}
