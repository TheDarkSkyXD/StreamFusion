import type { MediaJobSnapshot } from "@streamfusion/core/media-jobs";
import { mediaJobDisplay } from "../utils/media-display";
export type MediaLibraryFilter = "all" | "video" | "clip" | "recording";
export function filterMediaJobs(
  jobs: readonly MediaJobSnapshot[],
  query: string,
  filter: MediaLibraryFilter,
): readonly MediaJobSnapshot[] {
  const search = query.trim().toLocaleLowerCase();
  return jobs.filter((job) => {
    const display = mediaJobDisplay(job);
    const kind =
      display?.contentKind ??
      (job.intent.kind === "recording" ? "recording" : "video");
    return (
      (filter === "all" || filter === kind) &&
      `${display?.title ?? job.intent.kind} ${display?.channelName ?? ""}`
        .toLocaleLowerCase()
        .includes(search)
    );
  });
}
