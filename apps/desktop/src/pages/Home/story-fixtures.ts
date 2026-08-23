import { makeStream } from "../../../.storybook/catalog-fixtures";

const STREAM_STARTED_AT = "2026-08-10T12:00:00.000Z";

function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function thumbnailFor(index: number): string {
  const colors = ["#33205c", "#183c35", "#46231f", "#243552"];
  const color = colors[index % colors.length];

  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="${color}"/><circle cx="1060" cy="130" r="260" fill="#ffffff" fill-opacity=".08"/><path d="M0 570 300 350l215 145 280-240 485 315v150H0Z" fill="#000000" fill-opacity=".22"/><text x="64" y="620" fill="#ffffff" font-family="sans-serif" font-size="48" font-weight="700">StreamFusion Live ${index + 1}</text></svg>`
  );
}

function avatarFor(index: number): string {
  const colors = ["#9146ff", "#53a318", "#dc143c", "#3d6ea8"];
  const initial = String.fromCharCode(65 + index);

  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="80" fill="${colors[index % colors.length]}"/><text x="80" y="102" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="72" font-weight="700">${initial}</text></svg>`
  );
}

export const homeStreamFixtures = Array.from({ length: 12 }, (_, index) => {
  const channelNumber = index + 1;

  return makeStream(index, {
    channelName: `home-channel-${channelNumber}`,
    channelDisplayName: `Home Channel ${channelNumber}`,
    channelAvatar: avatarFor(index),
    thumbnailUrl: thumbnailFor(index),
    startedAt: STREAM_STARTED_AT,
  });
});
