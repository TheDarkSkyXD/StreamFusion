import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { SourceMapInput } from "@jridgewell/trace-mapping";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

type CachedMap = {
  map: TraceMap;
};

export type SourceMappedLocation = {
  column?: number;
  display: string;
  line: number;
  source: string;
  url: string;
};

type SourceMapLocation = {
  column?: number;
  line?: number;
  url?: string;
};

const mapCache = new Map<string, CachedMap | null>();
const SOURCE_MAPPING_URL_PATTERN = /\/\/# sourceMappingURL=(\S+)\s*$/m;

function basename(rawUrl: string): string {
  const normalized = rawUrl.replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? rawUrl;
}

function scriptPathCandidates(scriptUrl: string): string[] {
  let pathname: string;
  try {
    const parsed = new URL(scriptUrl);
    if (parsed.protocol === "file:") return [fileURLToPath(parsed)];
    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return [];
    pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  } catch {
    pathname = scriptUrl.replace(/^\/+/, "");
  }

  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, pathname),
    path.resolve(cwd, "apps", "desktop", pathname),
    path.resolve(cwd, "..", "..", pathname),
  ];

  return [...new Set(candidates)];
}

function loadTraceMap(scriptPath: string): CachedMap | null {
  const cached = mapCache.get(scriptPath);
  if (cached !== undefined) return cached;

  try {
    const script = readFileSync(scriptPath, "utf8");
    const mapFileName = SOURCE_MAPPING_URL_PATTERN.exec(script)?.[1];
    if (mapFileName == null || mapFileName.startsWith("data:")) {
      mapCache.set(scriptPath, null);
      return null;
    }

    const mapPath = path.resolve(path.dirname(scriptPath), mapFileName);
    if (!existsSync(mapPath)) {
      mapCache.set(scriptPath, null);
      return null;
    }

    const sourceMap = JSON.parse(readFileSync(mapPath, "utf8")) as SourceMapInput;
    const result = { map: new TraceMap(sourceMap, pathToFileURL(mapPath).href) };
    mapCache.set(scriptPath, result);
    return result;
  } catch {
    mapCache.set(scriptPath, null);
    return null;
  }
}

function sourceUrl(source: string): string {
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "") return source;
  } catch {
    // Fall through to file URL conversion for plain filesystem paths.
  }

  try {
    return pathToFileURL(path.resolve(source)).href;
  } catch {
    return source;
  }
}

export function resolveSourceMappedLocation(
  location: SourceMapLocation
): SourceMappedLocation | undefined {
  if (location.url == null || location.url === "" || location.line == null) return undefined;

  for (const scriptPath of scriptPathCandidates(location.url)) {
    if (!existsSync(scriptPath)) continue;

    const cached = loadTraceMap(scriptPath);
    if (cached == null) continue;

    const original = originalPositionFor(cached.map, {
      column: location.column ?? 0,
      line: location.line,
    });

    if (original.source == null || original.line == null) continue;

    const column = original.column ?? undefined;
    const display = `${basename(original.source)}:${original.line}`;
    return {
      column,
      display,
      line: original.line,
      source: original.source,
      url: sourceUrl(original.source),
    };
  }

  return undefined;
}
