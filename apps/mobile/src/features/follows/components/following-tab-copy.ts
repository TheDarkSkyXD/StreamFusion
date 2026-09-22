import type { FollowingTab, TabItems } from "../capabilities/following-session";

type Translate = (key: string, values?: Record<string, unknown>) => string;

export function tabItemsCopy<T>(
  tab: FollowingTab,
  items: TabItems<T>,
  t: Translate,
): string {
  if (items.kind === "loading") {
    return tab === "live"
      ? t("discovery.following.loadingLiveGuest")
      : t("discovery.following.loadingTabGuest", { tab });
  }
  if (items.kind === "empty" && items.reason === "no-membership") {
    return t("discovery.following.guestEmptyMembership");
  }
  if (items.kind === "empty" && items.reason === "none-live") {
    return t("discovery.following.guestNoneLive");
  }
  if (items.kind === "empty") {
    return t("discovery.following.guestNoMatches");
  }
  if (items.kind === "unsupported") {
    return t("discovery.following.kickRecordedUnsupported");
  }
  if (items.kind === "failed" && items.offline) {
    return t("discovery.following.guestOfflineSaved");
  }
  if (items.kind === "failed") {
    return tab === "live"
      ? t("discovery.following.guestLiveLoadFailed")
      : t("discovery.following.guestTabLoadFailed", { tab });
  }
  if (items.kind === "partial") {
    return items.stale
      ? t("discovery.following.guestPartialStale")
      : t("discovery.following.guestPartial");
  }
  return readyCopy(tab, items.stale, t);
}

function readyCopy(tab: FollowingTab, stale: boolean, t: Translate): string {
  if (stale) {
    return tab === "live"
      ? t("discovery.following.guestReadyLiveStale")
      : t("discovery.following.guestReadyTabStale", { tab });
  }
  if (tab === "live") return t("discovery.following.guestReadyLive");
  if (tab === "videos") return t("discovery.following.guestReadyVideos");
  if (tab === "clips") return t("discovery.following.guestReadyClips");
  if (tab === "categories") {
    return t("discovery.following.guestReadyCategories");
  }
  return t("discovery.following.guestReadyChannels");
}
