import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDownloadController } from "@/features/media-library/composition/download-controller";
import { useSharedThroughputDomain } from "@/features/media-library/components/hooks/use-shared-throughput-domain";
import { useDownloadThroughputStore } from "@/features/media-library/components/state/download-throughput-store";
import type { TFunction } from "i18next";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { Progress } from "@/components/ui/progress";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { prewarmViewportImages } from "@/lib/viewport-image-prewarm";
import type { DownloadJob } from "@shared/download-types";

import { DownloadThroughputMeter } from "./DownloadThroughputMeter";

type DownloadStatusLabelKey =
  | "mediaLibrary.downloadStatusQueued"
  | "mediaLibrary.downloadStatusDownloading"
  | "mediaLibrary.downloadStatusPaused"
  | "mediaLibrary.downloadStatusFailed"
  | "mediaLibrary.downloadStatusWaiting"
  | "mediaLibrary.downloadStatusCompleted"
  | "mediaLibrary.downloadStatusCancelled";

const STATUS_LABEL_KEYS = {
  queued: "mediaLibrary.downloadStatusQueued",
  downloading: "mediaLibrary.downloadStatusDownloading",
  paused: "mediaLibrary.downloadStatusPaused",
  failed: "mediaLibrary.downloadStatusFailed",
  waiting: "mediaLibrary.downloadStatusWaiting",
  completed: "mediaLibrary.downloadStatusCompleted",
  cancelled: "mediaLibrary.downloadStatusCancelled",
} as const satisfies Record<DownloadJob["status"], DownloadStatusLabelKey>;

type DownloadSectionId = "inProgress" | "needsAttention" | "finished";
type DownloadSectionTranslationKey =
  | "mediaLibrary.downloadsInProgress"
  | "mediaLibrary.downloadsInProgressDescription"
  | "mediaLibrary.downloadsNeedsAttention"
  | "mediaLibrary.downloadsNeedsAttentionDescription"
  | "mediaLibrary.downloadsFinished"
  | "mediaLibrary.downloadsFinishedDescription";

interface DownloadSectionDefinition {
  id: DownloadSectionId;
  titleKey: DownloadSectionTranslationKey;
  descriptionKey: DownloadSectionTranslationKey;
  statuses: readonly DownloadJob["status"][];
  icon: IconType;
  iconClassName: string;
}

const DOWNLOAD_SECTIONS: readonly DownloadSectionDefinition[] = [
  {
    id: "inProgress",
    titleKey: "mediaLibrary.downloadsInProgress",
    descriptionKey: "mediaLibrary.downloadsInProgressDescription",
    statuses: ["downloading", "queued"],
    icon: LuClock3,
    iconClassName: "text-[var(--color-primary)]",
  },
  {
    id: "needsAttention",
    titleKey: "mediaLibrary.downloadsNeedsAttention",
    descriptionKey: "mediaLibrary.downloadsNeedsAttentionDescription",
    statuses: ["paused", "waiting", "failed"],
    icon: LuCircleAlert,
    iconClassName: "text-amber-300",
  },
  {
    id: "finished",
    titleKey: "mediaLibrary.downloadsFinished",
    descriptionKey: "mediaLibrary.downloadsFinishedDescription",
    statuses: ["completed", "cancelled"],
    icon: LuCircleCheck,
    iconClassName: "text-emerald-300",
  },
];

const STATUS_TEXT_CLASSES = {
  queued: "text-[var(--color-foreground-secondary)]",
  downloading: "text-[var(--color-primary)]",
  paused: "text-amber-300",
  waiting: "text-amber-300",
  failed: "text-red-300",
  completed: "text-emerald-300",
  cancelled: "text-[var(--color-foreground-muted)]",
} as const satisfies Record<DownloadJob["status"], string>;

const STATUS_CHIP_CLASSES: Record<DownloadJob["status"], string> = {
  queued: `border-[var(--color-border)] bg-[var(--color-background-tertiary)] ${STATUS_TEXT_CLASSES.queued}`,
  downloading: `border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 ${STATUS_TEXT_CLASSES.downloading}`,
  paused: `border-amber-400/30 bg-amber-400/10 ${STATUS_TEXT_CLASSES.paused}`,
  waiting: `border-amber-400/30 bg-amber-400/10 ${STATUS_TEXT_CLASSES.waiting}`,
  failed: `border-red-400/30 bg-red-400/10 ${STATUS_TEXT_CLASSES.failed}`,
  completed: `border-emerald-400/30 bg-emerald-400/10 ${STATUS_TEXT_CLASSES.completed}`,
  cancelled: `border-[var(--color-border)] bg-[var(--color-background-tertiary)] ${STATUS_TEXT_CLASSES.cancelled}`,
};

type ImmediateDownloadAction = "openFile" | "showInFolder" | "remove";
type DeleteFileKind = "completed" | "partial";

interface DeleteFileTarget {
  jobId: DownloadJob["id"];
  title: DownloadJob["title"];
  fileKind: DeleteFileKind;
}

type DeleteFileDialogState =
  | { phase: "closed" }
  | { phase: "idle"; target: DeleteFileTarget }
  | { phase: "pending"; target: DeleteFileTarget }
  | { phase: "failed"; target: DeleteFileTarget; error: string };

type OpenDeleteFileDialogState = Exclude<DeleteFileDialogState, { phase: "closed" }>;

function getDeleteFileTarget(job: DownloadJob): DeleteFileTarget | null {
  if (job.status === "completed") {
    return { jobId: job.id, title: job.title, fileKind: "completed" };
  }

  if (job.partial === true && job.status !== "queued" && job.status !== "downloading") {
    return { jobId: job.id, title: job.title, fileKind: "partial" };
  }

  return null;
}

function DownloadActionTooltip({ children, label }: { children: ReactElement; label: string }) {
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

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatTransfer(job: DownloadJob, t: TFunction): string {
  const transferred = formatBytes(job.progress.transferredBytes);
  const total = job.progress.totalBytes === null ? null : formatBytes(job.progress.totalBytes);
  const speed = job.progress.bytesPerSecond
    ? t("mediaLibrary.transferSpeed", { value: formatBytes(job.progress.bytesPerSecond) })
    : null;

  return t("mediaLibrary.transferSummary", {
    summary: [total ? t("mediaLibrary.transferOf", { transferred, total }) : transferred, speed]
      .filter(Boolean)
      .join("  /  "),
  });
}

export function prewarmDownloadsFirstThumbnail(): Promise<void> {
  if (downloadsPrewarmRequest) return downloadsPrewarmRequest;

  const downloads = getDownloadController();
  if (!downloads) return Promise.resolve();

  downloadsPrewarmRequest = downloads
    .getQueue()
    .then((queue) =>
      prewarmViewportImages(
        queue.jobs
          .filter((job) => job.thumbnailUrl)
          .sort(
            (left, right) =>
              DOWNLOAD_PREWARM_PRIORITY[left.status] - DOWNLOAD_PREWARM_PRIORITY[right.status]
          )
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
  sharedMaximum,
  onCancel,
  onAction,
  onRequestDelete,
}: {
  job: DownloadJob;
  sharedMaximum: number;
  onCancel: (job: DownloadJob) => void;
  onAction: (action: ImmediateDownloadAction, job: DownloadJob) => void;
  onRequestDelete: (job: DownloadJob, opener: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation();
  const progress = job.progress.percent === null ? undefined : job.progress.percent;
  const canCancel = job.status === "queued" || job.status === "downloading";
  const canRemove = !canCancel;
  const deleteTarget = getDeleteFileTarget(job);
  const hasFileActions = deleteTarget !== null;

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
            <div className="mt-1 flex items-center gap-2 text-sm text-[var(--color-foreground-secondary)]">
              {/* The ring carries the platform, which is identification rather than an accent. */}
              <PlatformAvatar
                alt={job.channelName}
                platform={job.platform}
                size="w-5 h-5"
                className="shrink-0"
              />
              <span className="truncate">
                {[
                  job.channelName,
                  job.kind === "video" ? t("mediaLibrary.video") : t("mediaLibrary.clip"),
                  job.qualityLabel,
                ]
                  .filter(Boolean)
                  .join(" / ")}
              </span>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CHIP_CLASSES[job.status]}`}
          >
            {t(STATUS_LABEL_KEYS[job.status])}
          </span>
        </div>

        <Progress
          value={progress}
          indeterminate={progress === undefined && job.status === "downloading"}
          aria-label={job.title}
          aria-valuetext={progress === undefined ? formatTransfer(job, t) : undefined}
          className="h-2"
        />
        <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-[var(--color-foreground-secondary)]">
          <span className="min-w-0 truncate">
            {job.error ?? job.statusMessage ?? formatTransfer(job, t)}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <DownloadThroughputMeter
              job={job}
              sharedMaximum={sharedMaximum}
              statusTextClassName={STATUS_TEXT_CLASSES[job.status]}
            />
            <span className="shrink-0 tabular-nums">
              {progress === undefined
                ? t(STATUS_LABEL_KEYS[job.status])
                : Math.round(progress) + "%"}
            </span>
          </span>
        </div>
        {(job.error || job.statusMessage) && job.progress.transferredBytes > 0 ? (
          <p className="mt-1 text-xs tabular-nums text-[var(--color-foreground-muted)]">
            {formatTransfer(job, t)}
          </p>
        ) : null}
      </div>

      {canCancel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-10 shrink-0 gap-2 justify-self-start sm:col-start-2 lg:col-start-auto"
          aria-label={t("mediaLibrary.cancelDownloadTitle", { title: job.title })}
          onClick={() => onCancel(job)}
        >
          <LuX className="size-5" aria-hidden="true" />
          {t("mediaLibrary.cancel")}
        </Button>
      ) : null}

      {canRemove ? (
        <div className="flex shrink-0 items-center gap-1 justify-self-start sm:col-start-2 lg:col-start-auto">
          {hasFileActions ? (
            <>
              <DownloadActionTooltip label={t("mediaLibrary.openFile")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={t("mediaLibrary.openDownloadTitle", { title: job.title })}
                  onClick={() => onAction("openFile", job)}
                >
                  <LuPlay className="size-5" aria-hidden="true" />
                </Button>
              </DownloadActionTooltip>
              <DownloadActionTooltip label={t("mediaLibrary.showInFolder")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={t("mediaLibrary.showDownloadInFolderTitle", { title: job.title })}
                  onClick={() => onAction("showInFolder", job)}
                >
                  <LuFolderOpen className="size-5" aria-hidden="true" />
                </Button>
              </DownloadActionTooltip>
              <DownloadActionTooltip label={t("mediaLibrary.deleteFromDisk")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={t("mediaLibrary.deleteDownloadTitle", { title: job.title })}
                  onClick={(event) => onRequestDelete(job, event.currentTarget)}
                >
                  <LuTrash2 className="size-5" aria-hidden="true" />
                </Button>
              </DownloadActionTooltip>
            </>
          ) : null}
          <DownloadActionTooltip label={t("mediaLibrary.removeFromList")}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={t("mediaLibrary.removeDownloadTitle", { title: job.title })}
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
  void getDownloadController()?.cancel(job.id);
}

function runDownloadAction(action: ImmediateDownloadAction, job: DownloadJob) {
  void getDownloadController()?.[action](job.id);
}

function DeleteFromDiskDialog({
  state,
  onCancel,
  onConfirm,
}: {
  state: OpenDeleteFileDialogState;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const isPending = state.phase === "pending";
  const isPartial = state.target.fileKind === "partial";
  const preventDismissWhilePending = (event: Event) => {
    if (isPending) event.preventDefault();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        hideCloseButton
        role="alertdialog"
        aria-busy={isPending}
        className="max-w-md rounded-xl border-[var(--color-border)] bg-[var(--color-background-elevated)] shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] motion-reduce:duration-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onEscapeKeyDown={preventDismissWhilePending}
        onPointerDownOutside={preventDismissWhilePending}
        onInteractOutside={preventDismissWhilePending}
      >
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-[var(--color-destructive)]/15 text-[var(--color-destructive)]">
            <LuTrash2 className="size-5" aria-hidden="true" />
          </div>
          <DialogTitle>{t("mediaLibrary.deleteFileQuestion")}</DialogTitle>
          <DialogDescription className="leading-6 text-[var(--color-foreground-secondary)]">
            <span className="font-semibold text-[var(--color-foreground)]">
              {state.target.title}
            </span>{" "}
            {t("mediaLibrary.deleteDescription", {
              kind: isPartial
                ? t("mediaLibrary.partialDownload")
                : t("mediaLibrary.completedDownload"),
              file: isPartial ? t("mediaLibrary.partialFile") : t("mediaLibrary.completedFile"),
            })}
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <p aria-live="polite" className="text-sm text-[var(--color-foreground-secondary)]">
            {t("mediaLibrary.deletingFile")}
          </p>
        ) : null}
        {state.phase === "failed" ? (
          <p
            role="alert"
            className="rounded-md border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-foreground)]"
          >
            {state.error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={onCancel}
          >
            {t("mediaLibrary.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            aria-busy={isPending}
            className="gap-2"
            onClick={() => void onConfirm()}
          >
            <LuTrash2 className="size-4" aria-hidden="true" />
            {isPending
              ? t("mediaLibrary.deleting")
              : state.phase === "failed"
                ? t("mediaLibrary.retryDelete")
                : t("mediaLibrary.deleteFromDisk")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DownloadsPage() {
  const { t } = useTranslation();
  const queue = useDownloadThroughputStore((state) => state.queue);
  const loadError = useDownloadThroughputStore((state) => state.loadError);
  const seriesByJobId = useDownloadThroughputStore((state) => state.seriesByJobId);
  const subscribeQueue = useDownloadThroughputStore((state) => state.subscribe);
  const resetThroughput = useDownloadThroughputStore((state) => state.reset);
  const reloadQueue = useDownloadThroughputStore((state) => state.reload);
  const [deleteDialog, setDeleteDialog] = useState<DeleteFileDialogState>({ phase: "closed" });
  const isMounted = useRef(false);
  const deleteDialogRef = useRef<DeleteFileDialogState>({ phase: "closed" });
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);

  const error =
    loadError === "unavailable"
      ? t("mediaLibrary.downloadsUnavailable")
      : loadError === "failed"
        ? t("mediaLibrary.couldNotLoadDownloads")
        : null;

  const updateDeleteDialog = (next: DeleteFileDialogState) => {
    deleteDialogRef.current = next;
    setDeleteDialog(next);
  };

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeQueue();
    return () => {
      unsubscribe();
      resetThroughput();
    };
  }, [resetThroughput, subscribeQueue]);

  useEffect(() => {
    if (deleteDialog.phase === "closed" && deleteTriggerRef.current?.isConnected) {
      deleteTriggerRef.current.focus();
    }
  }, [deleteDialog.phase]);

  const requestFileDeletion = (job: DownloadJob, opener: HTMLButtonElement) => {
    const target = getDeleteFileTarget(job);
    if (!target) return;
    deleteTriggerRef.current = opener;
    updateDeleteDialog({ phase: "idle", target });
  };

  const dismissFileDeletion = () => {
    if (deleteDialogRef.current.phase !== "pending") updateDeleteDialog({ phase: "closed" });
  };

  const confirmFileDeletion = async () => {
    const state = deleteDialogRef.current;
    if (state.phase !== "idle" && state.phase !== "failed") return;

    updateDeleteDialog({ phase: "pending", target: state.target });
    try {
      const result = await getDownloadController()?.deleteFile(state.target.jobId);
      if (!isMounted.current) return;
      if (result?.success) {
        updateDeleteDialog({ phase: "closed" });
      } else {
        updateDeleteDialog({
          phase: "failed",
          target: state.target,
          error: result?.error ?? t("mediaLibrary.couldNotDeleteFile"),
        });
      }
    } catch {
      if (isMounted.current) {
        updateDeleteDialog({
          phase: "failed",
          target: state.target,
          error: t("mediaLibrary.couldNotDeleteFile"),
        });
      }
    }
  };

  const populatedSections = DOWNLOAD_SECTIONS.map((section) => ({
    ...section,
    jobs: queue?.jobs.filter((job) => section.statuses.includes(job.status)) ?? [],
  })).filter((section) => section.jobs.length > 0);

  // Peaks are resolved over the active rows only: a finished row would peg the scale for the rest
  // of the session, and max-of-current would rescale the page on every spike.
  const activePeaks = useMemo(
    () =>
      (queue?.jobs ?? [])
        .filter((job) => job.status === "downloading" || job.status === "queued")
        .map((job) => seriesByJobId[job.id]?.peakBytesPerSecond ?? 0),
    [queue, seriesByJobId]
  );
  const sharedMaximum = useSharedThroughputDomain(activePeaks);

  return (
    <div className="mx-auto h-full max-w-6xl space-y-8 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-center gap-4 border-b border-[var(--color-border)] pb-6">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/10">
          <LuDownload className="size-7 text-[var(--color-primary)]" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t("mediaLibrary.downloads")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-foreground-secondary)]">
            {t("mediaLibrary.downloadsDescription")}
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
              <h2 className="font-bold">{t("mediaLibrary.downloadsLoadError")}</h2>
              <p className="mt-1 text-sm text-[var(--color-foreground-secondary)]">{error}</p>
            </div>
          </div>
          <Button className="min-h-10" variant="outline" onClick={reloadQueue}>
            {t("mediaLibrary.retry")}
          </Button>
        </div>
      ) : queue === null ? (
        <div className="space-y-4" aria-label={t("mediaLibrary.loadingDownloadsLabel")}>
          <p className="text-sm text-[var(--color-foreground-secondary)]">
            {t("mediaLibrary.loadingDownloads")}
          </p>
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
            <LuDownload
              className="size-7 text-[var(--color-foreground-muted)]"
              aria-hidden="true"
            />
          </div>
          <h2 className="text-base font-bold">{t("mediaLibrary.noDownloads")}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-foreground-secondary)]">
            {t("mediaLibrary.emptyDownloads")}
          </p>
        </div>
      ) : (
        <div aria-label={t("mediaLibrary.downloadQueue")} className="space-y-8">
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
                      {t(section.titleKey)}
                    </h2>
                    <span className="rounded-full bg-[var(--color-background-tertiary)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--color-foreground-secondary)]">
                      {section.jobs.length}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-foreground-muted)]">
                    {t(section.descriptionKey)}
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {section.jobs.map((job) => (
                  <DownloadRow
                    key={job.id}
                    job={job}
                    sharedMaximum={sharedMaximum}
                    onCancel={cancelDownload}
                    onAction={runDownloadAction}
                    onRequestDelete={requestFileDeletion}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {deleteDialog.phase !== "closed" ? (
        <DeleteFromDiskDialog
          state={deleteDialog}
          onCancel={dismissFileDeletion}
          onConfirm={confirmFileDeletion}
        />
      ) : null}
    </div>
  );
}
