/**
 * U23 — AutoMod alert pipeline.
 *
 * Subscribes to the Twitch or Kick AutoMod queue store for a given channel
 * and fires three concurrent alerts when a new held message arrives:
 *
 *  1. Tab badge — handled by the parent reading `countForChannel` from the
 *     same store, so this hook does not touch the badge directly.
 *  2. Sonner toast — fired here with inline Approve / Deny action buttons.
 *  3. OS notification — fired here through `osNotificationThrottle`, gated
 *     on a per-channel preference read from the key_value table (default
 *     OFF; U30 will ship the settings UI to flip it).
 *
 * The diff is computed against a `previouslySeen` ref of message keys; the
 * pre-existing queue (e.g. when the tab mounts mid-session) does NOT fire
 * alerts. Only entries that appear AFTER the initial render do.
 *
 * Hook is platform-aware so the Twitch and Kick tabs can both call it with
 * the same shape; internally it picks the right store based on `platform`.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { dbService } from "@/backend/services/database-service";
import { osNotificationThrottle } from "@/backend/services/os-notification-throttle";
import { useAutoModQueueStore } from "@/store/automod-queue-store";
import { useKickAutoModQueueStore } from "@/store/kick-automod-queue";

export interface UseAutoModAlertsOptions {
  platform: "twitch" | "kick";
  channelId: string | null;
  channelName: string;
  onApprove: (messageId: string) => void;
  onDeny: (messageId: string) => void;
}

interface AlertEntry {
  messageId: string;
  username: string;
  preview: string;
}

/** Truncate a preview so the toast / OS notification doesn't bloat. */
function truncatePreview(text: string, max = 120): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Read the per-channel OS-notif pref. Default false. */
function isOsNotifEnabled(channelId: string): boolean {
  try {
    const v = dbService.get<boolean>(`automod-os-notif:${channelId}`);
    return v === true;
  } catch {
    // dbService not available (e.g. in tests that don't mock it). Treat as OFF.
    return false;
  }
}

export function useAutoModAlerts(opts: UseAutoModAlertsOptions): void {
  const { platform, channelId, channelName, onApprove, onDeny } = opts;
  // Track already-alerted message ids per channel so re-subscriptions (e.g.
  // strict-mode double-mount) don't re-fire.
  const seenRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  // Latest callbacks live in a ref so we don't re-subscribe to the store on
  // every parent render.
  const callbacksRef = useRef({ onApprove, onDeny });
  callbacksRef.current = { onApprove, onDeny };

  useEffect(() => {
    if (!channelId) return;
    // Reset per-channel state so swapping channels doesn't carry seen ids over.
    seenRef.current = new Set();
    initializedRef.current = false;

    const store = platform === "twitch"
      ? useAutoModQueueStore
      : useKickAutoModQueueStore;

    // Seed `seenRef` with whatever's already in the queue for this channel
    // — those entries pre-date the alert pipeline and must not fire.
    const seedEntries = collectEntries(platform, channelId);
    for (const e of seedEntries) seenRef.current.add(e.messageId);
    initializedRef.current = true;

    const unsubscribe = store.subscribe((state) => {
      // Re-derive the current per-channel set on every store change. Cheap:
      // the queue is small (max a few dozen entries) and changes are rare.
      void state; // suppress unused-arg; we read via collectEntries for typing
      const current = collectEntries(platform, channelId);
      const fresh: AlertEntry[] = [];
      for (const entry of current) {
        if (!seenRef.current.has(entry.messageId)) {
          seenRef.current.add(entry.messageId);
          fresh.push(entry);
        }
      }
      // Drop removed entries from the seen set so a re-add of the SAME id
      // (e.g. test fixtures) would re-alert. In practice messageIds are
      // unique per hold so this is mostly housekeeping.
      const currentIds = new Set(current.map((e) => e.messageId));
      for (const id of Array.from(seenRef.current)) {
        if (!currentIds.has(id)) seenRef.current.delete(id);
      }
      if (fresh.length === 0) return;

      for (const entry of fresh) {
        fireToast(entry, callbacksRef.current);
      }
      // OS notification is gated on the per-channel pref. Read once per
      // batch — a single hold-storm shouldn't hit SQLite N times.
      if (isOsNotifEnabled(channelId)) {
        for (const entry of fresh) {
          osNotificationThrottle.enqueue({
            channelId,
            channelName,
            preview: `${entry.username}: ${entry.preview}`,
          });
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [platform, channelId, channelName]);
}

function collectEntries(
  platform: "twitch" | "kick",
  channelId: string,
): AlertEntry[] {
  if (platform === "twitch") {
    const list = useAutoModQueueStore.getState().listForChannel(channelId);
    return list.map((m) => ({
      messageId: m.messageId,
      username: m.username,
      preview: truncatePreview(m.rawText),
    }));
  }
  const list = useKickAutoModQueueStore.getState().listForChannel(channelId);
  return list.map((m) => ({
    messageId: m.messageId,
    username: m.senderUsername,
    preview: truncatePreview(m.rawText),
  }));
}

function fireToast(
  entry: AlertEntry,
  callbacks: { onApprove: (id: string) => void; onDeny: (id: string) => void },
): void {
  toast(`AutoMod held a message from ${entry.username}`, {
    description: entry.preview,
    action: {
      label: "Approve",
      onClick: () => callbacks.onApprove(entry.messageId),
    },
    cancel: {
      label: "Deny",
      onClick: () => callbacks.onDeny(entry.messageId),
    },
  });
}
