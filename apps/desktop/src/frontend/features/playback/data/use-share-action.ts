import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useManagedTimeout } from "@/hooks/useManagedTimeout";

interface UseShareActionOptions {
  shareUrl?: string | null;
  isPlaybackReady: boolean;
  contentLabel: "Clip" | "Video";
  contentKey?: string | null;
}

function isVerifiedPublicContentUrl(value: string | null | undefined): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;

    const host = url.hostname.toLowerCase();
    if (host === "clips.twitch.tv") return /^\/[^/]+\/?$/.test(url.pathname);
    if (host === "twitch.tv" || host === "www.twitch.tv") {
      return /^\/videos\/[^/]+\/?$/.test(url.pathname);
    }
    if (host === "kick.com" || host === "www.kick.com") {
      if (/^\/video\/[^/]+\/?$/.test(url.pathname)) return true;
      if (/^\/[^/]+\/clips\/[^/]+\/?$/.test(url.pathname)) return true;

      const legacyClipId = url.searchParams.get("clip");
      return /^\/[^/]+\/?$/.test(url.pathname) && /^clip_[\w-]+$/.test(legacyClipId ?? "");
    }
    return false;
  } catch {
    return false;
  }
}

export function useShareAction({
  shareUrl,
  isPlaybackReady,
  contentLabel,
  contentKey,
}: UseShareActionOptions) {
  const { t } = useTranslation();
  const contentIdentity = `${contentKey ?? ""}\u0000${shareUrl ?? ""}`;
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const copiedReset = useManagedTimeout(useCallback(() => setCopiedFor(null), []));
  const canShare = isPlaybackReady && isVerifiedPublicContentUrl(shareUrl);
  const copied = copiedFor === contentIdentity;

  useEffect(() => {
    if (copiedFor !== null && copiedFor !== contentIdentity) {
      setCopiedFor(null);
      copiedReset.clear();
    }
  }, [contentIdentity, copiedFor, copiedReset]);

  const share = useCallback(async () => {
    if (!canShare || !shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedFor(contentIdentity);
      copiedReset.start(2_000);
      toast.success(t("playback.linkCopied"));
    } catch {
      setCopiedFor(null);
      copiedReset.clear();
      toast.error(t("playback.couldNotCopyLink"));
    }
  }, [canShare, contentIdentity, copiedReset, shareUrl, t]);

  return {
    canShare,
    copied,
    share,
    unavailableTitle: t("playback.shareUnavailable", { content: contentLabel }),
  };
}
