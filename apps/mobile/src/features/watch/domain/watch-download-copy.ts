import { asMediaJobId, type MediaJobId } from "@streamfusion/core/media-jobs";
export function watchDownloadCopyId(
  baseId: MediaJobId,
  commandTime: number,
  existingIds: readonly string[],
): MediaJobId {
  const prefix = `${baseId.slice(0, 210)}-copy-${commandTime}`;
  let suffix = 1;
  while (existingIds.includes(`${prefix}-${suffix}`)) suffix++;
  return asMediaJobId(`${prefix}-${suffix}`);
}
