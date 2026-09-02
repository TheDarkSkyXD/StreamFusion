import { useCallback, useEffect, useState } from "react";
import { i18n } from "@/i18n";
import type { settingsEn } from "@/i18n/locales/en/settings";
import { LuBug, LuCopy, LuFolderOpen } from "react-icons/lu";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

function translateSettings(
  key: `settings.${keyof typeof settingsEn.settings}`,
  options?: Record<string, unknown>
): string {
  const translated: string = i18n["t"](key, { defaultValue: String(key) });
  return options
    ? Object.entries(options).reduce(
        (result, [name, value]) => result.replaceAll(`{{${name}}}`, String(value)),
        translated
      )
    : translated;
}
const MIN_DESCRIPTION_LENGTH = 10;
const RECENT_REPORTS_LIMIT = 5;

/**
 * Settings → Report a Bug panel. Drives the renderer side of the bug-report
 * IPC: write a markdown report (description + optional tailed main/noise logs)
 * to disk, then surface the saved path inline so the user can share it. The
 * main-process redactor already strips OAuth tokens before logs are written,
 * so attached log content is safe to ship as-is.
 */
export function BugReportSection() {
  const [description, setDescription] = useState("");
  const [includeMainLog, setIncludeMainLog] = useState(true);
  const [includeNoiseLog, setIncludeNoiseLog] = useState(true);
  const [noiseAvailable, setNoiseAvailable] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [recentReports, setRecentReports] = useState<string[]>([]);

  // Probe whether the noise log exists; if not, force the include-noise switch
  // off and disable it (sending true would silently no-op on the backend).
  useEffect(() => {
    let cancelled = false;
    const logs = window.electronAPI?.logs;
    if (!logs?.getNoisePath) return;
    void logs
      .getNoisePath()
      .then((path) => {
        if (cancelled) return;
        const available = path != null;
        setNoiseAvailable(available);
        if (!available) setIncludeNoiseLog(false);
      })
      .catch(() => {
        if (!cancelled) {
          setNoiseAvailable(false);
          setIncludeNoiseLog(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshRecent = useCallback(async () => {
    const api = window.electronAPI?.bugReports;
    if (!api?.list) return;
    try {
      const list = await api.list();
      setRecentReports(list.slice(0, RECENT_REPORTS_LIMIT));
    } catch {
      // List is a courtesy view; quietly drop failures.
    }
  }, []);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  const canSubmit = !submitting && description.trim().length >= MIN_DESCRIPTION_LENGTH;

  const handleSubmit = useCallback(async () => {
    const api = window.electronAPI?.bugReports;
    if (!api?.write) {
      toast.error(translateSettings("settings.bugReportIpcIsNotAvailable"));
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.write({
        description: description.trim(),
        includeMainLog,
        includeNoiseLog: noiseAvailable ? includeNoiseLog : false,
      });
      if (!result.ok || !result.filePath) {
        toast.error(result.error ?? translateSettings("settings.couldnTWriteTheBugReport"));
        return;
      }
      setSavedPath(result.filePath);
      const filename = result.filePath.split(/[/\\]/).pop() ?? result.filePath;
      toast.success(translateSettings("settings.savedToValue", { filename: filename }));
      // Refresh the recent-reports list so the new entry appears.
      void refreshRecent();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : translateSettings("settings.couldnTWriteTheBugReport")
      );
    } finally {
      setSubmitting(false);
    }
  }, [description, includeMainLog, includeNoiseLog, noiseAvailable, refreshRecent]);

  const handleOpenFolder = useCallback(async () => {
    const api = window.electronAPI?.bugReports;
    if (!api?.openFolder) {
      toast.error(translateSettings("settings.bugReportIpcIsNotAvailable"));
      return;
    }
    try {
      const result = await api.openFolder();
      if (!result.ok) {
        toast.error(result.error ?? translateSettings("settings.couldnTOpenTheBugReportsFolder"));
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : translateSettings("settings.couldnTOpenTheBugReportsFolder")
      );
    }
  }, []);

  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success(translateSettings("settings.pathCopiedToClipboard"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : translateSettings("settings.couldnTCopyPath")
      );
    }
  }, []);

  return (
    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#27272a]">
        <div className="p-2 rounded-lg bg-zinc-500/10 text-zinc-300">
          <LuBug className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-lg">{translateSettings("settings.reportABug")}</h3>
          <p className="text-sm text-zinc-500">
            {translateSettings(
              "settings.writeABugReportToDiskYouCanAttachRecentLogFileContentsTheyReAlre"
            )}
          </p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        <div className="space-y-2">
          <label htmlFor="bug-description" className="block text-sm font-medium text-zinc-300">
            {translateSettings("settings.description")}
          </label>
          <textarea
            id="bug-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={translateSettings(
              "settings.describeWhatHappenedWhatYouExpectedAndAnyReproductionSteps"
            )}
            rows={6}
            spellCheck
            className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 focus:border-zinc-500/40 resize-y"
          />
        </div>

        <div className="rounded-lg border border-[#27272a] bg-[#18181b]/50 divide-y divide-[#27272a]/60">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-200">
                {translateSettings("settings.includeCurrentLogFileLast500Lines")}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {translateSettings(
                  "settings.recentMainProcessLogEntriesRedactedOfTokensAndSecrets"
                )}
              </p>
            </div>
            <Switch
              aria-label={translateSettings("settings.includeCurrentLogFile")}
              checked={includeMainLog}
              onCheckedChange={setIncludeMainLog}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-200">
                {translateSettings("settings.includeNoiseLogLast200LinesChatHlsEvents")}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {noiseAvailable
                  ? translateSettings("settings.highVolumeBackgroundEventsSplitIntoASideChannelLog")
                  : translateSettings("settings.noiseSideChannelLogIsnTAvailableInThisBuild")}
              </p>
            </div>
            <Switch
              aria-label={translateSettings("settings.includeNoiseLog")}
              checked={includeNoiseLog}
              onCheckedChange={setIncludeNoiseLog}
              disabled={!noiseAvailable}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="bg-yellow-500 hover:bg-yellow-400 text-black"
          >
            <LuBug className="w-4 h-4 mr-2" />
            {translateSettings("settings.generateBugReport")}
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleOpenFolder()}
            className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
          >
            <LuFolderOpen className="w-4 h-4 mr-2" />
            {translateSettings("settings.openBugReportsFolder")}
          </Button>
        </div>

        {savedPath && (
          <div className="rounded-lg border border-[#27272a] bg-[#09090b] p-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-zinc-500 mb-1">
                {translateSettings("settings.savedReport")}
              </p>
              <p className="text-xs font-mono text-zinc-300 truncate" title={savedPath}>
                {savedPath}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopyPath(savedPath)}
              className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white flex-shrink-0"
            >
              <LuCopy className="w-4 h-4 mr-2" />
              {translateSettings("settings.copyPath")}
            </Button>
          </div>
        )}

        {recentReports.length > 0 && (
          <div className="space-y-2 pt-4 border-t border-[#27272a]">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
              {translateSettings("settings.recentReports")}
            </p>
            <ul className="space-y-1">
              {recentReports.map((path) => (
                <li key={path} className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="font-mono truncate flex-1" title={path}>
                    {path}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyPath(path)}
                    aria-label={translateSettings("settings.copyPathValue", { path: path })}
                    className="text-zinc-500 hover:text-zinc-200 transition-colors flex-shrink-0"
                  >
                    <LuCopy className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
