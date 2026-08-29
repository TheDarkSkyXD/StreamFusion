import type { QualityLevel } from "./types";

export const SAFE_PLAYER_POSTER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
    <rect width="1280" height="720" fill="#0f0f0f"/>
    <rect x="48" y="48" width="1184" height="624" rx="24" fill="#1a1a1a" stroke="#333333"/>
    <circle cx="640" cy="320" r="72" fill="#252525"/>
    <path d="M620 278l70 42-70 42z" fill="#ffffff"/>
    <text x="640" y="450" text-anchor="middle" fill="#a0a0a0"
      font-family="Inter,system-ui,sans-serif" font-size="28">Storybook media fixture</text>
  </svg>
`)}`;

/**
 * A local, intentionally inert media URL. It exercises player chrome without
 * contacting a CDN or attempting real HLS playback.
 */
export const SAFE_PLAYER_MEDIA =
  "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=";

export const PLAYER_QUALITIES: QualityLevel[] = [
  {
    id: "auto",
    label: "Auto",
    width: 0,
    height: 0,
    bitrate: 0,
    isAuto: true,
  },
  {
    id: "source",
    label: "1080p60 (Source)",
    width: 1920,
    height: 1080,
    bitrate: 7_500_000,
    frameRate: 60,
  },
  {
    id: "720p60",
    label: "720p60",
    width: 1280,
    height: 720,
    bitrate: 4_500_000,
    frameRate: 60,
  },
  {
    id: "480p",
    label: "480p",
    width: 854,
    height: 480,
    bitrate: 1_500_000,
    frameRate: 30,
  },
];

export const PLAYER_BUFFERED_RANGES: TimeRanges = {
  length: 2,
  start: (index) => {
    if (index === 0) return 0;
    if (index === 1) return 1_100;
    throw new DOMException("IndexSizeError");
  },
  end: (index) => {
    if (index === 0) return 840;
    if (index === 1) return 1_560;
    throw new DOMException("IndexSizeError");
  },
};
