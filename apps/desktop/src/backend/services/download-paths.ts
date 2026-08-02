import path from "node:path";

const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g;
const RESERVED_DOS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function sanitizeFilenamePart(value: string, fallback: string): string {
  const cleaned = value.replace(ILLEGAL_FILENAME_CHARS, "").replace(/\s+/g, " ").trim();
  if (!cleaned || RESERVED_DOS_NAMES.test(cleaned)) return fallback;
  return cleaned.slice(0, 120).trim() || fallback;
}

export function buildDownloadFilename(
  channelName: string,
  title: string,
  extension: string
): string {
  const safeChannel = sanitizeFilenamePart(channelName, "stream");
  const safeTitle = sanitizeFilenamePart(title, "clip");
  const safeExtension = extension.startsWith(".") ? extension : `.${extension}`;
  return `${safeChannel}-${safeTitle}${safeExtension}`;
}

export function getAvailableDestinationPath(
  requestedPath: string,
  exists: (candidate: string) => boolean
): string {
  if (!exists(requestedPath)) return requestedPath;

  const parsed = path.parse(requestedPath);
  let index = 1;
  let candidate = "";
  do {
    candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    index++;
  } while (exists(candidate));

  return candidate;
}
