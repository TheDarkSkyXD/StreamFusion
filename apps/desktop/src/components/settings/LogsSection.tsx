import { useCallback, useEffect, useMemo, useState } from "react";
import { LuCopy, LuFileText, LuFolderOpen, LuRefreshCw, LuTriangleAlert } from "react-icons/lu";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useInterval } from "@/hooks/useInterval";
import { cn } from "@/lib/utils";

type LogFile = "main" | "noise";
type LogLevel = "all" | "debug" | "info" | "warn" | "error";

const LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: "all", label: "All levels" },
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warn" },
  { value: "error", label: "Error" },
];

const LINES_MIN = 50;
const LINES_MAX = 2000;
const LINES_DEFAULT = 200;
const AUTO_REFRESH_MS = 3000;

// Matches the project log line format: `[<iso>] [<level>] [<tag>] ...`
// Captures level and tag for filter + color hints; lines that don't match
// (rare — bare console writes) fall through as "info" with an empty tag.
const LINE_FORMAT = /^\[[^\]]+\]\s+\[(debug|info|warn|error)\]\s+\[([^\]]+)\]/i;

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

/**
 * Settings → Logs panel. Renders a live tail of the current session log file
 * with filterable level/tag controls. Read-only — never sees raw secrets
 * (the main-process logger redacts before write). Auto-refresh routes through
 * `useInterval` so the no-raw-timers policy stays happy.
 */
export function LogsSection() {
  const [file, setFile] = useState<LogFile>("main");
  const [level, setLevel] = useState<LogLevel>("all");
  const [tagFilter, setTagFilter] = useState("");
  const [lines, setLines] = useState<number>(LINES_DEFAULT);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [tail, setTail] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [noisePath, setNoisePath] = useState<string | null>(null);

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
      });
      setTail(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read log file");
    } finally {
      setLoading(false);
    }
  }, [lines, file, level, tagFilter]);

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
      return true;
    });
  }, [tail, level, tagFilter]);

  const handleOpenFolder = useCallback(async () => {
    const api = window.electronAPI?.logs;
    if (!api) return;
    try {
      const result = await api.openFolder();
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't open the logs folder");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open the logs folder");
    }
  }, []);

  const activePath = file === "main" ? currentPath : noisePath;

  const handleCopyPath = useCallback(async () => {
    if (!activePath) {
      toast.error("Log path not available yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(activePath);
      toast.success("Log path copied to clipboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't copy log path");
    }
  }, [activePath]);

  const handleCopyLogs = useCallback(async () => {
    if (filteredLines.length === 0) {
      toast.error("No log lines to copy");
      return;
    }
    try {
      // Copy exactly what's rendered (post-filter), one line per row, so a
      // paste into an issue/Slack/email matches what the user is staring at.
      await navigator.clipboard.writeText(filteredLines.join("\n"));
      toast.success(`Copied ${filteredLines.length} log line${filteredLines.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't copy log lines");
    }
  }, [filteredLines]);

  const noiseDisabled = noisePath == null;

  return (
    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#27272a]">
        <div className="p-2 rounded-lg bg-zinc-500/10 text-zinc-300">
          <LuFileText className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-lg">Logs</h3>
          <p className="text-sm text-zinc-500 truncate" title={activePath ?? undefined}>
            {activePath ?? "Locating log file…"}
          </p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Top controls */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="logs-file" className="text-xs font-medium text-zinc-400">
              Log file
            </label>
            {noiseDisabled ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <select
                    id="logs-file"
                    aria-label="Log file"
                    value={file}
                    onChange={(e) => setFile(e.target.value as LogFile)}
                    className="rounded-md border border-[#27272a] bg-[#18181b] px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
                  >
                    <option value="main">Main</option>
                    <option value="noise" disabled>
                      Noise (unavailable)
                    </option>
                  </select>
                </TooltipTrigger>
                <TooltipContent>
                  Noise side-channel logger is disabled in this build.
                </TooltipContent>
              </Tooltip>
            ) : (
              <select
                id="logs-file"
                aria-label="Log file"
                value={file}
                onChange={(e) => setFile(e.target.value as LogFile)}
                className="rounded-md border border-[#27272a] bg-[#18181b] px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
              >
                <option value="main">Main</option>
                <option value="noise">Noise</option>
              </select>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="logs-level" className="text-xs font-medium text-zinc-400">
              Level
            </label>
            <select
              id="logs-level"
              aria-label="Filter by level"
              value={level}
              onChange={(e) => setLevel(e.target.value as LogLevel)}
              className="rounded-md border border-[#27272a] bg-[#18181b] px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
            >
              {LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label htmlFor="logs-tag" className="text-xs font-medium text-zinc-400">
              Tag
            </label>
            <input
              id="logs-tag"
              type="text"
              aria-label="Filter by tag"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="Twitch, Kick, Auth…"
              autoComplete="off"
              spellCheck={false}
              className="rounded-md border border-[#27272a] bg-[#18181b] px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="logs-lines" className="text-xs font-medium text-zinc-400">
              Lines
            </label>
            <input
              id="logs-lines"
              type="number"
              aria-label="Lines to fetch"
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
              aria-label="Auto-refresh every 3 seconds"
            />
            <label htmlFor="logs-auto-refresh" className="text-sm text-zinc-300 cursor-pointer">
              Auto-refresh
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
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleOpenFolder()}
            className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
          >
            <LuFolderOpen className="w-4 h-4 mr-2" />
            Open Logs Folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCopyPath()}
            disabled={!activePath}
            className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
          >
            <LuCopy className="w-4 h-4 mr-2" />
            Copy Log Path
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCopyLogs()}
            disabled={filteredLines.length === 0}
            title={
              filteredLines.length === 0
                ? "No log lines to copy"
                : `Copy the ${filteredLines.length} visible log line${filteredLines.length === 1 ? "" : "s"} to the clipboard`
            }
            className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
          >
            <LuCopy className="w-4 h-4 mr-2" />
            Copy Logs
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
                Loading log lines…
              </div>
            ) : filteredLines.length === 0 ? (
              <div className="text-zinc-600 italic py-6 text-center">
                No log lines match these filters
              </div>
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
              Showing {filteredLines.length} of {tail.length} lines
            </span>
            {autoRefresh && <span className="text-zinc-400">Auto-refreshing every 3s</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
