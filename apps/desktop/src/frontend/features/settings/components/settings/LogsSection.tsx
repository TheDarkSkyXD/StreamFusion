import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LuCopy,
  LuFileText,
  LuFolderOpen,
  LuRefreshCw,
  LuTerminal,
  LuTriangleAlert,
} from "react-icons/lu";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useInterval } from "@/hooks/useInterval";
import { cn } from "@/lib/utils";
import { translateSettings } from "@/features/settings/utils/settings-translation";

type LogFile = "main" | "noise" | "network";
type LogLevel = "all" | "debug" | "info" | "warn" | "error";
type LogFocus = "all" | "network";
type LogView = "text" | "table";

function getLevelOptions(): { value: LogLevel; label: string }[] {
  return [
    { value: "all", label: translateSettings({ key: "settings.allLevels" }) },
    { value: "debug", label: translateSettings({ key: "settings.debug" }) },
    { value: "info", label: translateSettings({ key: "settings.info" }) },
    { value: "warn", label: translateSettings({ key: "settings.warn" }) },
    { value: "error", label: translateSettings({ key: "settings.error" }) },
  ];
}

const LINES_MIN = 50;
const LINES_MAX = 2000;
const LINES_DEFAULT = 200;
const AUTO_REFRESH_MS = 3000;
const NETWORK_QUERY_TERMS = [
  "network:request",
  "chromium",
  "network",
  "net::",
  "statuspoller",
  "platformhealth",
  "turn_port",
  "spdy",
  "ivs",
  "manifest",
  "m3u8",
  "streamresolver",
  "player:hls",
  "kick:stream",
  "kick:health",
];

// Matches the project log line format: `[<iso>] [<level>] [<tag>] ...`
// Captures level and tag for filter + color hints; lines that don't match
// (rare — bare console writes) fall through as "info" with an empty tag.
const LINE_FORMAT = /^\[[^\]]+\]\s+\[(debug|info|warn|error)\]\s+\[([^\]]+)\]/i;

type LogMeta = Record<string, unknown>;

type NetworkRow = {
  id: string;
  rawLine: string;
  level: LogLevel;
  name: string;
  type: string;
  status: string;
  initiator: string;
  size: string;
  time: string;
  curl: string | null;
};

function classifyLine(line: string): { level: LogLevel; tag: string } {
  const match = LINE_FORMAT.exec(line);
  if (!match) return { level: "info", tag: "" };
  return { level: match[1].toLowerCase() as LogLevel, tag: match[2] };
}

function levelClassName(level: LogLevel): string {
  switch (level) {
    case "error":
      return "text-red-400";
    case "warn":
      return "text-amber-300";
    case "debug":
      return "text-zinc-500";
    default:
      return "text-zinc-300";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseLogLine(line: string): {
  level: LogLevel;
  tag: string;
  message: string;
  meta?: LogMeta;
} {
  const classified = classifyLine(line);
  if (classified.tag === "") return { level: classified.level, tag: "", message: line };

  const tagMarker = `[${classified.tag}]`;
  const tagEnd = line.indexOf(tagMarker);
  const rest = tagEnd === -1 ? line : line.slice(tagEnd + tagMarker.length).trimStart();
  const metaStart = rest.indexOf(" {");
  const message = metaStart === -1 ? rest : rest.slice(0, metaStart);
  const rawMeta = metaStart === -1 ? undefined : rest.slice(metaStart + 1);
  let meta: LogMeta | undefined;
  if (rawMeta != null) {
    try {
      const parsed = JSON.parse(rawMeta) as unknown;
      if (isRecord(parsed)) meta = parsed;
    } catch {
      meta = undefined;
    }
  }

  return {
    level: classified.level,
    tag: classified.tag,
    message,
    meta,
  };
}

function formatBytes(value: unknown): string {
  const bytes = numberValue(value);
  if (bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: unknown): string {
  const durationMs = numberValue(value);
  return durationMs === undefined ? "-" : `${durationMs} ms`;
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

function curlFromMeta(meta: LogMeta | undefined): string | null {
  if (meta == null) return null;
  const url = stringValue(meta.url);
  if (url === "") return null;

  const method = stringValue(meta.method, "GET").toUpperCase();
  const headers = isRecord(meta.requestHeaders) ? meta.requestHeaders : {};
  const parts = ["curl", shellQuote(url)];
  if (method !== "GET") parts.push("-X", shellQuote(method));
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string" && value !== "") {
      parts.push("-H", shellQuote(`${name}: ${value}`));
    }
  }
  return parts.join(" ");
}

function networkRowFromLine(line: string, index: number): NetworkRow {
  const parsed = parseLogLine(line);
  const meta = parsed.meta;

  if (parsed.tag === "Network:Request" && meta != null) {
    const status =
      stringValue(meta.status) ||
      stringValue(meta.error) ||
      (numberValue(meta.statusCode) === undefined ? "-" : String(numberValue(meta.statusCode)));

    return {
      id: `${index}-${line.length}`,
      rawLine: line,
      level: parsed.level,
      name: stringValue(meta.name, stringValue(meta.url, parsed.message)),
      type: stringValue(meta.type, stringValue(meta.resourceType, stringValue(meta.kind, "-"))),
      status,
      initiator: stringValue(meta.initiator, "-"),
      size: formatBytes(meta.sizeBytes),
      time: formatTime(meta.durationMs),
      curl: curlFromMeta(meta),
    };
  }

  return {
    id: `${index}-${line.length}`,
    rawLine: line,
    level: parsed.level,
    name: parsed.message,
    type: parsed.tag || "-",
    status: parsed.level,
    initiator: "-",
    size: "-",
    time: "-",
    curl: null,
  };
}

function statusClassName(status: string, level: LogLevel): string {
  if (
    level === "error" ||
    status.startsWith("net::") ||
    status.startsWith("4") ||
    status.startsWith("5")
  ) {
    return "text-red-300";
  }
  if (level === "warn" || status.startsWith("3")) return "text-amber-300";
  if (status.startsWith("2")) return "text-emerald-300";
  return "text-zinc-300";
}

/**
 * Settings → Logs panel. Renders a live tail of the current session log file
 * with filterable level/tag controls. Read-only — never sees raw secrets
 * (the main-process logger redacts before write). Auto-refresh routes through
 * `useInterval` so the no-raw-timers policy stays happy.
 */
export function LogsSection() {
  useTranslation();
  const levelOptions = getLevelOptions();
  const [file, setFile] = useState<LogFile>("main");
  const [focus, setFocus] = useState<LogFocus>("all");
  const [view, setView] = useState<LogView>("text");
  const [level, setLevel] = useState<LogLevel>("all");
  const [tagFilter, setTagFilter] = useState("");
  const [lines, setLines] = useState<number>(LINES_DEFAULT);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [tail, setTail] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [noisePath, setNoisePath] = useState<string | null>(null);
  const [networkPath, setNetworkPath] = useState<string | null>(null);

  // Initial path probe: also drives whether the noise file is selectable.
  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI?.logs;
    if (!api) return;
    void api
      .getCurrentPath()
      .then((path) => {
        if (!cancelled) setCurrentPath(path ?? null);
      })
      .catch(() => {
        if (!cancelled) setCurrentPath(null);
      });
    void api
      .getNoisePath()
      .then((path) => {
        if (!cancelled) setNoisePath(path);
      })
      .catch(() => {
        if (!cancelled) setNoisePath(null);
      });
    void api
      .getNetworkPath()
      .then((path) => {
        if (!cancelled) setNetworkPath(path);
      })
      .catch(() => {
        if (!cancelled) setNetworkPath(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchTail = useCallback(async () => {
    const api = window.electronAPI?.logs;
    if (!api) return;
    setLoading(true);
    try {
      // Filter server-side so a deep-file tag/level match isn't dropped by
      // the tail window. The viewer still runs the same filter locally as
      // belt-and-suspenders against stale responses mid-typing.
      const trimmedTag = tagFilter.trim();
      const result = await api.tail({
        lines,
        file,
        level: level === "all" ? undefined : level,
        tag: trimmedTag === "" ? undefined : trimmedTag,
        query: file !== "network" && focus === "network" ? NETWORK_QUERY_TERMS : undefined,
      });
      setTail(result);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : translateSettings({ key: "settings.failedToReadLogFile" })
      );
    } finally {
      setLoading(false);
    }
  }, [lines, file, focus, level, tagFilter]);

  // Re-fetch on file/lines/level/tag change and on first mount.
  useEffect(() => {
    void fetchTail();
  }, [fetchTail]);

  // useInterval (not raw setInterval) satisfies the no-raw-timers policy.
  useInterval(
    () => {
      void fetchTail();
    },
    autoRefresh ? AUTO_REFRESH_MS : null
  );

  const filteredLines = useMemo(() => {
    const tagNeedle = tagFilter.trim().toLowerCase();
    return tail.filter((line) => {
      const meta = classifyLine(line);
      if (level !== "all" && meta.level !== level) return false;
      if (tagNeedle && !meta.tag.toLowerCase().includes(tagNeedle)) return false;
      if (
        file !== "network" &&
        focus === "network" &&
        !NETWORK_QUERY_TERMS.some((needle) => line.toLowerCase().includes(needle))
      ) {
        return false;
      }
      return true;
    });
  }, [tail, file, focus, level, tagFilter]);

  const networkRows = useMemo(
    () => filteredLines.map((line, index) => networkRowFromLine(line, index)),
    [filteredLines]
  );
  const canUseTableView = file === "network";

  const handleOpenFolder = useCallback(async () => {
    const api = window.electronAPI?.logs;
    if (!api) return;
    try {
      const result = await api.openFolder();
      if (!result.ok) {
        toast.error(
          result.error ?? translateSettings({ key: "settings.couldnTOpenTheLogsFolder" })
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : translateSettings({ key: "settings.couldnTOpenTheLogsFolder" })
      );
    }
  }, []);

  const activePath = file === "main" ? currentPath : file === "network" ? networkPath : noisePath;

  const handleCopyPath = useCallback(async () => {
    if (!activePath) {
      toast.error(translateSettings({ key: "settings.logPathNotAvailableYet" }));
      return;
    }
    try {
      await navigator.clipboard.writeText(activePath);
      toast.success(translateSettings({ key: "settings.logPathCopiedToClipboard" }));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : translateSettings({ key: "settings.couldnTCopyLogPath" })
      );
    }
  }, [activePath]);

  const handleCopyLogs = useCallback(async () => {
    if (filteredLines.length === 0) {
      toast.error(translateSettings({ key: "settings.noLogLinesToCopy" }));
      return;
    }
    try {
      // Copy exactly what's rendered (post-filter), one line per row, so a
      // paste into an issue/Slack/email matches what the user is staring at.
      await navigator.clipboard.writeText(filteredLines.join("\n"));
      toast.success(
        translateSettings({
          key: "settings.copiedValueLogLineValue",
          options: {
            value1: filteredLines.length,
            value2: filteredLines.length === 1 ? "" : "s",
          },
        })
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : translateSettings({ key: "settings.couldnTCopyLogLines" })
      );
    }
  }, [filteredLines]);

  const handleCopyCurl = useCallback(async (curl: string | null) => {
    if (curl == null) {
      toast.error(translateSettings({ key: "settings.curlCommandNotAvailableForThisRow" }));
      return;
    }
    try {
      await navigator.clipboard.writeText(curl);
      toast.success(translateSettings({ key: "settings.curlCommandCopiedToClipboard" }));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : translateSettings({ key: "settings.couldnTCopyCurlCommand" })
      );
    }
  }, []);

  const handleFileChange = useCallback((nextFile: LogFile) => {
    setFile(nextFile);
    setView(nextFile === "network" ? "table" : "text");
  }, []);

  const handleFocusChange = useCallback((nextFocus: LogFocus) => {
    setFocus(nextFocus);
    setView("text");
  }, []);

  const noiseDisabled = noisePath == null;
  const networkDisabled = networkPath == null;

  return (
    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#27272a]">
        <div className="p-2 rounded-lg bg-zinc-500/10 text-zinc-300">
          <LuFileText className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-lg">{translateSettings({ key: "settings.logs" })}</h3>
          <p className="text-sm text-zinc-500 truncate" title={activePath ?? undefined}>
            {activePath ?? translateSettings({ key: "settings.locatingLogFile" })}
          </p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Top controls */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="logs-file" className="text-xs font-medium text-zinc-400">
              {translateSettings({ key: "settings.logFile" })}
            </label>
            {noiseDisabled ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <select
                    id="logs-file"
                    aria-label={translateSettings({ key: "settings.logFile" })}
                    value={file}
                    onChange={(e) => handleFileChange(e.target.value as LogFile)}
                    className="rounded-md border border-[#27272a] bg-[#18181b] px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
                  >
                    <option value="main">{translateSettings({ key: "settings.main" })}</option>
                    <option value="network" disabled={networkDisabled}>
                      {translateSettings({ key: "settings.network" })}
                      {networkDisabled ? translateSettings({ key: "settings.unavailable2" }) : ""}
                    </option>
                    <option value="noise" disabled>
                      {translateSettings({ key: "settings.noiseUnavailable" })}
                    </option>
                  </select>
                </TooltipTrigger>
                <TooltipContent>
                  {translateSettings({
                    key: "settings.noiseSideChannelLoggerIsDisabledInThisBuild",
                  })}
                </TooltipContent>
              </Tooltip>
            ) : (
              <select
                id="logs-file"
                aria-label={translateSettings({ key: "settings.logFile" })}
                value={file}
                onChange={(e) => handleFileChange(e.target.value as LogFile)}
                className="rounded-md border border-[#27272a] bg-[#18181b] px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
              >
                <option value="main">{translateSettings({ key: "settings.main" })}</option>
                <option value="network" disabled={networkDisabled}>
                  {translateSettings({ key: "settings.network" })}
                  {networkDisabled ? translateSettings({ key: "settings.unavailable2" }) : ""}
                </option>
                <option value="noise">{translateSettings({ key: "settings.noise" })}</option>
              </select>
            )}
          </div>

          {file !== "network" && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-400">
                {translateSettings({ key: "settings.focus" })}
              </span>
              <div className="flex rounded-md border border-[#27272a] bg-[#18181b] p-0.5">
                <button
                  type="button"
                  onClick={() => handleFocusChange("all")}
                  className={cn(
                    "rounded px-3 py-1 text-sm transition-colors",
                    focus === "all"
                      ? "bg-[#27272a] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {translateSettings({ key: "settings.all" })}
                </button>
                <button
                  type="button"
                  onClick={() => handleFocusChange("network")}
                  className={cn(
                    "rounded px-3 py-1 text-sm transition-colors",
                    focus === "network"
                      ? "bg-[#27272a] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {translateSettings({ key: "settings.network" })}
                </button>
              </div>
            </div>
          )}

          {canUseTableView && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-400">
                {translateSettings({ key: "settings.view" })}
              </span>
              <div className="flex rounded-md border border-[#27272a] bg-[#18181b] p-0.5">
                <button
                  type="button"
                  onClick={() => setView("text")}
                  className={cn(
                    "rounded px-3 py-1 text-sm transition-colors",
                    view === "text"
                      ? "bg-[#27272a] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {translateSettings({ key: "settings.text" })}
                </button>
                <button
                  type="button"
                  onClick={() => setView("table")}
                  className={cn(
                    "rounded px-3 py-1 text-sm transition-colors",
                    view === "table"
                      ? "bg-[#27272a] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {translateSettings({ key: "settings.table" })}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="logs-level" className="text-xs font-medium text-zinc-400">
              {translateSettings({ key: "settings.level" })}
            </label>
            <select
              id="logs-level"
              aria-label={translateSettings({ key: "settings.filterByLevel" })}
              value={level}
              onChange={(e) => setLevel(e.target.value as LogLevel)}
              className="rounded-md border border-[#27272a] bg-[#18181b] px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
            >
              {levelOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label htmlFor="logs-tag" className="text-xs font-medium text-zinc-400">
              {translateSettings({ key: "settings.tag" })}
            </label>
            <input
              id="logs-tag"
              type="text"
              aria-label={translateSettings({ key: "settings.filterByTag" })}
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder={translateSettings({ key: "settings.twitchKickAuth" })}
              autoComplete="off"
              spellCheck={false}
              className="rounded-md border border-[#27272a] bg-[#18181b] px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="logs-lines" className="text-xs font-medium text-zinc-400">
              {translateSettings({ key: "settings.lines" })}
            </label>
            <input
              id="logs-lines"
              type="number"
              aria-label={translateSettings({ key: "settings.linesToFetch" })}
              min={LINES_MIN}
              max={LINES_MAX}
              step={50}
              value={lines}
              onChange={(e) => {
                const next = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(next)) {
                  setLines(Math.max(LINES_MIN, Math.min(LINES_MAX, next)));
                }
              }}
              className="w-24 rounded-md border border-[#27272a] bg-[#18181b] px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
            />
          </div>

          <div className="flex items-center gap-2 pb-1.5">
            <Switch
              id="logs-auto-refresh"
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              aria-label={translateSettings({ key: "settings.autoRefreshEvery3Seconds" })}
            />
            <label htmlFor="logs-auto-refresh" className="text-sm text-zinc-300 cursor-pointer">
              {translateSettings({ key: "settings.autoRefresh" })}
            </label>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchTail()}
            disabled={loading}
            className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
          >
            <LuRefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            {translateSettings({ key: "settings.refresh" })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleOpenFolder()}
            className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
          >
            <LuFolderOpen className="w-4 h-4 mr-2" />
            {translateSettings({ key: "settings.openLogsFolder" })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCopyPath()}
            disabled={!activePath}
            className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
          >
            <LuCopy className="w-4 h-4 mr-2" />
            {translateSettings({ key: "settings.copyLogPath" })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCopyLogs()}
            disabled={filteredLines.length === 0}
            title={
              filteredLines.length === 0
                ? translateSettings({ key: "settings.noLogLinesToCopy" })
                : translateSettings({
                    key: "settings.copyTheValueVisibleLogLineValueToTheClipboard",
                    options: {
                      value1: filteredLines.length,
                      value2: filteredLines.length === 1 ? "" : "s",
                    },
                  })
            }
            className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
          >
            <LuCopy className="w-4 h-4 mr-2" />
            {translateSettings({ key: "settings.copyLogs" })}
          </Button>
        </div>

        {/* Error banner (read failure) */}
        {error && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
            <LuTriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm flex-1">{error}</p>
          </div>
        )}

        {/* Log lines viewer */}
        <div className="rounded-lg border border-[#27272a] bg-[#09090b]">
          <div className="max-h-[480px] overflow-auto p-3 font-mono text-xs leading-relaxed">
            {loading && tail.length === 0 ? (
              <div className="flex items-center gap-2 text-zinc-500 py-6 justify-center">
                <LuRefreshCw className="w-4 h-4 animate-spin" />
                {translateSettings({ key: "settings.loadingLogLines" })}
              </div>
            ) : filteredLines.length === 0 ? (
              <div className="text-zinc-600 italic py-6 text-center">
                {translateSettings({ key: "settings.noLogLinesMatchTheseFilters" })}
              </div>
            ) : canUseTableView && view === "table" ? (
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-[#09090b] text-[11px] uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-[#27272a]">
                    <th scope="col" className="px-2 py-2 font-medium">
                      {translateSettings({ key: "settings.name" })}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      {translateSettings({ key: "settings.type" })}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      {translateSettings({ key: "settings.status" })}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      {translateSettings({ key: "settings.initiator" })}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium text-right">
                      {translateSettings({ key: "settings.size" })}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium text-right">
                      {translateSettings({ key: "settings.time" })}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium text-right">
                      {translateSettings({ key: "settings.curl" })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {networkRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-[#18181b] text-zinc-300 hover:bg-[#18181b]"
                      title={row.rawLine}
                    >
                      <td className="max-w-[320px] px-2 py-2 align-top">
                        <span className={cn("block truncate", levelClassName(row.level))}>
                          {row.name}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top text-zinc-400">{row.type}</td>
                      <td
                        className={cn(
                          "px-2 py-2 align-top",
                          statusClassName(row.status, row.level)
                        )}
                      >
                        {row.status}
                      </td>
                      <td className="max-w-[260px] px-2 py-2 align-top text-zinc-500">
                        <span className="block truncate">{row.initiator}</span>
                      </td>
                      <td className="px-2 py-2 align-top text-right text-zinc-400">{row.size}</td>
                      <td className="px-2 py-2 align-top text-right text-zinc-400">{row.time}</td>
                      <td className="px-2 py-1.5 align-top text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleCopyCurl(row.curl)}
                          disabled={row.curl == null}
                          aria-label={translateSettings({
                            key: "settings.copyCurlForValue",
                            options: {
                              value1: row.name,
                            },
                          })}
                          className="h-7 px-2 text-zinc-300 hover:bg-[#27272a] hover:text-white"
                        >
                          <LuTerminal className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              filteredLines.map((line, i) => {
                const meta = classifyLine(line);
                return (
                  <div
                    key={`${i}-${line.length}`}
                    className={cn("whitespace-pre-wrap break-words", levelClassName(meta.level))}
                  >
                    {line}
                  </div>
                );
              })
            )}
          </div>
          <div className="px-3 py-2 border-t border-[#27272a] text-xs text-zinc-500 flex items-center justify-between">
            <span>
              {translateSettings({ key: "settings.showing" })}
              {filteredLines.length} {translateSettings({ key: "settings.of" })}
              {tail.length} {translateSettings({ key: "settings.lines2" })}
            </span>
            {autoRefresh && (
              <span className="text-zinc-400">
                {translateSettings({ key: "settings.autoRefreshingEvery3s" })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
