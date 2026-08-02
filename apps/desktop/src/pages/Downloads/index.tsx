import { useCallback, useEffect, useRef, useState } from "react";
import {
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
import { prewarmViewportImages } from "@/lib/viewport-image-prewarm";
import type { DownloadJob, DownloadQueueSnapshot } from "@/shared/download-types";

const STATUS_LABELS: Record<DownloadJob["status"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  paused: "Paused",
  failed: "Failed",
  waiting: "Waiting for platform",
  completed: "Completed",
  cancelled: "Cancelled",
};

type DownloadAction = "openFile" | "showInFolder" | "remove" | "deleteFile";

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
    <article className="flex items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4">
      <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-black/40">
        <ProxiedImage
          src={job.thumbnailUrl}
          alt={job.title}
          className="size-full object-cover"
          width={96}
          height={56}
          fallback={<LuFileVideo className="size-full p-3 text-[var(--color-foreground-muted)]" />}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold">{job.title}</h3>
            <p className="text-xs text-[var(--color-foreground-secondary)]">
              {job.channelName} / {job.kind === "video" ? "Video" : "Clip"}
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-[var(--color-foreground-secondary)]">
            {STATUS_LABELS[job.status]}
          </span>
        </div>

        <Progress value={progress} className="h-2" />
        <div className="mt-1 flex justify-between text-xs text-[var(--color-foreground-secondary)]">
          <span className="truncate pr-3">{job.statusMessage ?? job.error ?? ""}</span>
          <span>
            {progress === undefined ? "Progress unavailable" : `${Math.round(progress)}%`}
          </span>
        </div>
      </div>

      {canCancel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 gap-2"
          aria-label={`Cancel ${job.title}`}
          onClick={() => onCancel(job)}
        >
          <LuX aria-hidden="true" />
          Cancel
        </Button>
      ) : null}

      {canRemove ? (
        <div className="flex shrink-0 items-center gap-1">
          {hasFileActions ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Open ${job.title}`}
                onClick={() => onAction("openFile", job)}
              >
                <LuPlay aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Show ${job.title} in folder`}
                onClick={() => onAction("showInFolder", job)}
              >
                <LuFolderOpen aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${job.title} from disk`}
                onClick={() => onAction("deleteFile", job)}
              >
                <LuTrash2 aria-hidden="true" />
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${job.title} from list`}
            onClick={() => onAction("remove", job)}
          >
            <LuListX aria-hidden="true" />
          </Button>
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

  return (
    <div className="mx-auto h-full max-w-5xl space-y-6 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <LuDownload className="size-8 text-[var(--color-primary)]" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Downloads</h1>
          <p className="text-sm text-[var(--color-foreground-secondary)]">
            Clips and Videos saved from StreamFusion.
          </p>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-6"
        >
          <span>{error}</span>
          <Button variant="outline" onClick={retryLoad}>
            Retry
          </Button>
        </div>
      ) : queue === null ? (
        <div className="rounded-xl border border-[var(--color-border)] p-6 text-[var(--color-foreground-secondary)]">
          Loading downloads...
        </div>
      ) : queue.jobs.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-10 text-center">
          <LuDownload
            className="mx-auto mb-3 size-8 text-[var(--color-foreground-muted)]"
            aria-hidden="true"
          />
          <h2 className="text-sm font-bold">No downloads yet</h2>
          <p className="mt-1 text-sm text-[var(--color-foreground-secondary)]">
            Download a playable Clip or Video to see its progress here.
          </p>
        </div>
      ) : (
        <section aria-label="Download queue" className="space-y-3">
          {queue.jobs.map((job) => (
            <DownloadRow
              key={job.id}
              job={job}
              onCancel={cancelDownload}
              onAction={runDownloadAction}
            />
          ))}
        </section>
      )}
    </div>
  );
}
