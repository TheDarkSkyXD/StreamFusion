import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuCircleAlert,
  LuCircleCheck,
  LuClock3,
  LuDownload,
  LuFileVideo,
  LuFolderOpen,
  LuListX,
  LuPlay,
  LuTrash2,
  LuX,
} from "react-icons/lu";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { prewarmViewportImages } from "@/lib/viewport-image-prewarm";
import type { DownloadJob, DownloadQueueSnapshot } from "@shared/download-types";

const STATUS_LABELS: Record<DownloadJob["status"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  paused: "Paused",
  failed: "Failed",
  waiting: "Waiting for platform",
  completed: "Completed",
  cancelled: "Cancelled",
};

type DownloadSectionId = "inProgress" | "needsAttention" | "finished";

interface DownloadSectionDefinition {
  id: DownloadSectionId;
  title: string;
  description: string;
  statuses: readonly DownloadJob["status"][];
  icon: IconType;
  iconClassName: string;
}

const DOWNLOAD_SECTIONS: readonly DownloadSectionDefinition[] = [
  {
    id: "inProgress",
    title: "In progress",
    description: "Active downloads and files waiting to start.",
    statuses: ["downloading", "queued"],
    icon: LuClock3,
    iconClassName: "text-[var(--color-primary)]",
  },
  {
    id: "needsAttention",
    title: "Needs attention",
    description: "Paused downloads and items that could not finish.",
    statuses: ["paused", "waiting", "failed"],
    icon: LuCircleAlert,
    iconClassName: "text-amber-300",
  },
  {
    id: "finished",
    title: "Finished",
    description: "Completed and cancelled downloads.",
    statuses: ["completed", "cancelled"],
    icon: LuCircleCheck,
    iconClassName: "text-emerald-300",
  },
];

const STATUS_CHIP_CLASSES: Record<DownloadJob["status"], string> = {
  queued:
    "border-[var(--color-border)] bg-[var(--color-background-tertiary)] text-[var(--color-foreground-secondary)]",
  downloading:
    "border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  paused: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  waiting: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  failed: "border-red-400/30 bg-red-400/10 text-red-300",
  completed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  cancelled:
    "border-[var(--color-border)] bg-[var(--color-background-tertiary)] text-[var(--color-foreground-muted)]",
};

type DownloadAction = "openFile" | "showInFolder" | "remove" | "deleteFile";

function DownloadActionTooltip({
  children,
  label,
}: {
  children: ReactElement;
  label: string;
}) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

const DOWNLOAD_PREWARM_PRIORITY: Record<DownloadJob["status"], number> = {
  downloading: 0,
  queued: 1,
  waiting: 2,
  paused: 3,
  failed: 4,
  completed: 5,
  cancelled: 6,
};

let downloadsPrewarmRequest: Promise<void> | undefined;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatTransfer(job: DownloadJob): string {
  const transferred = formatBytes(job.progress.transferredBytes);
  const total = job.progress.totalBytes === null ? null : formatBytes(job.progress.totalBytes);
  const speed = job.progress.bytesPerSecond
    ? `${formatBytes(job.progress.bytesPerSecond)}/s`
    : null;

  return [total ? `${transferred} of ${total}` : transferred, speed]
    .filter(Boolean)
    .join("  /  ");
}

export function prewarmDownloadsFirstThumbnail(): Promise<void> {
  if (downloadsPrewarmRequest) return downloadsPrewarmRequest;

  const downloads = window.electronAPI?.downloads;
  if (!downloads) return Promise.resolve();

  downloadsPrewarmRequest = downloads
    .getQueue()
    .then((queue) =>
      prewarmViewportImages(
        queue.jobs
          .filter((job) => job.thumbnailUrl)
          .sort((left, right) => DOWNLOAD_PREWARM_PRIORITY[left.status] - DOWNLOAD_PREWARM_PRIORITY[right.status])
          .slice(0, 2)
          .map((job) => job.thumbnailUrl)
      )
    )
    .catch(() => undefined);

  return downloadsPrewarmRequest;
}

export function _resetDownloadsPrewarmForTests(): void {
  downloadsPrewarmRequest = undefined;
}

function DownloadRow({
  job,
  onCancel,
  onAction,
}: {
  job: DownloadJob;
  onCancel: (job: DownloadJob) => void;
  onAction: (action: DownloadAction, job: DownloadJob) => void;
}) {
  const progress = job.progress.percent === null ? undefined : job.progress.percent;
  const canCancel = job.status === "queued" || job.status === "downloading";
  const canRemove = !canCancel;
  const hasFileActions = job.status === "completed" || job.partial === true;

  return (
    <article className="group grid gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4 transition-colors hover:border-[var(--color-foreground-muted)] motion-reduce:transition-none sm:grid-cols-[144px_minmax(0,1fr)] lg:grid-cols-[160px_minmax(0,1fr)_auto] lg:items-center">
      <div className="aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-black/40 sm:w-36 lg:w-40">
        <ProxiedImage
          src={job.thumbnailUrl}
          alt={job.title}
          className="size-full object-cover"
          width={160}
          height={90}
          fallback={<LuFileVideo className="size-full p-7 text-[var(--color-foreground-muted)]" />}
        />
      </div>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold leading-6">{job.title}</h3>
            <p className="mt-0.5 text-sm text-[var(--color-foreground-secondary)]">
              {job.channelName} <span aria-hidden="true">/</span>{" "}
              {job.kind === "video" ? "Video" : "Clip"}
              {job.qualityLabel ? ` / ${job.qualityLabel}` : ""}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CHIP_CLASSES[job.status]}`}
          >
            {STATUS_LABELS[job.status]}
          </span>
        </div>

        <Progress value={progress} className="h-2" />
        <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-[var(--color-foreground-secondary)]">
          <span className="min-w-0 truncate">{job.error ?? job.statusMessage ?? formatTransfer(job)}</span>
          <span className="shrink-0 tabular-nums">
            {progress === undefined ? "Progress unavailable" : `${Math.round(progress)}%`}
          </span>
        </div>
        {(job.error || job.statusMessage) && job.progress.transferredBytes > 0 ? (
          <p className="mt-1 text-xs tabular-nums text-[var(--color-foreground-muted)]">
            {formatTransfer(job)}
          </p>
        ) : null}
      </div>

      {canCancel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-10 shrink-0 gap-2 justify-self-start sm:col-start-2 lg:col-start-auto"
          aria-label={`Cancel ${job.title}`}
          onClick={() => onCancel(job)}
        >
          <LuX className="size-5" aria-hidden="true" />
          Cancel
        </Button>
      ) : null}

      {canRemove ? (
        <div className="flex shrink-0 items-center gap-1 justify-self-start sm:col-start-2 lg:col-start-auto">
          {hasFileActions ? (
            <>
              <DownloadActionTooltip label="Open file">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={`Open ${job.title}`}
                  onClick={() => onAction("openFile", job)}
                >
                  <LuPlay className="size-5" aria-hidden="true" />
                </Button>
              </DownloadActionTooltip>
              <DownloadActionTooltip label="Show in folder">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={`Show ${job.title} in folder`}
                  onClick={() => onAction("showInFolder", job)}
                >
                  <LuFolderOpen className="size-5" aria-hidden="true" />
                </Button>
              </DownloadActionTooltip>
              <DownloadActionTooltip label="Delete from disk">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={`Delete ${job.title} from disk`}
                  onClick={() => onAction("deleteFile", job)}
                >
                  <LuTrash2 className="size-5" aria-hidden="true" />
                </Button>
              </DownloadActionTooltip>
            </>
          ) : null}
          <DownloadActionTooltip label="Remove from list">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={`Remove ${job.title} from list`}
              onClick={() => onAction("remove", job)}
            >
              <LuListX className="size-5" aria-hidden="true" />
            </Button>
          </DownloadActionTooltip>
        </div>
      ) : null}
    </article>
  );
}

function cancelDownload(job: DownloadJob) {
  void window.electronAPI?.downloads?.cancel(job.id);
}

function runDownloadAction(action: DownloadAction, job: DownloadJob) {
  void window.electronAPI?.downloads?.[action](job.id);
}

export function DownloadsPage() {
  const [queue, setQueue] = useState<DownloadQueueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(false);
  const queuePushVersion = useRef(0);

  const loadQueue = useCallback(async () => {
    const api = window.electronAPI?.downloads;
    if (!api) {
      if (isMounted.current) setError("Downloads are not available.");
      return;
    }

    const versionAtStart = queuePushVersion.current;
    try {
      const nextQueue = await api.getQueue();
      if (isMounted.current && queuePushVersion.current === versionAtStart) {
        setError(null);
        setQueue(nextQueue);
      }
    } catch {
      if (isMounted.current && queuePushVersion.current === versionAtStart) {
        setError("Couldn't load downloads.");
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    const api = window.electronAPI?.downloads;
    if (!api) {
      setError("Downloads are not available.");
      return () => {
        isMounted.current = false;
      };
    }

    const unsubscribe = api.onQueueChanged((nextQueue) => {
      queuePushVersion.current += 1;
      if (isMounted.current) {
        setError(null);
        setQueue(nextQueue);
      }
    });
    void loadQueue();

    return () => {
      isMounted.current = false;
      unsubscribe();
    };
  }, [loadQueue]);

  const retryLoad = () => {
    setError(null);
    setQueue(null);
    void loadQueue();
  };

  const populatedSections = DOWNLOAD_SECTIONS.map((section) => ({
    ...section,
    jobs: queue?.jobs.filter((job) => section.statuses.includes(job.status)) ?? [],
  })).filter((section) => section.jobs.length > 0);

  return (
    <div className="mx-auto h-full max-w-6xl space-y-8 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-center gap-4 border-b border-[var(--color-border)] pb-6">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/10">
          <LuDownload className="size-7 text-[var(--color-primary)]" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Downloads</h1>
          <p className="mt-1 text-sm text-[var(--color-foreground-secondary)]">
            Track clips and videos saved from StreamFusion.
          </p>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex flex-col items-start justify-between gap-4 rounded-xl border border-red-400/30 bg-red-400/5 p-6 sm:flex-row sm:items-center"
        >
          <div className="flex gap-3">
            <LuCircleAlert className="mt-0.5 size-5 shrink-0 text-red-300" aria-hidden="true" />
            <div>
              <h2 className="font-bold">Downloads could not be loaded</h2>
              <p className="mt-1 text-sm text-[var(--color-foreground-secondary)]">{error}</p>
            </div>
          </div>
          <Button className="min-h-10" variant="outline" onClick={retryLoad}>
            Retry
          </Button>
        </div>
      ) : queue === null ? (
        <div className="space-y-4" aria-label="Loading downloads">
          <p className="text-sm text-[var(--color-foreground-secondary)]">Loading downloads...</p>
          {[0, 1].map((item) => (
            <div
              key={item}
              className="grid animate-pulse gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4 motion-reduce:animate-none sm:grid-cols-[144px_1fr]"
            >
              <div className="aspect-video rounded-lg bg-[var(--color-background-tertiary)]" />
              <div className="space-y-3 py-1">
                <div className="h-4 w-2/3 rounded bg-[var(--color-background-tertiary)]" />
                <div className="h-3 w-1/3 rounded bg-[var(--color-background-tertiary)]" />
                <div className="h-2 w-full rounded bg-[var(--color-background-tertiary)]" />
              </div>
            </div>
          ))}
        </div>
      ) : queue.jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-background-secondary)] px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-[var(--color-background-tertiary)]">
            <LuDownload className="size-7 text-[var(--color-foreground-muted)]" aria-hidden="true" />
          </div>
          <h2 className="text-base font-bold">No downloads yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-foreground-secondary)]">
            Download a playable Clip or Video. Its progress and file actions will appear here.
          </p>
        </div>
      ) : (
        <div aria-label="Download queue" className="space-y-8">
          {populatedSections.map((section) => (
            <section key={section.id} aria-labelledby={`download-section-${section.id}`}>
              <div className="mb-3 flex items-start gap-3">
                <section.icon
                  className={`mt-0.5 size-5 ${section.iconClassName}`}
                  aria-hidden="true"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 id={`download-section-${section.id}`} className="text-base font-bold">
                      {section.title}
                    </h2>
                    <span className="rounded-full bg-[var(--color-background-tertiary)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--color-foreground-secondary)]">
                      {section.jobs.length}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-foreground-muted)]">
                    {section.description}
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {section.jobs.map((job) => (
                  <DownloadRow
                    key={job.id}
                    job={job}
                    onCancel={cancelDownload}
                    onAction={runDownloadAction}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
